// guildLock — content-root-wide single-writer lock primitive.
//
// Design lineage: issue #155 (Noir/Devil ratified). Acts as a coarse
// write-side mutex for write-classified verbs across all four passage
// entries (gate / agora / devil / ctx) so that two concurrently
// invoked CLIs cannot interleave writes onto the same content root.
//
// Mechanism: O_CREAT|O_EXCL ('wx') on `${contentRoot}/.guild-lock`.
// Holder writes JSON metadata into the file, runs `fn`, and unlinks
// in `finally`. A competing acquire fails with EEXIST and surfaces
// as `LockBusyError` (DomainError subclass → `lock_busy` JSON code).
//
// Stale reclaim (PR-A + PR-B + follow-up cluster): on EEXIST we
// `readHolder` and dispatch on a discriminated union:
//   - `'gone'`   → the file vanished between EEXIST and readFile
//                  (release race, #197). One retry of openExclusive.
//   - `'corrupt'`→ file exists but is unparseable (#195). Treated as
//                  stale: unlink + retry. Recovery cost is low — the
//                  next caller writes fresh metadata. Realistic only
//                  under power-loss mid-write or hand-edit, since
//                  openExclusive itself cleans up partial writes.
//   - `'present'`→ normal path. Reclaim if ANY of:
//        1. `lock.started_at` predates the current OS boot (reboot
//           crossed → the recorded pid cannot be the same process as
//           the holder, even if a fresh pid happens to collide), OR
//        2. `kill(pid, 0)` reports ESRCH (the recorded process is gone)
//           AND the pid is not our own / not our parent, OR
//        3. `GUILD_LOCK_MAX_AGE_MS` env is set and `started_at` exceeds it.
//
// We deliberately refuse to reclaim a lock whose pid is our own
// process or our parent — that's ancestor territory and reclaiming
// it would silently corrupt a legitimate concurrent flow within the
// same process tree. We do NOT walk further up the ancestor chain:
// a portable Node API for that does not exist (Linux-only /proc is
// out of scope), and reboot-crossing PID collisions on the
// grandparent boundary fall under "acceptable false-reclaim" — the
// boottime check (1) catches the common reboot case anyway.
//
// Lock metadata is treated as UNTRUSTED input: another writer (or a
// hand-edited file) may put arbitrary strings in `actor` / `verb` /
// `passage`. We never interpolate them into shell or filesystem
// paths; user-facing surfaces JSON-stringify before display.

import { openSync, writeSync, closeSync, unlinkSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { hostname, uptime as osUptime } from 'node:os';
import { DomainError } from '../../domain/shared/DomainError.js';
import { getPackageVersion } from '../../interface/shared/version.js';

/**
 * Thrown when the content-root lock is held by another process and
 * cannot be reclaimed as stale. Subclass of `DomainError` so the
 * existing entry-point catch path handles it uniformly; the JSON
 * envelope branch in `deriveErrorCode` maps it to `lock_busy`.
 *
 * `holder` carries the lock metadata that was on disk at the time
 * we tried to acquire — useful for diagnostics, but treat as
 * untrusted (it came from another writer's serialization).
 */
export class LockBusyError extends DomainError {
  public readonly holder: LockMetadata | null;
  public readonly lockPath: string;
  constructor(lockPath: string, holder: LockMetadata | null) {
    const who = holder
      ? `pid=${String(holder.pid)} actor=${JSON.stringify(holder.actor)} verb=${JSON.stringify(holder.verb)}`
      : '(unreadable holder metadata)';
    super(
      `another guild-cli write is in flight (lock: ${lockPath}); holder: ${who}`,
    );
    this.name = 'LockBusyError';
    this.holder = holder;
    this.lockPath = lockPath;
  }
}

/**
 * Persisted shape of the lock file. New optional fields can be
 * appended without breaking older holders since we only `read` the
 * fields we explicitly inspect during reclaim.
 */
export interface LockMetadata {
  pid: number;
  ppid: number;
  started_at: string; // ISO 8601
  verb: string;
  actor: string;
  host: string;
  cwd: string;
  passage: string;
  guild_cli_version: string;
}

export interface GuildLockMeta {
  passage: string;
  verb: string;
  actor: string;
}

export interface GuildLockOpts {
  /**
   * Override the lock filename within `contentRoot`. Tests use this
   * to isolate concurrent runs; production always uses the default.
   */
  lockFile?: string;
}

interface ConfigLike {
  contentRoot: string;
}

const DEFAULT_LOCK_FILE = '.guild-lock';

/**
 * Acquire the content-root lock, run `fn`, release in `finally`.
 *
 * Returns whatever `fn` returns. If `fn` throws, the error
 * propagates AFTER the lock is released. If acquisition itself
 * fails (other holder, not stale), throws `LockBusyError`.
 */
export async function withGuildLock<T>(
  config: ConfigLike,
  meta: GuildLockMeta,
  fn: () => Promise<T>,
  opts: GuildLockOpts = {},
): Promise<T> {
  const lockPath = join(config.contentRoot, opts.lockFile ?? DEFAULT_LOCK_FILE);
  const fd = acquire(lockPath, meta);
  try {
    return await fn();
  } finally {
    release(lockPath, fd);
  }
}

/**
 * Attempt to create the lock file exclusively. On EEXIST, peek the
 * existing metadata and either reclaim (one retry) or throw
 * `LockBusyError`. Returns the held file descriptor.
 */
function acquire(lockPath: string, meta: GuildLockMeta): number {
  // Test-only synchronization barrier. When GUILD_LOCK_TEST_BARRIER
  // is set to a path, block (busy-poll) until that path exists
  // before attempting `openExclusive`. The cross-passage race E2E
  // suite uses this to make N spawned children all enter the
  // open-O_EXCL race in the same kernel-scheduling window — without
  // it, child N starts so much later than child 1 that child 1 has
  // already finished and released, and the suite cannot observe a
  // real race. Production callers never set this env, so the cost
  // is one cheap getenv per acquire.
  awaitTestBarrier();
  try {
    return openExclusive(lockPath, meta);
  } catch (err) {
    if (!isEexist(err)) throw err;
    // EEXIST path — read holder, dispatch on discriminator.
    const peek = readHolder(lockPath);

    // #197: TOCTOU between EEXIST and readHolder. The previous
    // holder released between our open(O_EXCL) returning EEXIST
    // and our readFile. Retry openExclusive once — if that also
    // EEXISTs, a new holder beat us, and we surface that as busy.
    if (peek.kind === 'gone') {
      try {
        return openExclusive(lockPath, meta);
      } catch (retryErr) {
        if (!isEexist(retryErr)) throw retryErr;
        const second = readHolder(lockPath);
        throw new LockBusyError(lockPath, holderOrNull(second));
      }
    }

    // #195: unparseable holder file is treated as stale; recovery
    // cost is low (next caller writes fresh metadata). Falls into
    // the same unlink+retry path as a reclaimed live-but-stale lock.
    const treatAsStale =
      peek.kind === 'corrupt' ||
      (peek.kind === 'present' && isReclaimable(peek.holder));

    if (treatAsStale) {
      // Best-effort unlink; if it disappears between our read and
      // unlink that's fine — the next openExclusive will succeed.
      try {
        unlinkSync(lockPath);
      } catch (e) {
        if (!isEnoent(e)) throw e;
      }
      try {
        return openExclusive(lockPath, meta);
      } catch (retryErr) {
        if (!isEexist(retryErr)) throw retryErr;
        // Lost the race: someone else acquired between our unlink
        // and retry. Surface that as busy with the *new* holder.
        const second = readHolder(lockPath);
        throw new LockBusyError(lockPath, holderOrNull(second));
      }
    }

    // peek.kind === 'present' and not reclaimable.
    throw new LockBusyError(lockPath, peek.holder);
  }
}

function holderOrNull(r: ReadHolderResult): LockMetadata | null {
  return r.kind === 'present' ? r.holder : null;
}

function release(lockPath: string, fd: number): void {
  // Close first so platforms that hold a delete-lock on open fds
  // (e.g. Windows) can complete the unlink. Errors during release
  // are swallowed — a leaked .guild-lock will be reclaimed by the
  // next caller via the staleness check; throwing here would mask
  // a real `fn` error in the caller's catch.
  try {
    closeSync(fd);
  } catch {
    // ignore
  }
  try {
    unlinkSync(lockPath);
  } catch (e) {
    if (!isEnoent(e)) {
      // We deliberately do not rethrow. The lock is process-bound
      // and the next caller's reclaim will handle a stuck file.
    }
  }
}

function openExclusive(lockPath: string, meta: GuildLockMeta): number {
  const fd = openSync(lockPath, 'wx');
  try {
    const payload: LockMetadata = {
      pid: process.pid,
      ppid: typeof process.ppid === 'number' ? process.ppid : 0,
      started_at: new Date().toISOString(),
      verb: meta.verb,
      actor: meta.actor,
      host: hostname(),
      cwd: process.cwd(),
      passage: meta.passage,
      guild_cli_version: safeVersion(),
    };
    writeSync(fd, JSON.stringify(payload, null, 2) + '\n');
    return fd;
  } catch (e) {
    // If we crashed mid-write, leaving an empty/garbage file would
    // wedge subsequent runs. Best-effort cleanup before rethrow.
    try { closeSync(fd); } catch { /* ignore */ }
    try { unlinkSync(lockPath); } catch { /* ignore */ }
    throw e;
  }
}

/**
 * Outcome of peeking at the lock file when we hit EEXIST. The
 * discriminator lets `acquire` distinguish three meaningfully
 * different states without conflating them in a single `null`:
 *
 *   - `gone`    : the file vanished between EEXIST and our read.
 *                 The previous holder released; retry openExclusive.
 *   - `corrupt` : the file exists but cannot be parsed as a
 *                 LockMetadata. Treated as stale (#195); the
 *                 only realistic causes are power-loss mid-write
 *                 or a hand-edit, both of which warrant recovery.
 *   - `present` : valid metadata; caller decides reclaim vs busy.
 *
 * This type is intentionally module-internal — exporting it would
 * leak the implementation choice for stale-handling beyond what
 * callers need. They only see `LockBusyError` or success.
 */
export type ReadHolderResult =
  | { kind: 'gone' }
  | { kind: 'corrupt' }
  | { kind: 'present'; holder: LockMetadata };

export function readHolder(lockPath: string): ReadHolderResult {
  let raw: string;
  try {
    raw = readFileSync(lockPath, 'utf8');
  } catch (e) {
    // ENOENT specifically means the file was unlinked between the
    // EEXIST and our readFile (TOCTOU, #197). Other read errors
    // (e.g. EACCES) we cannot meaningfully recover from at this
    // layer — surface as `corrupt` so the caller treats the lock
    // as stale rather than wedging indefinitely. This is more
    // permissive than the previous null-swallow but symmetric
    // with the corrupt-as-stale policy: an unreadable lock is
    // useless to us either way.
    if (isEnoent(e)) return { kind: 'gone' };
    return { kind: 'corrupt' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'corrupt' };
  }
  if (!parsed || typeof parsed !== 'object') return { kind: 'corrupt' };
  const o = parsed as Record<string, unknown>;
  if (typeof o['pid'] !== 'number') return { kind: 'corrupt' };
  const holder: LockMetadata = {
    pid: o['pid'] as number,
    ppid: typeof o['ppid'] === 'number' ? (o['ppid'] as number) : 0,
    started_at: typeof o['started_at'] === 'string' ? (o['started_at'] as string) : '',
    verb: typeof o['verb'] === 'string' ? (o['verb'] as string) : '',
    actor: typeof o['actor'] === 'string' ? (o['actor'] as string) : '',
    host: typeof o['host'] === 'string' ? (o['host'] as string) : '',
    cwd: typeof o['cwd'] === 'string' ? (o['cwd'] as string) : '',
    passage: typeof o['passage'] === 'string' ? (o['passage'] as string) : '',
    guild_cli_version:
      typeof o['guild_cli_version'] === 'string' ? (o['guild_cli_version'] as string) : '',
  };
  return { kind: 'present', holder };
}

/**
 * Decide whether an existing lock can be safely auto-unlinked.
 * Conservative: refuses to touch our own pid or our parent, since
 * those are ancestors and reclaiming them would corrupt a legitimate
 * in-flight call within the same process tree.
 */
function isReclaimable(holder: LockMetadata): boolean {
  // Boottime check first — if started_at predates OS boot, the
  // recorded pid cannot belong to the original holder regardless
  // of whether the same pid is alive now (reboots reset the pid
  // namespace). This rescues a legitimate stale lock left over by
  // a hard crash that rebooted the machine.
  //
  // Strict `<` (not `<=`): the reboot-second boundary is too coarse
  // to make a confident call from boottime alone; the kill-0 ESRCH
  // OR the GUILD_LOCK_MAX_AGE_MS path will pick up that one-second
  // edge case if it actually matters.
  //
  // os.uptime() is whole-second precision on macOS / Linux but the
  // returned value is a Number; multiply by 1000 to compare against
  // Date.now() in ms.
  if (holder.started_at !== '') {
    const startedMs = Date.parse(holder.started_at);
    if (Number.isFinite(startedMs)) {
      const bootMs = Date.now() - osUptime() * 1000;
      if (startedMs < bootMs) return true;
    }
  }

  // Safety valve: never reclaim ancestor pids via the kill-0 branch.
  // Note: a lock surviving a reboot WILL pass through here above
  // (boottime branch) before hitting this guard — that's intentional
  // because post-reboot a colliding pid is by definition not our
  // ancestor. We only refuse to reclaim ancestors in the "machine
  // hasn't rebooted" case.
  if (holder.pid === process.pid) return false;
  if (typeof process.ppid === 'number' && holder.pid === process.ppid) return false;

  // Dead-process check: kill(pid, 0) → ESRCH means the process is gone.
  // EPERM means the process exists but we can't signal it (different
  // user) — treat as alive (don't reclaim). Other errors: also treat
  // as alive (conservative). Ancestor-walk beyond pid/ppid is not
  // portable in Node, so reboot-crossing pid collisions further up
  // the tree fall under acceptable risk; the boottime branch above
  // covers the common reboot case.
  if (isPidDead(holder.pid)) return true;

  // Age-based reclaim, opt-in via env. The env path is intended for
  // operators who know their workflow's max sane duration; the
  // default (env unset) leaves stale locks alone unless the pid is
  // demonstrably dead.
  const maxAgeRaw = process.env['GUILD_LOCK_MAX_AGE_MS'];
  if (maxAgeRaw !== undefined && maxAgeRaw.length > 0) {
    const maxAge = Number(maxAgeRaw);
    if (Number.isFinite(maxAge) && maxAge > 0 && holder.started_at !== '') {
      const startedMs = Date.parse(holder.started_at);
      if (Number.isFinite(startedMs)) {
        const age = Date.now() - startedMs;
        if (age > maxAge) return true;
      }
    }
  }
  return false;
}

/**
 * If `GUILD_LOCK_TEST_BARRIER` is set, busy-wait until the named
 * file exists. No-op when the env is unset (the production case).
 *
 * Uses a tight sync poll with `existsSync` rather than fs.watch so
 * the wait is deterministic across platforms (fs.watch semantics on
 * macOS are different enough from Linux that test flake is real).
 * Bounded at ~10s so a misconfigured test fails fast instead of
 * hanging the runner indefinitely.
 */
function awaitTestBarrier(): void {
  const barrier = process.env['GUILD_LOCK_TEST_BARRIER'];
  if (barrier === undefined || barrier.length === 0) return;
  const deadline = Date.now() + 10_000;
  // Atomics + SharedArrayBuffer would let us sleep without burn,
  // but pulling that in for a test-only path isn't worth the
  // complexity. A 5ms granularity keeps CPU use trivial.
  while (!existsSync(barrier)) {
    if (Date.now() > deadline) {
      throw new Error(
        `GUILD_LOCK_TEST_BARRIER timeout: ${barrier} did not appear within 10s`,
      );
    }
    // Synchronous tight loop with Atomics.wait on a dummy buffer
    // to yield the thread without spinning hot. 5ms is well below
    // any meaningful test timeout but well above the kernel's
    // wakeup granularity.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
}

function isPidDead(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false; // signal accepted → process is alive
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return true; // no such process
    return false; // EPERM or other → assume alive (conservative)
  }
}

function isEexist(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as NodeJS.ErrnoException).code === 'EEXIST';
}

function isEnoent(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as NodeJS.ErrnoException).code === 'ENOENT';
}

function safeVersion(): string {
  try {
    return getPackageVersion();
  } catch {
    return 'unknown';
  }
}
