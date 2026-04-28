import YAML from 'yaml';
import { join } from 'node:path';
import { Request, StatusLogEntry, computeVersion } from '../../domain/request/Request.js';
import { RequestId } from '../../domain/request/RequestId.js';
import {
  RequestState,
  REQUEST_STATES,
  parseRequestState,
} from '../../domain/request/RequestState.js';
import { Review } from '../../domain/request/Review.js';
import { Thank } from '../../domain/request/Thank.js';
import { MemberName } from '../../domain/member/MemberName.js';
import {
  RequestRepository,
  RequestIdCollision,
  RequestVersionConflict,
} from '../../application/ports/RequestRepository.js';
import {
  MAX_DIR_ENTRIES,
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
      .slice(0, MAX_DIR_ENTRIES);
    const out: Request[] = [];
    for (const f of files) {
      const rel = join(state, f);
      const raw = readTextSafe(this.config.paths.requests, rel);
      const absSource = join(this.config.paths.requests, rel);
      const parsed = parseYamlSafe(raw, absSource, this.config.onMalformed);
      if (parsed === undefined) continue;
      const r = hydrate(parsed, state, absSource, this.config.onMalformed, this.config.lenses);
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

    // Defensive: save() is for updates. Fresh aggregates (loadedVersion=0,
    // meaning "never on disk") must go through saveNew() so the O_EXCL
    // create path catches collisions. Otherwise a misused call could
    // silently overwrite a file created by a concurrent saveNew.
    if (request.loadedVersion === 0) {
      throw new Error(
        `save() called on a freshly-created request ${id}; use saveNew() instead`,
      );
    }

    // 1. Scan every state dir; collect existing locations. A concurrent
    //    transition may have left stragglers under multiple dirs.
    const existing: Array<{ state: RequestState; rel: string; version: number }> = [];
    for (const state of REQUEST_STATES) {
      const rel = join(state, `${id}.yaml`);
      if (!existsSafe(this.config.paths.requests, rel)) continue;
      const raw = readTextSafe(this.config.paths.requests, rel);
      const absSource = join(this.config.paths.requests, rel);
      const parsed = parseYamlSafe(raw, absSource, this.config.onMalformed);
      const version = readVersion(parsed);
      existing.push({ state, rel, version });
    }

    // 2. Optimistic-lock check: the highest on-disk total mutation
    //    count (status_log.length + reviews.length) must equal the
    //    version we loaded. Using status_log alone would miss
    //    concurrent addReview races — two reviewers writing at once
    //    both touch reviews[] without growing status_log, so a
    //    status_log-only check would let one review silently vanish
    //    under last-writer-wins.
    const maxOnDisk = existing.reduce((m, e) => Math.max(m, e.version), 0);
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
 * Read the total mutation count from raw parsed YAML using the same
 * `computeVersion` invariant the domain uses. Defined here (not just
 * on Request) so the repository can compare on-disk state without
 * hydrating — a malformed or torn file returns 0, forcing the caller
 * to reload rather than proceed on incomplete data.
 */
function readVersion(parsed: unknown): number {
  if (!parsed || typeof parsed !== 'object') return 0;
  const obj = parsed as Record<string, unknown>;
  // Class invariant: every partial-skip rule in hydrate() must have
  // a matching filter here, or loadedVersion (from the hydrated
  // aggregate) drifts from maxOnDisk (from raw YAML) by exactly the
  // skipped count, throwing RequestVersionConflict on records nobody
  // else is touching. The status_log case was surfaced by `gate thank`
  // against a record carrying a legacy stateless row; the reviews
  // case is structurally identical (hydrate skips non-object review
  // entries silently) even though the loose-shape input is rare in
  // normal write paths. Both filtered for class closure rather than
  // single-instance fix.
  const isObjectEntry = (e: unknown): e is Record<string, unknown> =>
    e !== null && typeof e === 'object';
  const log = Array.isArray(obj['status_log'])
    ? (obj['status_log'] as unknown[]).filter(
        (e) => isObjectEntry(e) && typeof e['state'] === 'string',
      ).length
    : 0;
  const reviews = Array.isArray(obj['reviews'])
    ? (obj['reviews'] as unknown[]).filter(isObjectEntry).length
    : 0;
  const thanks = Array.isArray(obj['thanks'])
    ? (obj['thanks'] as unknown[]).filter(isObjectEntry).length
    : 0;
  return computeVersion(log, reviews, thanks);
}

/**
 * Deduplicate a list of Requests by id, keeping the newest
 * representation when the same id appears more than once (this can
 * happen under concurrent state transitions or review races where
 * listAll's per-state reads see a moving file).
 *
 * Tie-break order:
 *   1. Higher total mutation count (status_log + reviews) wins. Both
 *      arrays are append-only so the sum is a monotonic version
 *      across any legal mutation — transitions AND reviews.
 *   2. On equal version, later position in REQUEST_STATES wins. The
 *      ordering there (pending < approved < executing < completed <
 *      failed < denied) doesn't encode a total temporal order —
 *      failed/denied are divergent terminals — but for tiebreaker
 *      purposes it gives a stable, deterministic result.
 *
 * Pure and synchronous so it can be unit-tested independently of the
 * repository.
 */
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
    const rv = r.currentVersion;
    const ev = existing.currentVersion;
    if (rv > ev) {
      byId.set(r.id.value, r);
    } else if (rv === ev) {
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
        if (typeof ro['invoked_by'] === 'string')
          rc.invokedBy = ro['invoked_by'] as string;
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
        if (typeof so['invoked_by'] === 'string')
          entry.invokedBy = so['invoked_by'] as string;
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
    // Thanks are optional on disk — records written before the verb
    // existed simply lack the field, and that's fine.
    const thanksRaw = Array.isArray(obj['thanks'])
      ? (obj['thanks'] as unknown[])
      : [];
    const thanks: Thank[] = [];
    for (const t of thanksRaw) {
      if (t && typeof t === 'object') {
        const to = t as Record<string, unknown>;
        const tc: Parameters<typeof Thank.create>[0] = {
          by: String(to['by']),
          to: String(to['to']),
        };
        if (typeof to['at'] === 'string') tc.at = to['at'] as string;
        if (typeof to['reason'] === 'string') tc.reason = to['reason'] as string;
        if (typeof to['invoked_by'] === 'string') {
          tc.invokedBy = to['invoked_by'] as string;
        }
        thanks.push(Thank.create(tc));
      }
    }
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
    if (thanks.length > 0) props.thanks = thanks;
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
    if (Array.isArray(obj['with'])) {
      const partners: MemberName[] = [];
      for (const raw of obj['with'] as unknown[]) {
        if (typeof raw === 'string') partners.push(MemberName.of(raw));
      }
      if (partners.length > 0) props.with = partners;
    }
    if (typeof obj['promoted_from'] === 'string') {
      props.promotedFrom = obj['promoted_from'] as string;
    }
    // Legacy top-level closure keys (completion_note / deny_reason /
    // failure_reason) are no longer written separately — status_log[-1].note
    // is the single source of truth. Handle the three migration cases
    // explicitly so silent data loss is impossible:
    //   (a) log note present, top-level absent → normal; no-op
    //   (b) log note absent, top-level present → backfill
    //   (c) both present AND agreeing → normal; no-op
    //   (d) both present AND disagreeing → warn via onMalformed so the
    //       operator sees it in stderr and `gate doctor`, rather than
    //       a silent drop on next save.
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
      const topLevel = obj[legacyClosureKey] as string;
      if (last && last.state === state) {
        if (last.note === undefined) {
          // case (b): backfill so the new derivation surfaces it
          last.note = topLevel;
        } else if (last.note !== topLevel) {
          // case (d): legacy field and log disagree; surface loudly
          // since the next save() will emit only the log entry.
          onMalformed(
            source,
            `legacy top-level ${legacyClosureKey} disagrees with status_log[-1].note; the log entry wins on next save`,
          );
        }
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
