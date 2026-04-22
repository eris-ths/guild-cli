import { MemberName } from '../member/MemberName.js';
import { DomainError } from '../shared/DomainError.js';
import { sanitizeText as sharedSanitizeText } from '../shared/sanitizeText.js';

export const ISSUE_SEVERITIES = ['low', 'med', 'high', 'critical'] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export const ISSUE_STATES = [
  'open',
  'in_progress',
  'deferred',
  'resolved',
] as const;
export type IssueState = (typeof ISSUE_STATES)[number];

/**
 * Issue state transition rules. Unlike Request (strict linear DAG),
 * Issue has three "working" states that freely interconvert, plus
 * `resolved` which is terminal-but-recoverable:
 *   - open / in_progress / deferred can move to each other and to resolved
 *   - resolved can only move to open (via `reopen`)
 *
 * Same-state transitions are rejected so double-resolve etc. surface as
 * programming errors rather than silent no-ops.
 */
const ISSUE_TRANSITIONS: Record<IssueState, readonly IssueState[]> = {
  open: ['in_progress', 'deferred', 'resolved'],
  in_progress: ['open', 'deferred', 'resolved'],
  deferred: ['open', 'in_progress', 'resolved'],
  resolved: ['open'],
};

export function canTransitionIssue(
  from: IssueState,
  to: IssueState,
): boolean {
  return ISSUE_TRANSITIONS[from].includes(to);
}

export function assertIssueTransition(
  from: IssueState,
  to: IssueState,
): void {
  if (!canTransitionIssue(from, to)) {
    throw new DomainError(
      `Invalid issue transition: ${from} → ${to}`,
      'state',
    );
  }
}

// Accepts both 3- and 4-digit sequences for backward compatibility
// (see RequestId.ts for rationale). Generation produces 4 digits.
const ISSUE_ID_PATTERN = /^i-\d{4}-\d{2}-\d{2}-\d{3,4}$/;
const AREA_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_TEXT = 2048;

export class IssueId {
  private constructor(public readonly value: string) {}

  static of(raw: unknown): IssueId {
    if (typeof raw !== 'string' || !ISSUE_ID_PATTERN.test(raw)) {
      throw new DomainError(
        `Invalid issue id: "${String(raw)}". Expected i-YYYY-MM-DD-NNNN (or legacy NNN)`,
        'id',
      );
    }
    return new IssueId(raw);
  }

  static generate(today: Date, sequence: number): IssueId {
    if (!Number.isInteger(sequence) || sequence < 0 || sequence > 9999) {
      throw new DomainError(`Invalid sequence: ${sequence}`, 'sequence');
    }
    const yyyy = today.getUTCFullYear().toString().padStart(4, '0');
    const mm = (today.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = today.getUTCDate().toString().padStart(2, '0');
    const seq = sequence.toString().padStart(4, '0');
    return new IssueId(`i-${yyyy}-${mm}-${dd}-${seq}`);
  }

  toString(): string {
    return this.value;
  }
}

/**
 * Common aliases mapped to canonical severities. Interface-layer
 * convenience: users coming from Jira/Linear/GitHub reach for
 * `medium` / `mid` / `crit` / `hi` before `med` / `critical` / `high`.
 * The canonical set (`low | med | high | critical`) is unchanged;
 * aliases are normalized on input so the domain invariant is
 * preserved. Matching is case-insensitive after trim.
 */
const SEVERITY_ALIASES: Record<string, IssueSeverity> = {
  medium: 'med',
  mid: 'med',
  m: 'med',
  lo: 'low',
  l: 'low',
  hi: 'high',
  h: 'high',
  crit: 'critical',
  c: 'critical',
};

export function parseIssueSeverity(value: string): IssueSeverity {
  const normalized = value.trim().toLowerCase();
  if ((ISSUE_SEVERITIES as readonly string[]).includes(normalized)) {
    return normalized as IssueSeverity;
  }
  const aliased = SEVERITY_ALIASES[normalized];
  if (aliased !== undefined) {
    return aliased;
  }
  throw new DomainError(
    [
      `Invalid severity: "${value}"`,
      `  canonical values: ${ISSUE_SEVERITIES.join(', ')}`,
      `  aliases:`,
      `    low      ← lo, l`,
      `    med      ← medium, mid, m`,
      `    high     ← hi, h`,
      `    critical ← crit, c`,
      `  (case-insensitive, whitespace trimmed)`,
    ].join('\n'),
    'severity',
  );
}

export function parseIssueState(value: string): IssueState {
  if ((ISSUE_STATES as readonly string[]).includes(value)) {
    return value as IssueState;
  }
  throw new DomainError(`Invalid issue state: "${value}"`, 'state');
}

function parseArea(value: string): string {
  if (!AREA_PATTERN.test(value)) {
    throw new DomainError(
      `Invalid area: "${value}". Must match /^[a-z][a-z0-9_-]{0,31}$/`,
      'area',
    );
  }
  return value;
}

function sanitizeText(raw: unknown, field: string): string {
  return sharedSanitizeText(raw, field, { maxLen: MAX_TEXT });
}

/**
 * An append-only annotation on an existing issue. Notes exist because
 * the original `text`, `severity`, and `area` fields are immutable by
 * design (Two-Persona Devil: the earlier frame of the problem is
 * preserved, not overwritten). But the *understanding* of an issue
 * evolves — severity re-evaluations, cross-references to related
 * issues, a "I tried this and it didn't repro" follow-up. Without a
 * notes mechanism those updates have to spawn a whole new issue that
 * references the old one, which is heavy and fragments the audit
 * trail.
 *
 * Notes are strictly additive: the tool exposes no edit or delete.
 * `invokedBy` mirrors the status_log / review field: stamped only
 * when GUILD_ACTOR differs from the nominal `by`, so same-actor
 * notes stay byte-identical to pre-invariant records.
 */
export interface IssueNote {
  by: string;
  text: string;
  at: string;
  invokedBy?: string;
}

const MAX_NOTES = 50;
const MAX_STATE_LOG = 100;

/**
 * One entry in an issue's state history. Each transition (open → resolved,
 * resolved → open, etc.) appends one of these so the audit trail records
 * both what changed and who changed it.
 *
 * Mirrors the `status_log` entry shape on Request (same fields: state,
 * by, at, invoked_by) to keep the cross-entity mental model consistent.
 * The difference is that Request's log covers create-through-terminal
 * while Issue's covers only re-transitions after create (the create
 * event itself is implicit in `createdAt` + `from`).
 */
export interface IssueStateLogEntry {
  state: IssueState;
  by: string;
  at: string;
  invokedBy?: string;
}

export interface IssueProps {
  id: IssueId;
  from: MemberName;
  severity: IssueSeverity;
  area: string;
  text: string;
  state: IssueState;
  createdAt: string;
  /** Optional — historical YAML pre-dates notes; restore backfills []. */
  notes?: IssueNote[];
  /**
   * Optional — historical YAML pre-dates state_log; restore backfills
   * []. Every `setState` call appends one entry, so the length of this
   * array is the number of transitions the issue has taken since
   * creation. The create event is implicit (not in the log).
   */
  stateLog?: IssueStateLogEntry[];
  /** See IssueNote.invokedBy — same invariant on the creation act. */
  invokedBy?: string;
}

export class Issue {
  private constructor(private props: IssueProps) {}

  static create(input: {
    id: IssueId;
    from: string;
    severity: string;
    area: string;
    text: string;
    createdAt?: string;
    invokedBy?: string;
  }): Issue {
    const from = MemberName.of(input.from);
    const props: IssueProps = {
      id: input.id,
      from,
      severity: parseIssueSeverity(input.severity),
      area: parseArea(input.area),
      text: sanitizeText(input.text, 'text'),
      state: 'open',
      createdAt: input.createdAt ?? new Date().toISOString(),
      notes: [],
      stateLog: [],
    };
    if (
      input.invokedBy !== undefined &&
      input.invokedBy !== from.value
    ) {
      props.invokedBy = input.invokedBy;
    }
    return new Issue(props);
  }

  /**
   * Restore an Issue from persisted props without re-validating state
   * transitions. The invariant is: whatever is on disk is historical
   * truth. Transition rules only apply to *new* transitions made by
   * setState after restoration. If a persisted issue is in an invalid
   * state, the operator must fix the YAML by hand.
   */
  static restore(props: IssueProps): Issue {
    // Older on-disk issues have no `notes` or `state_log` arrays.
    // Treat missing as empty so hydration of historical YAML keeps
    // working. The missing state_log on legacy issues means their
    // pre-upgrade transitions are lost — historical by design.
    return new Issue({
      ...props,
      notes: props.notes ?? [],
      stateLog: props.stateLog ?? [],
    });
  }

  get id(): IssueId {
    return this.props.id;
  }
  get state(): IssueState {
    return this.props.state;
  }
  get from(): MemberName {
    return this.props.from;
  }
  get text(): string {
    return this.props.text;
  }

  setState(next: IssueState, by: string, invokedBy?: string): void {
    assertIssueTransition(this.props.state, next);
    const byName = MemberName.of(by).value;
    this.props.state = next;
    if (!this.props.stateLog) this.props.stateLog = [];
    if (this.props.stateLog.length >= MAX_STATE_LOG) {
      throw new DomainError(
        `Too many state transitions on ${this.props.id.value} (max ${MAX_STATE_LOG})`,
        'state_log',
      );
    }
    const entry: IssueStateLogEntry = {
      state: next,
      by: byName,
      at: new Date().toISOString(),
    };
    if (invokedBy !== undefined && invokedBy !== byName) {
      entry.invokedBy = invokedBy;
    }
    this.props.stateLog.push(entry);
  }

  get notes(): readonly IssueNote[] {
    return this.props.notes ?? [];
  }

  get stateLog(): readonly IssueStateLogEntry[] {
    return this.props.stateLog ?? [];
  }

  addNote(
    by: string,
    text: string,
    at?: string,
    invokedBy?: string,
  ): IssueNote {
    // `notes` is optional on IssueProps so historical YAML can restore
    // without an explicit empty array; lazily initialize on first add.
    if (!this.props.notes) this.props.notes = [];
    if (this.props.notes.length >= MAX_NOTES) {
      throw new DomainError(
        `Too many notes on ${this.props.id.value} (max ${MAX_NOTES})`,
        'notes',
      );
    }
    const byName = MemberName.of(by).value;
    const note: IssueNote = {
      by: byName,
      text: sanitizeText(text, 'note'),
      at: at ?? new Date().toISOString(),
    };
    if (invokedBy !== undefined && invokedBy !== byName) {
      note.invokedBy = invokedBy;
    }
    this.props.notes.push(note);
    return note;
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      id: this.props.id.value,
      from: this.props.from.value,
      severity: this.props.severity,
      area: this.props.area,
      text: this.props.text,
      state: this.props.state,
      created_at: this.props.createdAt,
    };
    if (this.props.invokedBy !== undefined) {
      out['invoked_by'] = this.props.invokedBy;
    }
    // Backward compat: omit the `notes` / `state_log` keys when empty
    // so pre-notes / pre-audit YAML stays byte-identical after a
    // round-trip through restore/save.
    const notes = this.props.notes;
    if (notes && notes.length > 0) {
      out['notes'] = notes.map((n) => noteToJSON(n));
    }
    const stateLog = this.props.stateLog;
    if (stateLog && stateLog.length > 0) {
      out['state_log'] = stateLog.map((e) => stateLogEntryToJSON(e));
    }
    return out;
  }
}

function stateLogEntryToJSON(e: IssueStateLogEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {
    state: e.state,
    by: e.by,
    at: e.at,
  };
  if (e.invokedBy !== undefined) out['invoked_by'] = e.invokedBy;
  return out;
}

/**
 * Wire-format projection of an IssueNote. `invokedBy` in memory →
 * `invoked_by` on disk, matching the snake_case convention used by
 * status_log / reviews. Only emitted when present.
 */
function noteToJSON(n: IssueNote): Record<string, unknown> {
  const out: Record<string, unknown> = {
    by: n.by,
    text: n.text,
    at: n.at,
  };
  if (n.invokedBy !== undefined) out['invoked_by'] = n.invokedBy;
  return out;
}
