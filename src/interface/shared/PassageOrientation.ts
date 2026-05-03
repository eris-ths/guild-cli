import { GuildConfig } from '../../infrastructure/config/GuildConfig.js';

/**
 * Cross-passage orientation summary surfaced at the container's
 * primary orientation entry point (`gate boot`).
 *
 * Surfaced by the `cross-passage-orient` agora play
 * (develop substrate, 2026-05-03): a fresh instance booting on a
 * content_root with active agora plays or devil reviews previously
 * saw only gate's own activity, breaking the substrate-side
 * Zeigarnik continuity that agora's suspend/resume primitive
 * relies on. The fix is a registry seam: each passage publishes a
 * provider; gate boot polls them at runtime and presents the
 * non-null returns under `cross_passage`.
 *
 * Per `lore/principles/04-records-outlive-writers.md`, records
 * must outlive their writers. This adds the missing half: records
 * must also be **findable on re-entry**. Substrate that exists on
 * disk but isn't surfaced at orientation might as well be silent.
 *
 * Shape is intentionally normalized across passages so boot
 * consumers iterate uniformly. Per-passage detail (e.g. agora's
 * cliff/invitation prose) stays at each passage's own read verbs;
 * orientation only needs the count + recency cues that point an
 * agent at "where to look next".
 */
export interface PassageOrientationSummary {
  /** Passage name. Stable identifier; orchestrators key on this. */
  readonly passage: string;
  /**
   * Count of records in a non-terminal state. For agora: plays
   * where state ∈ {playing, suspended}. For devil: reviews where
   * state = open. Concluded / completed records do not contribute.
   */
  readonly open: number;
  /**
   * Subset of `open` that are paused awaiting re-entry. agora's
   * suspended plays; devil's reviews with an unmatched suspension.
   * Surfaced separately so a fresh instance immediately sees
   * "1 thread paused with cliff/invitation waiting" without
   * walking the records.
   */
  readonly suspended: number;
  /**
   * The most-recently-touched record's id, or null when the
   * passage has no records at all under the content_root.
   * "Most recent" follows each passage's own activity definition
   * (latest move / suspension / resume / entry / etc).
   */
  readonly last_id: string | null;
  /**
   * State of the record named by `last_id`. Free-form per passage
   * (agora: 'playing' | 'suspended' | 'concluded'; devil: 'open' |
   * 'concluded'). Null when `last_id` is null.
   */
  readonly last_state: string | null;
  /**
   * ISO timestamp of the most recent activity reflected in
   * `last_id`. Null when `last_id` is null.
   */
  readonly last_at: string | null;
}

/**
 * Provider contract. Each passage exports exactly one of these.
 * Boot calls every registered provider (in arbitrary order) and
 * includes the non-null returns under `cross_passage`.
 *
 * Returning null means "this passage has no records under this
 * content_root" — gate boot omits the entry. Empty passages
 * shouldn't pollute the envelope.
 *
 * Errors are caught at the boot layer; a misbehaving provider
 * does not break orientation. The contract is "best effort":
 * an exception is logged to stderr but the rest of boot proceeds.
 */
export type PassageOrientationProvider = (
  config: GuildConfig,
) => Promise<PassageOrientationSummary | null>;
