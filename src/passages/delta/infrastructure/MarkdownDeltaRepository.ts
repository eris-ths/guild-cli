import { basename, dirname, join, resolve } from 'node:path';
import { Delta, DeltaIdCollision, parseDeltaId } from '../domain/Delta.js';
import { DeltaRepository } from '../application/DeltaRepository.js';
import { GuildConfig } from '../../../infrastructure/config/GuildConfig.js';
import {
  existsSafe,
  readTextSafe,
  writeTextSafeAtomic,
} from '../../../infrastructure/persistence/safeFs.js';

/**
 * delta's *markdown* storage adapter — one human-editable file instead of
 * one YAML file per deposit.
 *
 * Why a second adapter exists at all: delta's one absolute constraint is
 * that depositing must stay cheaper than the task it interrupts. The
 * cheapest deposit surface that exists is a shell append —
 *
 *     printf -- '- [%s] %s\n' "$(date '+%m-%d %H:%M')" "..." >> ledger.md
 *
 * — which costs no process start, no id allocation, and no destination
 * decision. An operator who has to run a CLI to deposit will, under load,
 * simply not deposit. So the write path stays `>>` and the CLI takes the
 * *read* and *deliver* side, where state transitions actually need to be
 * recorded. That asymmetry is the whole design: **deposit = append,
 * routing = CLI.**
 *
 * Consequence: the ledger is the source of truth, and this adapter must
 * treat it as a file a human edits by hand — which drives every decision
 * below (synthesised ids, structural section detection, fail-closed
 * inversion check).
 *
 * ## Ledger shape
 *
 * ```markdown
 * ## Delivered            <- any earlier `## ` section
 * - [08-08 21:45] text ⟵ source → candidate ⟹ 08-09 flush: reflect(note)
 *
 * ## Deposit              <- the LAST `## ` section
 * - [08-12 13:31] 🧭 text ⟵ source → candidate
 * ```
 *
 * Heading *text* is deliberately not matched. Matching on words would
 * bind the adapter to one natural language, and the invariant we actually
 * depend on is structural, not lexical: **the deposit section is last,
 * because `>>` can only append to the end of a file.** A ledger whose
 * deposit section is not last silently swallows every appended line into
 * the delivered section — the exact failure this adapter exists to make
 * impossible (see `assertNotInverted`).
 */

/** Markers. Deliberately distinct glyphs so none can occur in another's slot. */
const M_SOURCE = ' ⟵ ';
const M_CANDIDATE = ' → ';
const M_DELIVERED = ' ⟹ ';
/** Operator-authored deposit (as opposed to agent-authored). */
const M_OPERATOR = '🧭';

const LINE_RE = /^- \[(\d{2})-(\d{2}) (\d{2}):(\d{2})\]\s+(.*)$/;
const HEADING_RE = /^##\s+\S/;

export class DeltaLedgerShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeltaLedgerShapeError';
  }
}

interface ParsedLine {
  /** 0-based index into the file's line array. */
  readonly index: number;
  /** Which section the line sits in. */
  readonly landed: boolean;
  readonly id: string;
  readonly delta: Delta;
}

export class MarkdownDeltaRepository implements DeltaRepository {
  private readonly dir: string;
  private readonly file: string;

  constructor(
    private readonly config: GuildConfig,
    ledgerPath: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    const abs = resolve(ledgerPath);
    this.dir = dirname(abs);
    this.file = basename(abs);
  }

  get path(): string {
    return join(this.dir, this.file);
  }

  async listAllIds(): Promise<readonly string[]> {
    return this.parse().map((p) => p.id);
  }

  async listAll(): Promise<readonly Delta[]> {
    return this.parse().map((p) => p.delta);
  }

  async findById(id: string): Promise<Delta | null> {
    parseDeltaId(id);
    return this.parse().find((p) => p.id === id)?.delta ?? null;
  }

  /**
   * Append a deposit to the end of the ledger.
   *
   * End-of-file rather than "under the deposit heading" on purpose: this
   * is the same position a bare `>>` writes to, so the CLI path and the
   * shell path cannot drift apart. `assertNotInverted` is what makes that
   * position correct, and it has already run by the time we get here.
   */
  async saveNew(delta: Delta): Promise<void> {
    const lines = this.readLines();
    const parsed = this.parseLines(lines);
    if (parsed.some((p) => p.id === delta.id)) {
      throw new DeltaIdCollision(delta.id);
    }
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
    lines.push(renderLine(delta));
    this.writeLines(lines);
  }

  /**
   * Record a delivery: annotate the line in place and move it out of the
   * deposit section.
   *
   * The move is what keeps `>>` honest — a delivered line left in the
   * deposit section would be re-read as outstanding forever, and the
   * operator would lose the ability to tell a backlog from a history.
   * The line is *moved*, never deleted: a ledger that forgets where a
   * deposit went cannot answer "have we already decided this?", which is
   * the question a deposit ledger exists to answer.
   */
  async save(delta: Delta): Promise<void> {
    const lines = this.readLines();
    const parsed = this.parseLines(lines);
    const target = parsed.find((p) => p.id === delta.id);
    if (target === undefined) {
      throw new DeltaLedgerShapeError(
        `${delta.id} is not in ${this.path} — the ledger changed under us.\n` +
          `  next: delta list`,
      );
    }
    const rendered = renderLine(delta);
    if (target.landed || delta.delivered === undefined) {
      // Already out of the deposit section (or not a delivery): rewrite
      // in place, no move.
      lines[target.index] = rendered;
      this.writeLines(lines);
      return;
    }
    // Delivery: lift the line and re-insert at the end of the last
    // section that precedes the deposit section.
    lines.splice(target.index, 1);
    const insertAt = endOfLandedRegion(lines);
    lines.splice(insertAt, 0, rendered);
    this.writeLines(lines);
  }

  // ── internals ──────────────────────────────────────────────────────

  private readLines(): string[] {
    if (!existsSafe(this.dir, this.file)) {
      throw new DeltaLedgerShapeError(
        `delta ledger not found: ${this.path}\n` +
          `  next: create it with a '## ' heading for delivered deposits and a ` +
          `final '## ' heading for outstanding ones.`,
      );
    }
    return readTextSafe(this.dir, this.file).split('\n');
  }

  private writeLines(lines: readonly string[]): void {
    let out = lines.join('\n');
    if (!out.endsWith('\n')) out += '\n';
    writeTextSafeAtomic(this.dir, this.file, out);
  }

  private parse(): readonly ParsedLine[] {
    return this.parseLines(this.readLines());
  }

  private parseLines(lines: readonly string[]): readonly ParsedLine[] {
    const depositStart = lastHeadingIndex(lines);
    if (depositStart === -1) {
      throw new DeltaLedgerShapeError(
        `${this.path} has no '## ' section — cannot tell deposits from history.\n` +
          `  next: add a final '## ' heading; everything under it is treated as outstanding.`,
      );
    }
    const raw: {
      index: number;
      landed: boolean;
      date: string;
      time: string;
      body: string;
    }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = LINE_RE.exec(lines[i]!);
      if (m === null) continue;
      raw.push({
        index: i,
        landed: i < depositStart,
        date: `${m[1]}-${m[2]}`,
        time: `${m[3]}:${m[4]}`,
        body: m[5]!,
      });
    }
    assertNotInverted(raw, this.path);
    return this.hydrate(raw);
  }

  /**
   * Give every line a `delta-YYYY-MM-DD-NNN` id.
   *
   * The ledger carries no ids, and adding them would tax the deposit
   * surface — the one thing that must stay free. So ids are *derived*,
   * and derivation has one hard requirement: an id must survive the
   * edits the ledger actually receives, which are (a) appending a new
   * line, (b) appending a delivery annotation, and (c) moving a line
   * between sections. Position therefore cannot be an input.
   *
   * NNN is the rank within the day, ordered by `(time, text)`. Text
   * breaks same-minute ties deterministically without depending on where
   * the line sits, so a delivery — which appends after the text and
   * moves the line — leaves every id in the file unchanged.
   *
   * Editing a deposit's prose *does* renumber that day. That is the
   * honest trade: the ledger is the source of truth, and rewriting
   * history there is a real change, not a rename.
   */
  private hydrate(
    raw: readonly { index: number; landed: boolean; date: string; time: string; body: string }[],
  ): readonly ParsedLine[] {
    const today = this.now();
    const byDate = new Map<string, typeof raw[number][]>();
    for (const r of raw) {
      const bucket = byDate.get(r.date);
      if (bucket === undefined) byDate.set(r.date, [r]);
      else bucket.push(r);
    }
    const out: ParsedLine[] = [];
    for (const [date, bucket] of byDate) {
      const year = inferYear(date, today);
      const ordered = [...bucket].sort((a, b) =>
        a.time === b.time ? compareText(a.body, b.body) : a.time.localeCompare(b.time),
      );
      ordered.forEach((r, i) => {
        const id = `delta-${year}-${date}-${String(i + 1).padStart(3, '0')}`;
        out.push({
          index: r.index,
          landed: r.landed,
          id,
          delta: this.hydrateOne(id, year, r),
        });
      });
    }
    return out.sort((a, b) => a.index - b.index);
  }

  private hydrateOne(
    id: string,
    year: number,
    r: { landed: boolean; date: string; time: string; body: string },
  ): Delta {
    const f = splitBody(r.body);
    // The ledger has no author column. The operator marker is the only
    // authorship signal it carries, so that is what we read — rather
    // than inventing an attribution the file does not contain.
    const created_by = f.operator ? 'operator' : (this.config.hostNames[0] ?? 'agent');
    const created_at = `${year}-${r.date}T${r.time}:00`;
    const base = Delta.restore({
      id,
      created_at,
      created_by,
      text: f.text,
      source: f.source,
      candidate: f.candidate,
      delivered: undefined,
    });
    if (f.delivered === undefined) return base;
    // A delivered line's annotation is prose written by whoever ran the
    // flush; it has no structured destination. Recording the whole
    // annotation as `to` keeps `list --to` grep-able over what the
    // ledger really says, instead of a guess parsed out of it.
    return base.markDelivered({
      to: truncateDest(f.delivered),
      by: created_by,
      note: f.delivered,
      now: () => new Date(created_at),
    });
  }
}

// ── pure helpers ─────────────────────────────────────────────────────

function lastHeadingIndex(lines: readonly string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (HEADING_RE.test(lines[i]!)) return i;
  }
  return -1;
}

/** Insert position for a delivered line: end of the region before the deposit section. */
function endOfLandedRegion(lines: readonly string[]): number {
  const h = lastHeadingIndex(lines);
  let i = h === -1 ? lines.length : h;
  while (i > 0 && lines[i - 1]!.trim() === '') i--;
  return i;
}

/**
 * Fail closed when the ledger's sections are inverted.
 *
 * `>>` appends to the end of the file, so if the deposit section is not
 * last, every future deposit lands in history and is never read again.
 * Nothing about that failure is visible — the file still parses, the
 * counts still print, and the deposits are simply gone from the backlog.
 * A delivery marker in the last section is the observable signature, so
 * that is what we check.
 */
function assertNotInverted(
  raw: readonly { landed: boolean; body: string }[],
  path: string,
): void {
  const deposits = raw.filter((r) => !r.landed);
  if (deposits.length === 0) return;
  const delivered = deposits.filter((r) => r.body.includes(M_DELIVERED)).length;
  if (delivered === deposits.length) {
    throw new DeltaLedgerShapeError(
      `${path}: the last section holds only delivered entries — the sections ` +
        `look inverted.\n` +
        `  Appends go to the end of a file, so an outstanding-deposits section ` +
        `that is not last silently swallows every new deposit.\n` +
        `  next: move the outstanding-deposits heading and its entries below the ` +
        `delivered ones.`,
    );
  }
}

function splitBody(body: string): {
  operator: boolean;
  text: string;
  source: string | undefined;
  candidate: string | undefined;
  delivered: string | undefined;
} {
  let rest = body.trim();
  let operator = false;
  if (rest.startsWith(M_OPERATOR)) {
    operator = true;
    rest = rest.slice(M_OPERATOR.length).trim();
  }
  // Delivery first: its prose may legitimately contain candidate arrows.
  let delivered: string | undefined;
  const dIdx = rest.indexOf(M_DELIVERED);
  if (dIdx !== -1) {
    delivered = rest.slice(dIdx + M_DELIVERED.length).trim() || undefined;
    rest = rest.slice(0, dIdx).trim();
  }
  let source: string | undefined;
  let candidate: string | undefined;
  const sIdx = rest.indexOf(M_SOURCE);
  if (sIdx !== -1) {
    let tail = rest.slice(sIdx + M_SOURCE.length).trim();
    rest = rest.slice(0, sIdx).trim();
    const cIdx = tail.indexOf(M_CANDIDATE);
    if (cIdx !== -1) {
      candidate = tail.slice(cIdx + M_CANDIDATE.length).trim() || undefined;
      tail = tail.slice(0, cIdx).trim();
    }
    source = tail || undefined;
  }
  return { operator, text: rest, source, candidate, delivered };
}

function renderLine(d: Delta): string {
  const at = new Date(d.created_at);
  const mm = String(at.getMonth() + 1).padStart(2, '0');
  const dd = String(at.getDate()).padStart(2, '0');
  const hh = String(at.getHours()).padStart(2, '0');
  const mi = String(at.getMinutes()).padStart(2, '0');
  const marker = d.created_by === 'operator' ? `${M_OPERATOR} ` : '';
  let s = `- [${mm}-${dd} ${hh}:${mi}] ${marker}${d.text}`;
  if (d.source !== undefined) s += `${M_SOURCE}${d.source}`;
  if (d.candidate !== undefined) s += `${M_CANDIDATE}${d.candidate}`;
  if (d.delivered !== undefined) {
    s += `${M_DELIVERED}${d.delivered.note ?? d.delivered.to}`;
  }
  return s;
}

/**
 * Resolve `MM-DD` against the current year.
 *
 * The ledger's timestamps carry no year — a real limitation of the
 * format, named here rather than hidden. A date later than today is read
 * as last year's, which is right for a backlog (deposits are in the past)
 * and wrong only for a clock-skewed future timestamp.
 */
function inferYear(mmdd: string, now: Date): number {
  const y = now.getFullYear();
  const todayMmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  return mmdd > todayMmdd ? y - 1 : y;
}

/** Stable, position-independent tie-break for same-minute deposits. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Domain caps a destination at 64 chars; the ledger's prose is unbounded. */
function truncateDest(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length <= 64 ? one : `${one.slice(0, 63)}…`;
}
