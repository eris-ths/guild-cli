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

const ISSUE_ID_PATTERN = /^i-\d{4}-\d{2}-\d{2}-\d{3}$/;
const AREA_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_TEXT = 2048;

export class IssueId {
  private constructor(public readonly value: string) {}

  static of(raw: unknown): IssueId {
    if (typeof raw !== 'string' || !ISSUE_ID_PATTERN.test(raw)) {
      throw new DomainError(
        `Invalid issue id: "${String(raw)}". Expected i-YYYY-MM-DD-NNN`,
        'id',
      );
    }
    return new IssueId(raw);
  }

  static generate(today: Date, sequence: number): IssueId {
    if (!Number.isInteger(sequence) || sequence < 0 || sequence > 999) {
      throw new DomainError(`Invalid sequence: ${sequence}`, 'sequence');
    }
    const yyyy = today.getUTCFullYear().toString().padStart(4, '0');
    const mm = (today.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = today.getUTCDate().toString().padStart(2, '0');
    const seq = sequence.toString().padStart(3, '0');
    return new IssueId(`i-${yyyy}-${mm}-${dd}-${seq}`);
  }

  toString(): string {
    return this.value;
  }
}

export function parseIssueSeverity(value: string): IssueSeverity {
  if ((ISSUE_SEVERITIES as readonly string[]).includes(value)) {
    return value as IssueSeverity;
  }
  throw new DomainError(`Invalid severity: "${value}"`, 'severity');
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
