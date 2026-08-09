// delta — Deposit (a conclusion that has not reached any axis yet).
//
// delta is the fifth passage under guild (after gate / agora / devil / ctx).
// The boundary with its neighbours is what the passage is *for*:
//
//   gate   — judgment (who decided what, and why)
//   agora  — exploration (a play still in motion; nothing settled)
//   devil  — defense (what breaks)
//   ctx    — fact (an observation that has landed)
//   delta  — **deposit**: settled, but not yet filed anywhere
//
// The distinction from agora is the one that matters in practice: an
// agora play is suspended because the *thinking* is unfinished; a delta
// is deposited because the thinking is finished and only the *filing*
// is outstanding. Conflating them costs a reader the ability to tell
// "we don't know yet" from "we know and haven't written it down".
//
// Why a passage at all: the deposit surface must stay cheaper than the
// thing it interrupts. If depositing requires choosing a destination,
// the writer has already left the task they were doing — so `add` takes
// prose and nothing mandatory. Routing happens later, in one pass, via
// `deliver`.
//
// AI-first per principle 11:
//   - validation at construction; tampered YAML fails closed at restore
//   - explicit snake_case fields, empty ones omitted (byte-stable YAML)
//   - the delivery record is append-only in spirit: `delivered` is
//     written once and refused on a second call (see markDelivered)

import { DomainError } from '../../../domain/shared/DomainError.js';

/**
 * Delta id — `delta-YYYY-MM-DD-NNN`.
 *
 * Same shape as ctx (`ctx-YYYY-MM-DD-NNN`) so the ledger stays
 * grep-able by passage prefix.
 */
const DELTA_ID_PATTERN = /^delta-\d{4}-\d{2}-\d{2}-\d{3}$/;

export function parseDeltaId(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new DomainError(`delta id must be a string, got: ${typeof raw}`, 'id');
  }
  if (!DELTA_ID_PATTERN.test(raw)) {
    throw new DomainError(
      `delta id must match ${DELTA_ID_PATTERN.source}, got: ${raw}`,
      'id',
    );
  }
  return raw;
}

/**
 * Delivery destination — free-form, deliberately unvalidated beyond
 * shape.
 *
 * A closed vocabulary was considered and rejected: destinations are
 * whatever the *operator's* workflow contains (another passage, an
 * external tracker, a document), and a CLI that only accepts its own
 * passage names would push every real destination into a note field
 * where it stops being queryable. Shape is enforced (non-empty, single
 * line, bounded) so `list --to` stays a usable filter.
 */
const DEST_MAX = 64;

export function parseDeltaDestination(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new DomainError(`destination must be a string, got: ${typeof raw}`, 'to');
  }
  const v = raw.trim();
  if (v.length === 0) {
    throw new DomainError('destination required (non-empty string)', 'to');
  }
  if (v.length > DEST_MAX) {
    throw new DomainError(
      `destination must be ${DEST_MAX} chars or fewer, got ${v.length}`,
      'to',
    );
  }
  if (v.includes('\n')) {
    throw new DomainError('destination must be a single line', 'to');
  }
  return v;
}

export type DeltaState = 'pending' | 'delivered';

export interface DeltaDelivery {
  readonly to: string;
  readonly at: string; // ISO timestamp
  readonly by: string;
  readonly note: string | undefined;
}

export interface DeltaProps {
  readonly id: string;
  readonly created_at: string; // ISO timestamp
  readonly created_by: string; // member or host name
  readonly text: string; // non-empty prose — the deposit itself
  // Where the deposit came from (a conversation, `gate:<id>`, `file:line`).
  // Optional: requiring it would raise the cost of depositing, which is
  // the one thing this passage must not do.
  readonly source: string | undefined;
  // A *guess* at where this should go. Explicitly not validated against
  // any vocabulary and explicitly not binding on `deliver` — it exists so
  // a writer who already knows can say so without being forced to decide.
  readonly candidate: string | undefined;
  readonly delivered: DeltaDelivery | undefined;
}

export class Delta {
  readonly id: string;
  readonly created_at: string;
  readonly created_by: string;
  readonly text: string;
  readonly source: string | undefined;
  readonly candidate: string | undefined;
  readonly delivered: DeltaDelivery | undefined;

  private constructor(props: DeltaProps) {
    this.id = props.id;
    this.created_at = props.created_at;
    this.created_by = props.created_by;
    this.text = props.text;
    this.source = props.source;
    this.candidate = props.candidate;
    this.delivered = props.delivered;
  }

  get state(): DeltaState {
    return this.delivered === undefined ? 'pending' : 'delivered';
  }

  static create(input: {
    id: string;
    text: string;
    created_by: string;
    source?: string | undefined;
    candidate?: string | undefined;
    now?: () => Date;
  }): Delta {
    const id = parseDeltaId(input.id);
    const text = requireProse(input.text, 'text');
    const created_by = requireProse(input.created_by, 'created_by');
    const created_at = (input.now ?? (() => new Date()))().toISOString();
    return new Delta({
      id,
      created_at,
      created_by,
      text,
      source: optionalProse(input.source, 'source'),
      candidate: optionalProse(input.candidate, 'candidate'),
      delivered: undefined,
    });
  }

  /**
   * Restore from on-disk YAML. Same validation as create — a tampered
   * file fails closed at the boundary.
   */
  static restore(input: DeltaProps): Delta {
    return new Delta({
      id: parseDeltaId(input.id),
      created_at: input.created_at,
      created_by: input.created_by,
      text: input.text,
      source: input.source,
      candidate: input.candidate,
      delivered: input.delivered === undefined ? undefined : restoreDelivery(input.delivered),
    });
  }

  /**
   * Record that this deposit reached a destination.
   *
   * Returns a NEW Delta (the receiver is not mutated) and refuses a
   * second delivery: a deposit reaches an axis once, and overwriting
   * the first delivery would erase where it actually went. Re-routing
   * is a new deposit that cites this one, not an edit of this record.
   */
  markDelivered(input: {
    to: string;
    by: string;
    note?: string | undefined;
    now?: () => Date;
  }): Delta {
    if (this.delivered !== undefined) {
      throw new DomainError(
        `${this.id} was already delivered to '${this.delivered.to}' at ${this.delivered.at}`,
        'delivered',
      );
    }
    return new Delta({
      id: this.id,
      created_at: this.created_at,
      created_by: this.created_by,
      text: this.text,
      source: this.source,
      candidate: this.candidate,
      delivered: {
        to: parseDeltaDestination(input.to),
        by: requireProse(input.by, 'by'),
        at: (input.now ?? (() => new Date()))().toISOString(),
        note: optionalProse(input.note, 'note'),
      },
    });
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      id: this.id,
      created_at: this.created_at,
      created_by: this.created_by,
      text: this.text,
    };
    // byte-stable YAML: omit empty fields entirely so a minimal deposit
    // round-trips unchanged and diffs stay small.
    if (this.source !== undefined) out['source'] = this.source;
    if (this.candidate !== undefined) out['candidate'] = this.candidate;
    if (this.delivered !== undefined) {
      const d: Record<string, unknown> = {
        to: this.delivered.to,
        at: this.delivered.at,
        by: this.delivered.by,
      };
      if (this.delivered.note !== undefined) d['note'] = this.delivered.note;
      out['delivered'] = d;
    }
    return out;
  }
}

function requireProse(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new DomainError(`${field} required (non-empty string)`, field);
  }
  return raw.trim();
}

function optionalProse(raw: unknown, field: string): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') {
    throw new DomainError(`${field} must be a string, got: ${typeof raw}`, field);
  }
  const v = raw.trim();
  return v.length === 0 ? undefined : v;
}

function restoreDelivery(raw: DeltaDelivery): DeltaDelivery {
  if (typeof raw !== 'object' || raw === null) {
    throw new DomainError('delivered must be a mapping', 'delivered');
  }
  return {
    to: parseDeltaDestination(raw.to),
    at: requireProse(raw.at, 'delivered.at'),
    by: requireProse(raw.by, 'delivered.by'),
    note: optionalProse(raw.note, 'delivered.note'),
  };
}

export class DeltaIdCollision extends Error {
  constructor(id: string) {
    super(`Delta id already exists: ${id}`);
    this.name = 'DeltaIdCollision';
  }
}

/**
 * Allocate a fresh `delta-YYYY-MM-DD-NNN` id, scanning the current
 * day's existing ids and choosing the next free 3-digit slot.
 *
 * Pure function — caller hands in the existing-ids list and `now`,
 * we deterministically pick the next id. Repository owns the listing.
 */
export function nextDeltaId(existing: readonly string[], now: Date): string {
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const prefix = `delta-${date}-`;
  const used = new Set<number>();
  for (const id of existing) {
    if (id.startsWith(prefix)) {
      const n = Number.parseInt(id.slice(prefix.length), 10);
      if (Number.isInteger(n)) used.add(n);
    }
  }
  for (let n = 1; n <= 999; n++) {
    if (!used.has(n)) return `${prefix}${String(n).padStart(3, '0')}`;
  }
  throw new DomainError(
    `delta id exhausted for ${date} (>999 deposits). A day that deposits 999 ` +
      `times is telling you the deposit bar is too low, not that the id space is.`,
    'id',
  );
}
