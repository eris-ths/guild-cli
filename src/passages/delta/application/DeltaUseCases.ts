import {
  Delta,
  DeltaState,
  nextDeltaId,
  parseDeltaDestination,
  parseDeltaId,
} from '../domain/Delta.js';
import { DeltaRepository } from './DeltaRepository.js';

/** Raised when `deliver` names an id that has no record. */
export class DeltaNotFound extends Error {
  constructor(public readonly id: string) {
    super(`no delta record: ${id}`);
    this.name = 'DeltaNotFound';
  }
}

export interface DeltaListFilter {
  /** `pending` (default) / `delivered` / `all`. */
  readonly state?: DeltaState | 'all';
  readonly by?: string;
  /** Exact destination match; only meaningful for delivered records. */
  readonly to?: string;
}

/**
 * Delta use cases — deposit, route, read back.
 *
 * The shape deliberately has no "route everything" verb. Deciding where
 * each deposit belongs is a judgment, and a judgment is what `gate`
 * records; a CLI that auto-filed deposits would be making that judgment
 * silently and leaving no trace of who made it. So the passage offers
 * `list` (here is what is outstanding) and `deliver` (this one went
 * there, and I am on the record saying so).
 */
export class DeltaUseCases {
  constructor(
    private readonly repo: DeltaRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Deposit a conclusion that has not been filed anywhere yet.
   *
   * Only `text` and `by` are required. `source` and `candidate` are
   * optional on purpose — a deposit surface that demands classification
   * costs the writer the context they were in, which is the exact cost
   * this passage exists to avoid.
   */
  async add(input: {
    by: string;
    text: string;
    source?: string | undefined;
    candidate?: string | undefined;
  }): Promise<Delta> {
    const now = this.now();
    const existing = await this.repo.listAllIds();
    const id = nextDeltaId(existing, now);
    const delta = Delta.create({
      id,
      created_by: input.by,
      text: input.text,
      source: input.source,
      candidate: input.candidate,
      now: () => now,
    });
    await this.repo.saveNew(delta);
    return delta;
  }

  /**
   * Record that a deposit reached a destination.
   *
   * Refuses an unknown id (a delivery pointing at nothing would claim
   * work that has no record) and, via the domain, refuses a second
   * delivery on the same deposit.
   */
  async deliver(input: {
    id: string;
    to: string;
    by: string;
    note?: string | undefined;
  }): Promise<Delta> {
    const id = parseDeltaId(input.id);
    const to = parseDeltaDestination(input.to);
    const found = await this.repo.findById(id);
    if (found === null) throw new DeltaNotFound(id);
    const now = this.now();
    const delivered = found.markDelivered({
      to,
      by: input.by,
      note: input.note,
      now: () => now,
    });
    await this.repo.save(delivered);
    return delivered;
  }

  async find(id: string): Promise<Delta | null> {
    return await this.repo.findById(parseDeltaId(id));
  }

  /**
   * Read deposits back, oldest first.
   *
   * ⚠️ The order is the opposite of `ctx list` (newest first), and the
   * difference is deliberate rather than an inconsistency: a fact list is
   * read to see the current state, so the newest matters most; a deposit
   * list is read to *clear a backlog*, and the oldest item is the one
   * that has been waiting longest. Sorting newest-first would push the
   * most-neglected deposit off the bottom of the screen — the same
   * failure mode as a cliff list that silently truncates the oldest
   * letters.
   */
  async list(filter: DeltaListFilter = {}): Promise<readonly Delta[]> {
    const state = filter.state ?? 'pending';
    const all = await this.repo.listAll();
    const out = all.filter((d) => {
      if (state !== 'all' && d.state !== state) return false;
      if (filter.by !== undefined && d.created_by !== filter.by) return false;
      if (filter.to !== undefined && d.delivered?.to !== filter.to) return false;
      return true;
    });
    return [...out].sort((a, b) =>
      a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1,
    );
  }

  /**
   * Backlog shape: how many are outstanding, and how long the oldest has
   * been waiting. Exists because a count alone does not say whether a
   * backlog is healthy — 12 deposits from today is a busy session, 12
   * from six weeks ago is a passage nobody is draining.
   */
  async pendingSummary(): Promise<{
    readonly count: number;
    readonly oldest: Delta | null;
  }> {
    const pending = await this.list({ state: 'pending' });
    return { count: pending.length, oldest: pending[0] ?? null };
  }
}
