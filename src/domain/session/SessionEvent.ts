import { DomainError } from '../shared/DomainError.js';
import { MemberName } from '../member/MemberName.js';
import { sanitizeText } from '../shared/sanitizeText.js';

/**
 * Session-boundary event (#36 Phase 2 — time-aware verbs).
 *
 * Three boundary kinds the verb surface will eventually reach:
 *
 *   `rest`     — "I am putting this down now" (this PR).
 *   `wake`     — "I am picking it back up" (follow-up PR).
 *   `farewell` — "until next session" (follow-up PR; pairs with
 *                `gate resume`).
 *
 * Phase 2's first slice ships `rest` only. The domain enum carries
 * the full union from day one so the schema / repository / hydrate
 * paths don't need a breaking change when the other two land —
 * additive within the 0.x line per `docs/POLICY.md` § "Plugin
 * stability". Records with `kind: wake` / `kind: farewell` written
 * by a future version will still hydrate cleanly today (records-
 * outlive-writers, principle 04).
 *
 * Why a boundary record at all: agents (human or AI) accumulate
 * fatigue or context drift inside long sessions. Marking the
 * boundaries in-band lets downstream verbs (`tail`, `voices`,
 * `resume`) render the session with the boundaries visible, which
 * changes how the next reader experiences the history. The length
 * of a break is itself information, the way a commit timestamp is
 * information — explicit `rest`/`wake` pairs let `gate resume`
 * compute "you were away N hours" instead of "you last wrote N
 * hours ago, unclear whether intentional".
 *
 * Storage: `<content_root>/sessions/<id>.yaml`, one file per event,
 * id format `YYYY-MM-DD-NNN` (per-day sequence, mirroring the
 * issue / request id shape minus the `i-` prefix).
 */
export const SESSION_KINDS = ['rest', 'wake', 'farewell'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export function parseSessionKind(value: string): SessionKind {
  if ((SESSION_KINDS as readonly string[]).includes(value)) {
    return value as SessionKind;
  }
  throw new DomainError(
    `Invalid session kind: "${value}" — valid: ${SESSION_KINDS.join(', ')}`,
    'kind',
  );
}

const MAX_SESSION_NOTE = 240;

export interface SessionEventProps {
  readonly id: string;
  readonly kind: SessionKind;
  readonly by: MemberName;
  readonly at: string;
  readonly note?: string;
}

export interface CreateSessionEventInput {
  readonly id: string;
  readonly kind: SessionKind;
  readonly by: MemberName;
  readonly at: string;
  readonly note?: string;
}

/**
 * Aggregate root for a single boundary record. Immutable —
 * boundaries are facts about a moment in time; later corrections
 * are *new* records, not edits, mirroring the append-only stance
 * Request takes on its status_log.
 */
export class SessionEvent {
  private constructor(private readonly props: SessionEventProps) {}

  static create(input: CreateSessionEventInput): SessionEvent {
    if (!/^\d{4}-\d{2}-\d{2}-\d{3,4}$/.test(input.id)) {
      throw new DomainError(
        `Invalid session id: "${input.id}" — expected YYYY-MM-DD-NNN`,
        'id',
      );
    }
    if (!input.kind) {
      throw new DomainError('kind required', 'kind');
    }
    parseSessionKind(input.kind); // validates enum
    if (typeof input.at !== 'string' || input.at.length === 0) {
      throw new DomainError('at required (ISO 8601 timestamp)', 'at');
    }
    let note: string | undefined;
    if (input.note !== undefined) {
      const cleaned = sanitizeText(input.note, 'note', {
        maxLen: MAX_SESSION_NOTE,
        requireNonEmpty: false,
      });
      if (cleaned.length > 0) note = cleaned;
    }
    return new SessionEvent({
      id: input.id,
      kind: input.kind,
      by: input.by,
      at: input.at,
      ...(note !== undefined ? { note } : {}),
    });
  }

  /** Hydrate from a YAML record. Distinct from `create` because
   *  hydrate is permissive (records-outlive-writers): a future kind
   *  unknown to this binary should NOT throw. The caller passes the
   *  raw kind string and we accept any well-shaped value. */
  static restore(props: SessionEventProps): SessionEvent {
    return new SessionEvent({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get kind(): SessionKind {
    return this.props.kind;
  }
  get by(): MemberName {
    return this.props.by;
  }
  get at(): string {
    return this.props.at;
  }
  get note(): string | undefined {
    return this.props.note;
  }

  /**
   * Wire-format projection. Top-level keys are snake_case to match
   * the rest of the YAML surface (request, issue, agora play).
   * `note` is omitted when undefined so a boundary record without a
   * note round-trips byte-identically to a record where the field
   * is absent on disk.
   */
  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      id: this.props.id,
      kind: this.props.kind,
      by: this.props.by.value,
      at: this.props.at,
    };
    if (this.props.note !== undefined) out['note'] = this.props.note;
    return out;
  }
}
