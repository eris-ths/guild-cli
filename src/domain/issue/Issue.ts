import { MemberName } from '../member/MemberName.js';
import { DomainError } from '../shared/DomainError.js';

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
  if (typeof raw !== 'string') {
    throw new DomainError(`${field} must be a string`, field);
  }
  const cleaned = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  if (!cleaned) {
    throw new DomainError(`${field} required`, field);
  }
  if (cleaned.length > MAX_TEXT) {
    throw new DomainError(`${field} too long (max ${MAX_TEXT})`, field);
  }
  return cleaned;
}

export interface IssueProps {
  id: IssueId;
  from: MemberName;
  severity: IssueSeverity;
  area: string;
  text: string;
  state: IssueState;
  createdAt: string;
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
  }): Issue {
    return new Issue({
      id: input.id,
      from: MemberName.of(input.from),
      severity: parseIssueSeverity(input.severity),
      area: parseArea(input.area),
      text: sanitizeText(input.text, 'text'),
      state: 'open',
      createdAt: input.createdAt ?? new Date().toISOString(),
    });
  }

  /**
   * Restore an Issue from persisted props without re-validating state
   * transitions. The invariant is: whatever is on disk is historical
   * truth. Transition rules only apply to *new* transitions made by
   * setState after restoration. If a persisted issue is in an invalid
   * state, the operator must fix the YAML by hand.
   */
  static restore(props: IssueProps): Issue {
    return new Issue({ ...props });
  }

  get id(): IssueId {
    return this.props.id;
  }
  get state(): IssueState {
    return this.props.state;
  }

  setState(next: IssueState): void {
    assertIssueTransition(this.props.state, next);
    this.props.state = next;
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.props.id.value,
      from: this.props.from.value,
      severity: this.props.severity,
      area: this.props.area,
      text: this.props.text,
      state: this.props.state,
      created_at: this.props.createdAt,
    };
  }
}
