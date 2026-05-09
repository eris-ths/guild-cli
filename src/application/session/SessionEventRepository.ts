import type { SessionEvent } from '../../domain/session/SessionEvent.js';

/**
 * Storage port for session-boundary records (#36 Phase 2).
 *
 * Mirrors the per-event YAML pattern other passages use:
 *   - `nextSequence(dateKey)` — allocate the next per-day sequence
 *     so callers can construct a `YYYY-MM-DD-NNN` id without
 *     scanning the directory themselves.
 *   - `save(event)` — write one file per event, id-keyed.
 *   - `listAll()` — read every record (used by `gate boot` /
 *     `gate resume` integration in follow-up PRs; not yet wired
 *     in this PR).
 */
export interface SessionEventRepository {
  nextSequence(dateKey: string): Promise<number>;
  save(event: SessionEvent): Promise<void>;
  listAll(): Promise<readonly SessionEvent[]>;
}
