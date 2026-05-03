// devil-review — DevilReview (one review session, the aggregate root).
//
// State machine (v0 — minimal):
//
//   open ──── conclude ────▶ concluded (terminal)
//
// Per issue #126, devil-review's state surface is intentionally
// thinner than agora's Play. There is no `suspended` state because
// suspend/resume in this passage do not block other entries —
// reviewers can still add findings while a thread is "paused with
// a cliff." The suspend/resume cycle records re-entry context, not
// session lock. (See agora's Play for the contrasting design where
// suspend genuinely blocks moves.)
//
// Invariants:
//   - state='open'   iff conclusion === undefined
//   - state='concluded' iff conclusion !== undefined (terminal)
//   - entries are append-only when state='open'
//   - suspensions/resumes are append-only history; suspensions.length
//     >= resumes.length (the trailing suspension may not yet be
//     resumed, but this does not block entries)
//   - re_run_history is append-only (every ingest re-run logs here)
//   - all entry ids are unique within a review
//
// AI-first per principle 11:
//   - state on disk is derivable from conclusion presence; field
//     exists for read-convenience but the aggregate is the source
//   - suspend/resume use the same shape agora borrowed from gate
//     (cliff/invitation prose), so a re-entering instance reads
//     the substrate without learning a new vocabulary

import { DomainError } from '../../../domain/shared/DomainError.js';
import { Entry } from './Entry.js';

export type ReviewState = 'open' | 'concluded';

const VALID_STATES: ReadonlySet<ReviewState> = new Set(['open', 'concluded']);

export function parseReviewState(raw: unknown): ReviewState {
  if (typeof raw !== 'string' || !VALID_STATES.has(raw as ReviewState)) {
    throw new DomainError(
      `review state must be one of ${[...VALID_STATES].join(', ')}, got: ${String(raw)}`,
      'state',
    );
  }
  return raw as ReviewState;
}

/** Review id format: rev-YYYY-MM-DD-NNN. Mirrors agora's play id shape. */
const REVIEW_ID_PATTERN = /^rev-\d{4}-\d{2}-\d{2}-\d{3,4}$/;

export function parseReviewId(raw: unknown): string {
  if (typeof raw !== 'string' || !REVIEW_ID_PATTERN.test(raw)) {
    throw new DomainError(
      `review id must match rev-YYYY-MM-DD-NNN, got: ${String(raw)}`,
      'review_id',
    );
  }
  return raw;
}

export type TargetType = 'pr' | 'file' | 'function' | 'commit';

const VALID_TARGET_TYPES: ReadonlySet<TargetType> = new Set([
  'pr',
  'file',
  'function',
  'commit',
]);

export function parseTargetType(raw: unknown): TargetType {
  if (typeof raw !== 'string' || !VALID_TARGET_TYPES.has(raw as TargetType)) {
    throw new DomainError(
      `target type must be one of ${[...VALID_TARGET_TYPES].join(', ')}, got: ${String(raw)}`,
      'target.type',
    );
  }
  return raw as TargetType;
}

export interface Target {
  readonly type: TargetType;
  readonly ref: string; // github-pr-url, file path, function symbol, or commit sha
}

function parseTarget(raw: unknown): Target {
  if (raw === null || typeof raw !== 'object') {
    throw new DomainError('target must be an object', 'target');
  }
  const r = raw as Record<string, unknown>;
  const type = parseTargetType(r['type']);
  const ref = r['ref'];
  if (typeof ref !== 'string' || ref.trim().length === 0) {
    throw new DomainError('target.ref required (non-empty string)', 'target.ref');
  }
  return { type, ref: ref.trim() };
}

/**
 * One re-run log entry. Issue #126 calls out stochastic ingest
 * (every Claude Security run may surface different findings); the
 * substrate keeps the re-run history so a re-reader can tell
 * "this review was re-scanned 3 times" without inferring from the
 * entries timestamps.
 */
export interface ReRunHistoryEntry {
  readonly at: string;
  readonly by: string;
  readonly source: string; // 'ultrareview' | 'claude-security' | 'scg' | 'manual' | custom
}

function parseReRun(raw: unknown, idx: number): ReRunHistoryEntry {
  if (raw === null || typeof raw !== 'object') {
    throw new DomainError(
      `re_run_history[${idx}] must be an object`,
      're_run_history',
    );
  }
  const r = raw as Record<string, unknown>;
  const at = r['at'];
  const by = r['by'];
  const source = r['source'];
  if (typeof at !== 'string' || at.length === 0) {
    throw new DomainError(`re_run_history[${idx}].at required`, 're_run_history');
  }
  if (typeof by !== 'string' || by.trim().length === 0) {
    throw new DomainError(`re_run_history[${idx}].by required`, 're_run_history');
  }
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw new DomainError(
      `re_run_history[${idx}].source required (e.g. 'ultrareview', 'claude-security', 'scg', 'manual')`,
      're_run_history',
    );
  }
  return { at, by: by.trim(), source: source.trim() };
}

/**
 * Suspension / Resume — borrowed from agora's Play but the semantics
 * are softer here: the thread pauses with a cliff/invitation, but
 * other reviewers can still add entries. The cycle is re-entry
 * context, not session lock.
 */
export interface SuspensionEntry {
  readonly at: string;
  readonly by: string;
  readonly cliff: string;
  readonly invitation: string;
}

export interface ResumeEntry {
  readonly at: string;
  readonly by: string;
  readonly note?: string;
}

function parseSuspension(raw: unknown, idx: number): SuspensionEntry {
  if (raw === null || typeof raw !== 'object') {
    throw new DomainError(`suspensions[${idx}] must be an object`, 'suspensions');
  }
  const r = raw as Record<string, unknown>;
  const at = r['at'];
  const by = r['by'];
  const cliff = r['cliff'];
  const invitation = r['invitation'];
  if (typeof at !== 'string' || at.length === 0) {
    throw new DomainError(`suspensions[${idx}].at required`, 'suspensions');
  }
  if (typeof by !== 'string' || by.trim().length === 0) {
    throw new DomainError(`suspensions[${idx}].by required`, 'suspensions');
  }
  if (typeof cliff !== 'string' || cliff.trim().length === 0) {
    throw new DomainError(
      `suspensions[${idx}].cliff required (what just happened)`,
      'suspensions',
    );
  }
  if (typeof invitation !== 'string' || invitation.trim().length === 0) {
    throw new DomainError(
      `suspensions[${idx}].invitation required (what the next opener should do)`,
      'suspensions',
    );
  }
  return {
    at,
    by: by.trim(),
    cliff: cliff.trim(),
    invitation: invitation.trim(),
  };
}

function parseResume(raw: unknown, idx: number): ResumeEntry {
  if (raw === null || typeof raw !== 'object') {
    throw new DomainError(`resumes[${idx}] must be an object`, 'resumes');
  }
  const r = raw as Record<string, unknown>;
  const at = r['at'];
  const by = r['by'];
  const note = r['note'];
  if (typeof at !== 'string' || at.length === 0) {
    throw new DomainError(`resumes[${idx}].at required`, 'resumes');
  }
  if (typeof by !== 'string' || by.trim().length === 0) {
    throw new DomainError(`resumes[${idx}].by required`, 'resumes');
  }
  if (note !== undefined && (typeof note !== 'string' || note.trim().length === 0)) {
    throw new DomainError(
      `resumes[${idx}].note must be non-empty when present`,
      'resumes',
    );
  }
  return {
    at,
    by: by.trim(),
    ...(note !== undefined ? { note: (note as string).trim() } : {}),
  };
}

/**
 * Conclusion — synthesis prose plus a list of entry ids that remain
 * unresolved (open assumptions / resistance / open findings the
 * reviewer chose not to dismiss-or-resolve before concluding). The
 * unresolved list is the v0 way of saying "this review closed but
 * these threads are deliberately left open" — explicit rather than
 * derived from the entries' status fields.
 */
export interface Conclusion {
  readonly at: string;
  readonly by: string;
  readonly synthesis: string;
  readonly unresolved: readonly string[]; // entry ids
}

function parseConclusion(raw: unknown): Conclusion {
  if (raw === null || typeof raw !== 'object') {
    throw new DomainError('conclusion must be an object', 'conclusion');
  }
  const r = raw as Record<string, unknown>;
  const at = r['at'];
  const by = r['by'];
  const synthesis = r['synthesis'];
  const unresolvedRaw = r['unresolved'];
  if (typeof at !== 'string' || at.length === 0) {
    throw new DomainError('conclusion.at required', 'conclusion.at');
  }
  if (typeof by !== 'string' || by.trim().length === 0) {
    throw new DomainError('conclusion.by required', 'conclusion.by');
  }
  if (typeof synthesis !== 'string' || synthesis.trim().length === 0) {
    throw new DomainError(
      'conclusion.synthesis required (prose) — verdict-less close, but never empty',
      'conclusion.synthesis',
    );
  }
  if (!Array.isArray(unresolvedRaw)) {
    throw new DomainError('conclusion.unresolved must be an array', 'conclusion.unresolved');
  }
  const unresolved: string[] = [];
  for (const u of unresolvedRaw) {
    if (typeof u !== 'string') {
      throw new DomainError(
        'conclusion.unresolved entries must be entry ids (strings)',
        'conclusion.unresolved',
      );
    }
    unresolved.push(u);
  }
  return {
    at,
    by: by.trim(),
    synthesis: synthesis.trim(),
    unresolved,
  };
}

export interface DevilReviewProps {
  readonly id: string;
  readonly target: Target;
  readonly state: ReviewState;
  readonly opened_at: string;
  readonly opened_by: string;
  readonly entries: readonly Entry[];
  readonly suspensions: readonly SuspensionEntry[];
  readonly resumes: readonly ResumeEntry[];
  readonly re_run_history: readonly ReRunHistoryEntry[];
  readonly conclusion?: Conclusion;
}

export class DevilReview {
  readonly id: string;
  readonly target: Target;
  readonly state: ReviewState;
  readonly opened_at: string;
  readonly opened_by: string;
  readonly entries: readonly Entry[];
  readonly suspensions: readonly SuspensionEntry[];
  readonly resumes: readonly ResumeEntry[];
  readonly re_run_history: readonly ReRunHistoryEntry[];
  readonly conclusion?: Conclusion;

  private constructor(props: DevilReviewProps) {
    this.id = props.id;
    this.target = props.target;
    this.state = props.state;
    this.opened_at = props.opened_at;
    this.opened_by = props.opened_by;
    this.entries = props.entries;
    this.suspensions = props.suspensions;
    this.resumes = props.resumes;
    this.re_run_history = props.re_run_history;
    if (props.conclusion !== undefined) this.conclusion = props.conclusion;
  }

  static open(input: {
    id: string;
    target: Target;
    opened_by: string;
    now?: () => Date;
  }): DevilReview {
    const id = parseReviewId(input.id);
    const target = parseTarget(input.target);
    if (
      typeof input.opened_by !== 'string' ||
      input.opened_by.trim().length === 0
    ) {
      throw new DomainError('opened_by required (non-empty string)', 'opened_by');
    }
    const opened_at = (input.now ?? (() => new Date()))().toISOString();
    return new DevilReview({
      id,
      target,
      state: 'open',
      opened_at,
      opened_by: input.opened_by.trim(),
      entries: [],
      suspensions: [],
      resumes: [],
      re_run_history: [],
    });
  }

  static restore(props: DevilReviewProps): DevilReview {
    const id = parseReviewId(props.id);
    const target = parseTarget(props.target);
    const state = parseReviewState(props.state);
    if (typeof props.opened_at !== 'string' || props.opened_at.length === 0) {
      throw new DomainError('opened_at required', 'opened_at');
    }
    if (typeof props.opened_by !== 'string' || props.opened_by.trim().length === 0) {
      throw new DomainError('opened_by required', 'opened_by');
    }
    const entries: Entry[] = [];
    const seenIds = new Set<string>();
    for (const e of props.entries) {
      // `e` may be a raw object on restore from disk; route through Entry.restore
      // so its own validators run. If already an Entry instance, re-validate
      // by going through restore on its toJSON output (idempotent).
      const entry =
        e instanceof Entry ? Entry.restore(e.toJSON()) : Entry.restore(e);
      if (seenIds.has(entry.id)) {
        throw new DomainError(`duplicate entry id: ${entry.id}`, 'entries');
      }
      seenIds.add(entry.id);
      entries.push(entry);
    }
    const suspensions: SuspensionEntry[] = [];
    if (Array.isArray(props.suspensions)) {
      props.suspensions.forEach((s, i) => suspensions.push(parseSuspension(s, i)));
    }
    const resumes: ResumeEntry[] = [];
    if (Array.isArray(props.resumes)) {
      props.resumes.forEach((r, i) => resumes.push(parseResume(r, i)));
    }
    if (resumes.length > suspensions.length) {
      throw new DomainError(
        `resumes (${resumes.length}) cannot exceed suspensions (${suspensions.length})`,
        'resumes',
      );
    }
    const re_run_history: ReRunHistoryEntry[] = [];
    if (Array.isArray(props.re_run_history)) {
      props.re_run_history.forEach((r, i) =>
        re_run_history.push(parseReRun(r, i)),
      );
    }
    let conclusion: Conclusion | undefined;
    if (props.conclusion !== undefined) {
      conclusion = parseConclusion(props.conclusion);
    }
    // State must match conclusion presence — this is the load-bearing
    // invariant. A file with state='concluded' but no conclusion (or
    // vice versa) is a substrate error, fail closed.
    if (state === 'concluded' && conclusion === undefined) {
      throw new DomainError(
        "state='concluded' but no conclusion present",
        'conclusion',
      );
    }
    if (state === 'open' && conclusion !== undefined) {
      throw new DomainError(
        "state='open' but conclusion present",
        'conclusion',
      );
    }
    return new DevilReview({
      id,
      target,
      state,
      opened_at: props.opened_at,
      opened_by: props.opened_by.trim(),
      entries,
      suspensions,
      resumes,
      re_run_history,
      ...(conclusion !== undefined ? { conclusion } : {}),
    });
  }

  /**
   * Are we currently mid-suspension (last suspension not yet resumed)?
   * Doesn't block entries — just informational (e.g., for show output).
   */
  get isSuspended(): boolean {
    return this.suspensions.length === this.resumes.length + 1;
  }

  /** Find an entry by id; null if absent. */
  findEntry(id: string): Entry | null {
    for (const e of this.entries) {
      if (e.id === id) return e;
    }
    return null;
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      id: this.id,
      target: { type: this.target.type, ref: this.target.ref },
      state: this.state,
      opened_at: this.opened_at,
      opened_by: this.opened_by,
      entries: this.entries.map((e) => e.toJSON()),
    };
    if (this.suspensions.length > 0) {
      out['suspensions'] = this.suspensions.map((s) => ({ ...s }));
    }
    if (this.resumes.length > 0) {
      out['resumes'] = this.resumes.map((r) => ({ ...r }));
    }
    if (this.re_run_history.length > 0) {
      out['re_run_history'] = this.re_run_history.map((r) => ({ ...r }));
    }
    if (this.conclusion !== undefined) {
      out['conclusion'] = {
        at: this.conclusion.at,
        by: this.conclusion.by,
        synthesis: this.conclusion.synthesis,
        unresolved: [...this.conclusion.unresolved],
      };
    }
    return out;
  }
}

// --- Aggregate-level errors (state-machine refusals, lookups) -----------

export class DevilReviewIdCollision extends Error {
  constructor(id: string) {
    super(`DevilReview id already exists: ${id}`);
    this.name = 'DevilReviewIdCollision';
  }
}

export class DevilReviewNotFound extends Error {
  constructor(id: string) {
    super(`DevilReview "${id}" not found`);
    this.name = 'DevilReviewNotFound';
  }
}

export class DevilReviewAlreadyConcluded extends Error {
  constructor(readonly id: string) {
    super(
      `DevilReview ${id} is already concluded — terminal state, no further entries / suspensions / resumes / re-runs.`,
    );
    this.name = 'DevilReviewAlreadyConcluded';
  }
}

/**
 * Optimistic-lock conflict on append. Same shape as Play's version
 * conflict — the expected count is what the caller loaded; the
 * actual count is what's on disk now. Concurrent ingest / entry
 * appends surface this rather than silently overwrite.
 */
export class DevilReviewVersionConflict extends Error {
  readonly code = 'DEVIL_REVIEW_VERSION_CONFLICT' as const;
  constructor(
    readonly id: string,
    readonly field: 'entries' | 'suspensions' | 'resumes' | 're_run_history',
    readonly expected: number,
    readonly found: number,
  ) {
    super(
      `DevilReview ${id} changed on disk (expected ${field} count ${expected}, found ${found}); reload and retry`,
    );
    this.name = 'DevilReviewVersionConflict';
  }
}
