import YAML from 'yaml';
import { join } from 'node:path';
import { Request, StatusLogEntry } from '../../domain/request/Request.js';
import { RequestId } from '../../domain/request/RequestId.js';
import {
  RequestState,
  REQUEST_STATES,
  parseRequestState,
} from '../../domain/request/RequestState.js';
import { Review } from '../../domain/request/Review.js';
import { MemberName } from '../../domain/member/MemberName.js';
import {
  RequestRepository,
  RequestIdCollision,
  RequestVersionConflict,
} from '../../application/ports/RequestRepository.js';
import {
  existsSafe,
  listDirSafe,
  readTextSafe,
  writeTextSafe,
  writeTextSafeAtomic,
  unlinkSafe,
} from './safeFs.js';
import { GuildConfig } from '../config/GuildConfig.js';
import { OnMalformed } from '../../application/ports/OnMalformed.js';
import { parseYamlSafe } from './parseYamlSafe.js';

/**
 * Layout: <paths.requests>/<state>/<id>.yaml
 * Save writes to the request's current state dir; if the state has changed
 * since the file was loaded the old file is moved to the new dir.
 */
export class YamlRequestRepository implements RequestRepository {
  constructor(private readonly config: GuildConfig) {}

  async findById(id: RequestId): Promise<Request | null> {
    // Scan every state dir so a file mid-transition (present under two
    // dirs between atomic-write and old-file-unlink) is still found,
    // and dedupe picks the newer representation by status_log length.
    const found: Request[] = [];
    for (const state of REQUEST_STATES) {
      const rel = join(state, `${id.value}.yaml`);
      if (!existsSafe(this.config.paths.requests, rel)) continue;
      const raw = readTextSafe(this.config.paths.requests, rel);
      const absSource = join(this.config.paths.requests, rel);
      const parsed = parseYamlSafe(raw, absSource, this.config.onMalformed);
      if (parsed === undefined) continue;
      const r = hydrate(parsed, state, absSource, this.config.onMalformed, this.config.lenses);
      if (r) found.push(r);
    }
    if (found.length === 0) return null;
    if (found.length === 1) return found[0]!;
    return dedupeRequestsById(found)[0] ?? null;
  }

  async listByState(state: RequestState): Promise<Request[]> {
    const files = listDirSafe(this.config.paths.requests, state)
      .filter((f) => /^\d{4}-\d{2}-\d{2}-\d{3,4}\.yaml$/.test(f))
      .slice(0, 1000);
    const out: Request[] = [];
    for (const f of files) {
      const rel = join(state, f);
      const raw = readTextSafe(this.config.paths.requests, rel);
      const absSource = join(this.config.paths.requests, rel);
      const parsed = parseYamlSafe(raw, absSource, this.config.onMalformed);
      if (parsed === undefined) continue;
      const r = hydrate(parsed, state, absSource, this.config.onMalformed);
      if (r) out.push(r);
    }
    return out;
  }

  async listAll(): Promise<Request[]> {
    // Read every state directory in parallel. This minimizes (but
    // cannot eliminate) the TOCTOU window in which a concurrent
    // transition could move a file between directories. Collisions
    // are resolved by dedupeRequestsById — pure, unit-tested.
    const perState = await Promise.all(
      REQUEST_STATES.map((state) => this.listByState(state)),
    );
    return dedupeRequestsById(perState.flat());
  }

  async saveNew(request: Request): Promise<void> {
    // Refuse to create a file that already exists under ANY state dir.
    for (const state of REQUEST_STATES) {
      const rel = join(state, `${request.id.value}.yaml`);
      if (existsSafe(this.config.paths.requests, rel)) {
        throw new RequestIdCollision(request.id.value);
      }
    }
    const rel = join(request.state, `${request.id.value}.yaml`);
    const text = YAML.stringify(request.toJSON());
    try {
      writeTextSafe(this.config.paths.requests, rel, text, {
        createOnly: true,
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new RequestIdCollision(request.id.value);
      }
      throw e;
    }
  }

  async save(request: Request): Promise<void> {
    const id = request.id.value;
    const newState = request.state;
    const newRel = join(newState, `${id}.yaml`);

    // 1. Scan every state dir; collect existing locations. A concurrent
    //    transition may have left stragglers under multiple dirs.
    const existing: Array<{ state: RequestState; rel: string; logLen: number }> = [];
    for (const state of REQUEST_STATES) {
      const rel = join(state, `${id}.yaml`);
      if (!existsSafe(this.config.paths.requests, rel)) continue;
      const raw = readTextSafe(this.config.paths.requests, rel);
      const absSource = join(this.config.paths.requests, rel);
      const parsed = parseYamlSafe(raw, absSource, this.config.onMalformed);
      const logLen = countStatusLogEntries(parsed);
      existing.push({ state, rel, logLen });
    }

    // 2. Optimistic-lock check: the highest on-disk status_log length
    //    must equal the version we loaded (request.loadedVersion). If
    //    someone else transitioned in the meantime, refuse the write.
    //    loadedVersion === 0 means the aggregate was freshly created
    //    and save() was called on it — that path should go through
    //    saveNew(); treat any existing file as a conflict.
    const maxOnDisk = existing.reduce((m, e) => Math.max(m, e.logLen), 0);
    if (maxOnDisk !== request.loadedVersion) {
      throw new RequestVersionConflict(
        id,
        request.loadedVersion,
        maxOnDisk,
      );
    }

    // 3. Atomic write of the new content to the new state dir. The
    //    .tmp-*+rename keeps readers from ever seeing a torn file.
    const text = YAML.stringify(request.toJSON());
    writeTextSafeAtomic(this.config.paths.requests, newRel, text);

    // 4. Remove leftover files from any state dir that isn't the new
    //    one. Done AFTER the atomic write so a crash between steps 3
    //    and 4 leaves the newer file in place; findById's dedupe
    //    returns it deterministically (longer status_log wins).
    for (const e of existing) {
      if (e.state === newState) continue;
      unlinkSafe(this.config.paths.requests, e.rel);
    }
  }

  async nextSequence(dateKey: string): Promise<number> {
    let max = 0;
    for (const state of REQUEST_STATES) {
      const files = listDirSafe(this.config.paths.requests, state);
      for (const f of files) {
        const m = f.match(/^(\d{4}-\d{2}-\d{2})-(\d{3,4})\.yaml$/);
        if (m && m[1] === dateKey) {
          const n = parseInt(m[2] as string, 10);
          if (n > max) max = n;
        }
      }
    }
    return max + 1;
  }
}

/**
 * Deduplicate a list of Requests by id, keeping the newest
 * representation when the same id appears more than once (this can
 * happen under concurrent state transitions where listAll's per-state
 * reads race with a moving file).
 *
 * Tie-break order:
 *   1. More status_log entries wins. status_log is append-only, so a
 *      representation with more entries is strictly newer in time.
 *   2. On equal log length, later position in REQUEST_STATES wins.
 *      The ordering there (pending < approved < executing < completed
 *      < failed < denied) doesn't encode a total temporal order —
 *      failed/denied are divergent terminals — but for tiebreaker
 *      purposes it gives a stable, deterministic result.
 *
 * Pure and synchronous so it can be unit-tested independently of the
 * repository.
 */
/**
 * Count status_log entries from raw parsed YAML. Used by the optimistic
 * lock in save(): a torn or unparseable file returns 0, which correctly
 * signals "unknown on-disk version" and forces the caller to reload.
 */
function countStatusLogEntries(parsed: unknown): number {
  if (!parsed || typeof parsed !== 'object') return 0;
  const log = (parsed as Record<string, unknown>)['status_log'];
  if (!Array.isArray(log)) return 0;
  return log.length;
}

export function dedupeRequestsById(
  requests: ReadonlyArray<Request>,
): Request[] {
  const byId = new Map<string, Request>();
  for (const r of requests) {
    const existing = byId.get(r.id.value);
    if (!existing) {
      byId.set(r.id.value, r);
      continue;
    }
    if (r.statusLog.length > existing.statusLog.length) {
      byId.set(r.id.value, r);
    } else if (r.statusLog.length === existing.statusLog.length) {
      const newRank = REQUEST_STATES.indexOf(r.state);
      const oldRank = REQUEST_STATES.indexOf(existing.state);
      if (newRank > oldRank) byId.set(r.id.value, r);
    }
  }
  return Array.from(byId.values());
}

function hydrate(
  data: unknown,
  stateHint: RequestState | undefined,
  source: string,
  onMalformed: OnMalformed,
  allowedLenses?: readonly string[],
): Request | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    onMalformed(source, 'top-level YAML is not a mapping; skipping');
    return null;
  }
  const obj = data as Record<string, unknown>;
  try {
    const id = RequestId.of(obj['id']);
    const state =
      typeof obj['state'] === 'string'
        ? parseRequestState(obj['state'])
        : stateHint !== undefined
          ? stateHint
          : parseRequestState('pending');
    const reviewsRaw = Array.isArray(obj['reviews'])
      ? (obj['reviews'] as unknown[])
      : [];
    const reviews: Review[] = [];
    for (const r of reviewsRaw) {
      if (r && typeof r === 'object') {
        const ro = r as Record<string, unknown>;
        const rc: Parameters<typeof Review.create>[0] = {
          by: String(ro['by']),
          lense: String(ro['lense']),
          verdict: String(ro['verdict']),
          comment: String(ro['comment'] ?? ''),
        };
        if (typeof ro['at'] === 'string') rc.at = ro['at'] as string;
        // Hydrate with config lenses so custom lenses in saved data are accepted
        if (allowedLenses) rc.allowedLenses = allowedLenses;
        reviews.push(Review.create(rc));
      }
    }
    const statusLogRaw = Array.isArray(obj['status_log'])
      ? (obj['status_log'] as unknown[])
      : [];
    const statusLog: StatusLogEntry[] = [];
    for (let i = 0; i < statusLogRaw.length; i++) {
      const s = statusLogRaw[i];
      if (!s || typeof s !== 'object') continue;
      const so = s as Record<string, unknown>;
      // Legacy entries may omit `state` (e.g., review notes). Skip them
      // rather than failing the whole request — they are known-benign.
      if (typeof so['state'] !== 'string') continue;
      try {
        const entry: StatusLogEntry = {
          state: parseRequestState(so['state']),
          by: String(so['by'] ?? 'unknown'),
          at: String(so['at'] ?? new Date().toISOString()),
        };
        if (typeof so['note'] === 'string') entry.note = so['note'] as string;
        statusLog.push(entry);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        onMalformed(
          source,
          `dropping status_log[${i}] (state="${String(so['state'])}"): ${msg}`,
        );
      }
    }
    const createdAt =
      typeof obj['created_at'] === 'string'
        ? (obj['created_at'] as string)
        : typeof obj['created'] === 'string'
          ? (obj['created'] as string)
          : new Date().toISOString();
    const action = String(obj['action'] ?? '(no action)').trim() || '(no action)';
    const reason = String(obj['reason'] ?? '(no reason)').trim() || '(no reason)';
    const props: Parameters<typeof Request.restore>[0] = {
      id,
      from: MemberName.of(obj['from']),
      action,
      reason,
      state,
      createdAt,
      reviews,
      statusLog,
    };
    const executorRaw =
      typeof obj['executor'] === 'string'
        ? (obj['executor'] as string)
        : typeof obj['executor_actual'] === 'string'
          ? (obj['executor_actual'] as string)
          : typeof obj['executor_preferred'] === 'string'
            ? (obj['executor_preferred'] as string)
            : undefined;
    if (executorRaw !== undefined)
      props.executor = MemberName.of(executorRaw);
    if (typeof obj['auto_review'] === 'string')
      props.autoReview = MemberName.of(obj['auto_review']);
    if (typeof obj['target'] === 'string') props.target = obj['target'] as string;
    // Legacy backfill: if an older file has the top-level closure key
    // but the matching status_log entry has no note (shouldn't happen
    // with code that wrote both, but defends against hand-edited YAML),
    // copy it onto the last log entry so the new single-source derivation
    // still shows the closure note.
    const legacyClosureKey =
      state === 'completed'
        ? 'completion_note'
        : state === 'denied'
          ? 'deny_reason'
          : state === 'failed'
            ? 'failure_reason'
            : undefined;
    if (legacyClosureKey && typeof obj[legacyClosureKey] === 'string') {
      const last = statusLog[statusLog.length - 1];
      if (last && last.state === state && last.note === undefined) {
        last.note = obj[legacyClosureKey] as string;
      }
    }
    return Request.restore(props);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const idHint =
      typeof obj['id'] === 'string' ? ` (id=${obj['id']})` : '';
    onMalformed(
      source,
      `hydrate failed${idHint}, skipping record: ${msg}`,
    );
    return null;
  }
}
