// cross-passage-race.test.ts — issue #155 PR-B.
//
// Verifies the content-root lock actually serializes concurrent
// writes ACROSS PROCESSES, not just within one Node event loop.
//
// Why this can't be done with Promise.all in-process: a single Node
// process holds the file descriptor across the entire `withGuildLock`
// call, so an in-process `Promise.all` of two `withGuildLock` calls
// observes nothing surprising — the second call sees an EEXIST and
// throws LockBusyError; that path is already covered by the unit
// test in tests/infrastructure/lock/guildLock.test.ts. The thing
// that's NOT covered there — and the thing that actually fails if
// the lock is buggy — is a cross-process race where each process
// independently hits `openSync(path, 'wx')` in the same kernel
// scheduling window. That's what this suite spawns.
//
// Synchronization strategy: each child first touches its own ready
// file, then calls withGuildLock. The acquire path inside
// guildLock.ts honors GUILD_LOCK_TEST_BARRIER by busy-polling for
// a barrier file before attempting `openExclusive`. The parent
// waits for all children's ready files to appear, then `touch`es
// the barrier — every child unblocks within a 5ms poll quantum and
// they enter the open-O_EXCL race nearly simultaneously. Exactly
// one child observes EEXIST → LockBusyError → exit 2; the rest
// (one) acquires → exits 0.
//
// Note: this is a *probabilistic* race — on a heavily loaded host
// the kernel might schedule child N so much later that child 1 has
// already finished. The barrier dramatically reduces that window
// but doesn't eliminate it. The hold time (CHILD_HOLD_MS=300) is
// generous enough that we have not observed flakes locally.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

interface ChildOutcome {
  exitCode: number | null;
  stderr: string;
}

interface ChildSpec {
  passage: string;
  verb: string;
}

const CHILD_SCRIPT = resolve('dist/tests/integration/lock/_lockChild.js');
const HOLD_MS = '300';
const READY_TIMEOUT_MS = 8_000;

function makeRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-cli-race-'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`waitFor timeout: ${label}`);
    }
    await new Promise<void>((r) => setTimeout(r, 10));
  }
}

async function runRace(
  root: string,
  specs: readonly ChildSpec[],
): Promise<ChildOutcome[]> {
  const barrier = join(root, '.barrier');
  const readyPaths = specs.map((_, i) => join(root, `.ready-${String(i)}`));

  // Spawn all children. Each waits for the barrier before attempting
  // openExclusive, so order of spawn doesn't materially affect the
  // race outcome.
  const children = specs.map((spec, i) => {
    const child = spawn(process.execPath, [CHILD_SCRIPT], {
      env: {
        ...process.env,
        CHILD_ROOT: root,
        CHILD_BARRIER: barrier,
        CHILD_READY: readyPaths[i] ?? '',
        CHILD_PASSAGE: spec.passage,
        CHILD_VERB: spec.verb,
        CHILD_HOLD_MS: HOLD_MS,
        GUILD_LOCK_TEST_BARRIER: barrier,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const done = new Promise<ChildOutcome>((res) => {
      child.on('exit', (code) => res({ exitCode: code, stderr }));
    });
    return { child, done };
  });

  // Wait for all children to be at the barrier (ready files present).
  await waitFor(
    () => readyPaths.every((p) => existsSync(p)),
    READY_TIMEOUT_MS,
    'children-ready',
  );

  // Release the barrier. All children unblock within ~5ms (the
  // Atomics.wait quantum inside awaitTestBarrier) and race.
  writeFileSync(barrier, '1', 'utf8');

  const outcomes = await Promise.all(children.map((c) => c.done));

  // Best-effort cleanup of barrier (lock file is unlinked by the
  // winner's release path; ready files live under root and will
  // be removed by the cleanup() rm -rf).
  try {
    unlinkSync(barrier);
  } catch {
    // ignore
  }
  return outcomes;
}

function summarize(outcomes: readonly ChildOutcome[]): {
  winners: number;
  busy: number;
  unexpected: ChildOutcome[];
} {
  let winners = 0;
  let busy = 0;
  const unexpected: ChildOutcome[] = [];
  for (const o of outcomes) {
    if (o.exitCode === 0) winners += 1;
    else if (o.exitCode === 2) busy += 1;
    else unexpected.push(o);
  }
  return { winners, busy, unexpected };
}

test('cross-passage race: same-entry duo → 1 winner, 1 busy', async () => {
  const { root, cleanup } = makeRoot();
  try {
    const outcomes = await runRace(root, [
      { passage: 'gate', verb: 'request' },
      { passage: 'gate', verb: 'request' },
    ]);
    const s = summarize(outcomes);
    assert.equal(
      s.unexpected.length,
      0,
      `unexpected exit codes: ${JSON.stringify(s.unexpected)}`,
    );
    assert.equal(s.winners, 1, `expected exactly 1 winner, got ${String(s.winners)}`);
    assert.equal(s.busy, 1, `expected exactly 1 busy, got ${String(s.busy)}`);
    // Lock file must be cleaned up after the winner releases.
    assert.equal(existsSync(join(root, '.guild-lock')), false);
  } finally {
    cleanup();
  }
});

test('cross-passage race: gate vs agora → 1 winner, 1 busy', async () => {
  const { root, cleanup } = makeRoot();
  try {
    const outcomes = await runRace(root, [
      { passage: 'gate', verb: 'approve' },
      { passage: 'agora', verb: 'move' },
    ]);
    const s = summarize(outcomes);
    assert.equal(s.unexpected.length, 0);
    assert.equal(s.winners, 1);
    assert.equal(s.busy, 1);
    assert.equal(existsSync(join(root, '.guild-lock')), false);
  } finally {
    cleanup();
  }
});

test('cross-passage race: three-way (gate/agora/devil) → 1 winner, 2 busy', async () => {
  const { root, cleanup } = makeRoot();
  try {
    const outcomes = await runRace(root, [
      { passage: 'gate', verb: 'request' },
      { passage: 'agora', verb: 'play' },
      { passage: 'devil', verb: 'open' },
    ]);
    const s = summarize(outcomes);
    assert.equal(
      s.unexpected.length,
      0,
      `unexpected exit codes: ${JSON.stringify(s.unexpected)}`,
    );
    assert.equal(s.winners, 1);
    assert.equal(s.busy, 2);
    assert.equal(existsSync(join(root, '.guild-lock')), false);
  } finally {
    cleanup();
  }
});
