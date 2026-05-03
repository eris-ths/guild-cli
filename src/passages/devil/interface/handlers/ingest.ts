import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  DevilReviewAlreadyConcluded,
  DevilReviewNotFound,
  ReRunHistoryEntry,
  parseReviewId,
} from '../../domain/DevilReview.js';
import {
  Entry,
  EntryKind,
  GateStage,
  Severity,
  parseSeverity,
} from '../../domain/Entry.js';
import { LenseNotFound } from '../../domain/Lense.js';
import { PersonaNotFound } from '../../domain/Persona.js';
import { DevilReviewRepository } from '../../application/DevilReviewRepository.js';
import { LenseCatalog } from '../../application/LenseCatalog.js';
import { PersonaCatalog } from '../../application/PersonaCatalog.js';
import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';
import { DomainError } from '../../../../domain/shared/DomainError.js';

const INGEST_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'from',
  'by',
  'format',
]);

/**
 * devil ingest — append entries from an automated source's output.
 *
 * Usage:
 *   devil ingest <rev-id> --from <source> <input-path>
 *                         [--by <m>] [--format json|text]
 *
 * <source> is one of: ultrareview | claude-security | scg.
 * <input-path> is positional 2 — path to a JSON file in the
 * source-specific shape documented below.
 *
 * Each source attributes its entries to its matching ingest-only
 * persona (ultrareview-fleet / claude-security / scg-supply-chain-gate).
 * `devil entry` refuses to use those personas; only this verb may.
 *
 * Each invocation logs to re_run_history so a re-reader sees how
 * many times the source was re-scanned (Claude Security in
 * particular is stochastic-by-design — re-runs surface different
 * findings; the substrate keeps that history).
 *
 * Strict input shapes (v0; real adapters mapping actual
 * /ultrareview / Claude Security / SCG output to these shapes can
 * be built as separate utilities):
 *
 *   ultrareview:
 *     {
 *       "source": "ultrareview",
 *       "version": "1",
 *       "bugs": [
 *         {
 *           "lense": "<one of the catalog lenses>",
 *           "title": "<short>",
 *           "details": "<long>",
 *           "severity": "critical|high|medium|low|info",
 *           "rationale": "<exploitability rationale>"
 *         },
 *         ...
 *       ]
 *     }
 *
 *   claude-security:
 *     {
 *       "source": "claude-security",
 *       "version": "1",
 *       "findings": [
 *         {
 *           "lense": "<catalog lense matching the Claude Security category>",
 *           "title": "<short>",
 *           "details": "<long>",
 *           "severity": "high|medium|low",
 *           "rationale": "<exploitability rationale>"
 *         },
 *         ...
 *       ]
 *     }
 *
 *   scg:
 *     {
 *       "source": "scg",
 *       "version": "1",
 *       "verdict": "CLEAR|HIGH|CRITICAL",
 *       "stages": [
 *         { "name": "<stage name>", "verdict": "<per-stage verdict>", "reasoning": "<prose>" },
 *         ...
 *       ]
 *     }
 *
 * SCG produces ONE entry of kind=gate on the supply-chain lense
 * with the 8 stages embedded. ultrareview / claude-security
 * produce N entries of kind=finding, one per bug/finding.
 *
 * Per principle 11: optimistic CAS via appendEntry on each new
 * entry, plus appendReRun on the source invocation itself.
 */

type IngestSource = 'ultrareview' | 'claude-security' | 'scg';
const VALID_SOURCES: ReadonlySet<IngestSource> = new Set([
  'ultrareview',
  'claude-security',
  'scg',
]);

/**
 * Probe whether a command is available on PATH. Used by the SCG
 * mandatory-delegate check (#126 decision C, fixes e-001 from the
 * post-merge devil-on-devil dogfood). The check ensures that the
 * "supply-chain lense delegates to SCG" claim in the design doc
 * is enforced at runtime, not just documented — without it, a
 * reviewer can fabricate a CLEAR verdict JSON and satisfy the
 * lense gate without SCG ever running.
 *
 * Cross-platform: `which` on POSIX, `where` on Windows. Both
 * return exit-code 0 iff the command is on PATH.
 */
function isCommandAvailable(cmd: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(probe, [cmd], { stdio: 'ignore' });
  return r.status === 0;
}

const SOURCE_TO_PERSONA: Record<IngestSource, string> = {
  ultrareview: 'ultrareview-fleet',
  'claude-security': 'claude-security',
  scg: 'scg-supply-chain-gate',
};

export interface IngestDeps {
  readonly reviews: DevilReviewRepository;
  readonly lenses: LenseCatalog;
  readonly personas: PersonaCatalog;
  readonly config: GuildConfig;
}

export async function ingestSource(
  deps: IngestDeps,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, INGEST_KNOWN_FLAGS, 'ingest');

  const reviewId = args.positional[0];
  const inputPath = args.positional[1];
  if (!reviewId || !inputPath) {
    process.stderr.write(
      'error: positional <rev-id> AND <input-path> required.\n' +
        '  Usage: devil ingest <rev-id> --from <ultrareview|claude-security|scg> <input-path> [--by <m>]\n',
    );
    return 1;
  }
  parseReviewId(reviewId);

  const sourceRaw = requireOption(
    args,
    'from',
    '--from required (one of: ultrareview | claude-security | scg)',
  );
  if (!VALID_SOURCES.has(sourceRaw as IngestSource)) {
    process.stderr.write(
      `error: --from must be one of ${[...VALID_SOURCES].join(' | ')}, got: ${sourceRaw}\n`,
    );
    return 1;
  }
  const source = sourceRaw as IngestSource;

  // Mandatory-delegate runtime check (#126 decision C, fixes e-001).
  // The supply-chain lense's "mandatory delegate to SCG" was
  // documented but not enforced — reviewers could fabricate a CLEAR
  // verdict JSON and satisfy the lense gate without SCG running.
  // We now refuse `--from scg` if scg is not on PATH; production
  // ingest pipelines are expected to run SCG and pipe its output,
  // so the binary's presence is the operator-wired contract.
  if (source === 'scg' && !isCommandAvailable('scg')) {
    process.stderr.write(
      `error: --from scg requires the supply-chain-guard 'scg' command on PATH ` +
        `(mandatory delegate per #126 decision C; fixes e-001 from devil-on-devil dogfood).\n` +
        `  install: https://github.com/eris-ths/supply-chain-guard\n` +
        `  if scg is installed but not on PATH, add its install dir to PATH and re-run.\n`,
    );
    return 1;
  }

  const by = optionalOption(args, 'by') ?? process.env['GUILD_ACTOR'];
  if (!by) {
    process.stderr.write(
      'error: --by required (or set GUILD_ACTOR). devil ingest attributes the ingest invocation.\n',
    );
    return 1;
  }
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    process.stderr.write(`error: --format must be 'json' or 'text', got: ${format}\n`);
    return 1;
  }

  // Read + parse input.
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(inputPath, 'utf8'));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`error: failed to read/parse <${inputPath}>: ${msg}\n`);
    return 1;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    process.stderr.write(`error: <${inputPath}>: top-level JSON must be an object\n`);
    return 1;
  }
  const root = raw as Record<string, unknown>;
  if (root['source'] !== source) {
    process.stderr.write(
      `error: <${inputPath}>: source field is '${String(root['source'])}', expected '${source}' (matching --from)\n`,
    );
    return 1;
  }
  if (root['version'] !== '1') {
    process.stderr.write(
      `error: <${inputPath}>: only version='1' is supported in v0, got: ${String(root['version'])}\n`,
    );
    return 1;
  }

  // Resolve review and ingest persona.
  const review = await deps.reviews.findById(reviewId);
  if (!review) throw new DevilReviewNotFound(reviewId);
  if (review.state === 'concluded') {
    throw new DevilReviewAlreadyConcluded(review.id);
  }

  const personaName = SOURCE_TO_PERSONA[source];
  const persona = deps.personas.find(personaName);
  if (!persona) throw new PersonaNotFound(personaName);
  if (!persona.ingest_only) {
    // Defensive — if the catalog ever gets reshaped so the source's
    // persona isn't ingest-only, refuse rather than silently
    // attribute through a hand-rolled persona.
    throw new DomainError(
      `Persona '${personaName}' (mapped to source ${source}) is not ingest_only; ingest path requires ingest-only persona.`,
      'persona',
    );
  }

  // Build entries from the source-specific shape, then append. Each
  // append uses the running entries.length so concurrent appends
  // surface correctly.
  let runningCount = review.entries.length;
  const ingested: Entry[] = [];
  try {
    const entries = buildEntriesForSource(source, root, by, persona.name, deps.lenses);
    for (const e of entries) {
      const entryId = `e-${String(runningCount + 1).padStart(3, '0')}`;
      const realised = withId(e, entryId);
      await deps.reviews.appendEntry(review, runningCount, realised);
      runningCount += 1;
      ingested.push(realised);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`error: ingest from ${source}: ${msg}\n`);
    return 1;
  }

  // Log the re-run.
  const reRun: ReRunHistoryEntry = {
    at: new Date().toISOString(),
    by,
    source,
  };
  await deps.reviews.appendReRun(review, review.re_run_history.length, reRun);

  const where_written = deps.reviews.pathFor(review.id);

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          review_id: review.id,
          source,
          ingested_count: ingested.length,
          ingested_entry_ids: ingested.map((e) => e.id),
          re_run_index: review.re_run_history.length,
          where_written,
          config_file: deps.config.configFile,
          suggested_next: {
            verb: 'show',
            args: { review_id: review.id },
            reason:
              'Ingest complete. Show the review to read the new entries; deliberation continues with hand-rolled red-team / author-defender / mirror entries on top of the ingested findings.',
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      `✓ ingested ${ingested.length} entr${ingested.length === 1 ? 'y' : 'ies'} from ${source} into ${review.id} by ${by}\n` +
        (ingested.length > 0
          ? `  ids: ${ingested.map((e) => e.id).join(', ')}\n`
          : '') +
        `  next: devil show ${review.id}  (read the ingested findings)\n` +
        `        or devil entry ${review.id} --persona <p> ...  (deliberate on top)\n`,
    );
  }
  return 0;
}

// ---- source adapters -----------------------------------------------------

/**
 * Returns Entry instances WITHOUT id assigned — caller fills the id
 * post-load using the running entries.length sequence. Lense
 * presence is validated against the catalog up front so a malformed
 * input fails closed before any append.
 */
function buildEntriesForSource(
  source: IngestSource,
  root: Record<string, unknown>,
  by: string,
  persona: string,
  lenses: LenseCatalog,
): Entry[] {
  const at = new Date().toISOString();
  switch (source) {
    case 'ultrareview':
      return parseUltrareview(root, at, by, persona, lenses);
    case 'claude-security':
      return parseClaudeSecurity(root, at, by, persona, lenses);
    case 'scg':
      return parseScg(root, at, by, persona, lenses);
  }
}

function parseUltrareview(
  root: Record<string, unknown>,
  at: string,
  by: string,
  persona: string,
  lenses: LenseCatalog,
): Entry[] {
  const bugs = root['bugs'];
  if (!Array.isArray(bugs)) {
    throw new DomainError("ultrareview input: 'bugs' must be an array", 'bugs');
  }
  return bugs.map((b, i) => {
    if (b === null || typeof b !== 'object') {
      throw new DomainError(`ultrareview bugs[${i}]: must be an object`, 'bugs');
    }
    const bug = b as Record<string, unknown>;
    return Entry.create({
      id: 'e-001', // placeholder — caller swaps via withId
      at,
      by,
      persona,
      lense: requireKnownLense(bug['lense'], `ultrareview bugs[${i}]`, lenses),
      kind: 'finding',
      text: requireString(bug, 'details', `ultrareview bugs[${i}]`),
      severity: parseSeverity(bug['severity']),
      severity_rationale: requireString(bug, 'rationale', `ultrareview bugs[${i}]`),
      status: 'open',
    });
  });
}

function parseClaudeSecurity(
  root: Record<string, unknown>,
  at: string,
  by: string,
  persona: string,
  lenses: LenseCatalog,
): Entry[] {
  const findings = root['findings'];
  if (!Array.isArray(findings)) {
    throw new DomainError("claude-security input: 'findings' must be an array", 'findings');
  }
  return findings.map((f, i) => {
    if (f === null || typeof f !== 'object') {
      throw new DomainError(`claude-security findings[${i}]: must be an object`, 'findings');
    }
    const finding = f as Record<string, unknown>;
    const sev = finding['severity'];
    // Claude Security uses high|medium|low; coerce to the broader
    // devil enum (no critical/info from Claude Security per docs).
    const severity: Severity =
      sev === 'high' ? 'high' :
      sev === 'medium' ? 'medium' :
      sev === 'low' ? 'low' :
      // accept critical / info if a future Claude Security version emits them
      parseSeverity(sev);
    return Entry.create({
      id: 'e-001',
      at,
      by,
      persona,
      lense: requireKnownLense(finding['lense'], `claude-security findings[${i}]`, lenses),
      kind: 'finding',
      text: requireString(finding, 'details', `claude-security findings[${i}]`),
      severity,
      severity_rationale: requireString(finding, 'rationale', `claude-security findings[${i}]`),
      status: 'open',
    });
  });
}

function parseScg(
  root: Record<string, unknown>,
  at: string,
  by: string,
  persona: string,
  lenses: LenseCatalog,
): Entry[] {
  // SCG produces ONE entry of kind=gate on the supply-chain lense.
  const verdict = root['verdict'];
  const stagesRaw = root['stages'];
  if (typeof verdict !== 'string' || verdict.trim().length === 0) {
    throw new DomainError("scg input: 'verdict' required (CLEAR | HIGH | CRITICAL)", 'verdict');
  }
  if (!Array.isArray(stagesRaw) || stagesRaw.length === 0) {
    throw new DomainError("scg input: 'stages' must be a non-empty array", 'stages');
  }
  const stages: GateStage[] = stagesRaw.map((s, i) => {
    if (s === null || typeof s !== 'object') {
      throw new DomainError(`scg stages[${i}]: must be an object`, 'stages');
    }
    const r = s as Record<string, unknown>;
    return {
      name: requireString(r, 'name', `scg stages[${i}]`),
      verdict: requireString(r, 'verdict', `scg stages[${i}]`),
      reasoning: requireString(r, 'reasoning', `scg stages[${i}]`),
    };
  });
  // Validate supply-chain is in the catalog (it should be — bundled
  // default — but defensive against future content_root override
  // that drops it).
  if (!lenses.find('supply-chain')) {
    throw new DomainError(
      "scg ingest requires the 'supply-chain' lense in the catalog (the mandatory delegate target per #126)",
      'lense',
    );
  }
  return [
    Entry.create({
      id: 'e-001',
      at,
      by,
      persona,
      lense: 'supply-chain',
      kind: 'gate',
      text: `SCG verdict: ${verdict}`,
      stages,
    }),
  ];
}

// ---- helpers -------------------------------------------------------------

function requireString(
  obj: Record<string, unknown>,
  key: string,
  ctx: string,
): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new DomainError(`${ctx}: '${key}' required (non-empty string)`, key);
  }
  return v;
}

function requireKnownLense(
  raw: unknown,
  ctx: string,
  lenses: LenseCatalog,
): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new DomainError(`${ctx}: 'lense' required (non-empty string)`, 'lense');
  }
  if (!lenses.find(raw)) {
    throw new LenseNotFound(raw);
  }
  return raw;
}

/** Build a copy of `entry` with its id replaced. Entry is immutable. */
function withId(entry: Entry, newId: string): Entry {
  // We re-run Entry.create with the same fields and the new id so
  // validation runs again (idempotent — values that passed once will
  // pass again). Cheaper than a copy constructor and exercises the
  // domain validators a second time as a safety net.
  const json = entry.toJSON();
  return Entry.restore({ ...json, id: newId });
}
