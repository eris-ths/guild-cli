// Synergy S4 — Swarm Slice Closure
// =================================
//
// E2E test for the swarm-end-to-end pattern: a multi-executor wave
// where each executor independently witnesses, closes their slice
// (`gate complete --by <X>`), and the wave reaches `completed` only
// after the last slice closes. This is the load-bearing combo for
// principle 14 — the substrate carries every executor's state per-
// slice (#294) and exposes per-executor freshness (#309), so a
// director never has to keep "who is at which step?" in working
// memory.
//
// What we assert:
//
//   - A 2-executor wave reaches `completed` only after both slices
//     close — the first slice closure leaves the wave in `executing`
//     (slice closure compose-rule: wave terminal = all slices closed).
//   - `executors[]` serializes as the structured form (post-#294
//     BREAKING shape: array of `{name, status, completed_at?, note?}`)
//     once any slice has been closed.
//   - `gate wave-status` per-executor view shows each slice's status
//     and freshness band correctly mid-flight (after slice 1, before
//     slice 2).
//   - `gate complete --by <non-executor>` is refused — the slice
//     closure is per-named-executor, not "anyone with substrate
//     access can stamp."
//
// Why this synergy is in the catalog:
//
//   Purpose: keep multi-executor coordination context-free. Each
//   executor reads "is my slice done?", closes when ready, and the
//   wave's terminal moment is the **last** slice's stamp — not a
//   coordinated wave-level handshake. The director never holds the
//   wave-state in working memory because the substrate composes it.
//   This is principle 14's load-bearing case, end-to-end.
//
//   Trade-off: any-fail composition. If any slice fails (via
//   `gate fail --by <X>`), the wave moves to `failed` even if other
//   slices completed. The compose-rule is intentionally conservative
//   — multi-executor success requires unanimous slice completion;
//   one failure suffices to flip the wave. The trade is "fail fast"
//   over "completed_with_partial_failure"; the operator who wants
//   partial-success semantics has to model that as multiple separate
//   waves with their own dependencies, not as a single wave with
//   mixed per-slice outcomes.
//
// Linked playbook section: `docs/playbook.md` § "Synergies" → S4.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrap,
  runGate,
  extractRequestId,
} from '../_e2e_helpers.js';

const ALICE = 'alice';
const BOB = 'bob';
const CRITIC = 'critic';
const SESSION_A = 'alice-2026-05-12';
const SESSION_B = 'bob-2026-05-12';

test('S4: 2-executor wave reaches completed only after both slices close', (t) => {
  const { root, cleanup } = bootstrap({
    members: [ALICE, BOB, CRITIC],
  });
  t.after(cleanup);

  const created = runGate(root, [
    'request',
    '--from', 'eris',
    '--executors', `${ALICE},${BOB}`,
    '--action', 'swarm slice closure smoke',
    '--reason', 'verify per-slice complete + wave terminal compose',
  ]);
  assert.equal(created.status, 0, created.stderr);
  const id = extractRequestId(created.stdout + created.stderr);

  assert.equal(runGate(root, ['approve', id, '--by', CRITIC]).status, 0);
  assert.equal(runGate(root, ['execute', id, '--by', ALICE]).status, 0);

  // Each executor witnesses with their session_id (principle 14
  // dogfood — substrate carries who-is-which-body).
  assert.equal(
    runGate(
      root,
      ['witness', id, '--by', ALICE, '--note', 'slice A in flight'],
      { GUILD_SESSION_ID: SESSION_A },
    ).status,
    0,
  );
  assert.equal(
    runGate(
      root,
      ['witness', id, '--by', BOB, '--note', 'slice B in flight'],
      { GUILD_SESSION_ID: SESSION_B },
    ).status,
    0,
  );

  // Slice 1: alice closes. Wave should STILL be executing.
  const slice1 = runGate(root, [
    'complete', id, '--by', ALICE, '--note', 'slice A done',
  ]);
  assert.equal(slice1.status, 0, slice1.stderr);

  const midState = JSON.parse(runGate(root, ['show', id, '--format', 'json']).stdout);
  assert.equal(
    midState.state,
    'executing',
    `wave should still be executing after first slice; got: ${midState.state}`,
  );

  // The structured executors[] form (post-#294) carries per-slice
  // status. After alice closes, alice is 'completed', bob is 'pending'.
  // Normalise to handle either flat (legacy) or structured shape.
  const executorsByName: Record<string, { status: string }> = {};
  for (const e of midState.executors as Array<unknown>) {
    if (typeof e === 'string') {
      executorsByName[e] = { status: 'pending' };
    } else {
      const rec = e as { name: string; status: string };
      executorsByName[rec.name] = { status: rec.status };
    }
  }
  assert.equal(
    executorsByName[ALICE]?.status,
    'completed',
    `alice should be slice-completed; got: ${JSON.stringify(executorsByName)}`,
  );
  assert.equal(
    executorsByName[BOB]?.status,
    'pending',
    `bob should still be pending; got: ${JSON.stringify(executorsByName)}`,
  );

  // Slice 2: bob closes — wave reaches completed.
  const slice2 = runGate(root, [
    'complete', id, '--by', BOB, '--note', 'slice B done',
  ]);
  assert.equal(slice2.status, 0, slice2.stderr);

  const finalState = JSON.parse(runGate(root, ['show', id, '--format', 'json']).stdout);
  assert.equal(
    finalState.state,
    'completed',
    `wave should be completed after last slice; got: ${finalState.state}`,
  );
});

test('S4: gate wave-status mid-flight shows per-executor slice status correctly', (t) => {
  const { root, cleanup } = bootstrap({ members: [ALICE, BOB, CRITIC] });
  t.after(cleanup);

  const created = runGate(root, [
    'request',
    '--from', 'eris',
    '--executors', `${ALICE},${BOB}`,
    '--action', 'wave-status mid-flight smoke',
    '--reason', 'verify per-executor view between slice closures',
  ]);
  const id = extractRequestId(created.stdout + created.stderr);
  runGate(root, ['approve', id, '--by', CRITIC]);
  runGate(root, ['execute', id, '--by', ALICE]);
  runGate(root, ['witness', id, '--by', ALICE, '--note', 'A working']);
  runGate(root, ['witness', id, '--by', BOB, '--note', 'B working']);
  runGate(root, ['complete', id, '--by', ALICE, '--note', 'A finished early']);

  const ws = runGate(root, ['wave-status', id, '--format', 'json']);
  assert.equal(ws.status, 0, ws.stderr);
  const payload = JSON.parse(ws.stdout);

  const executorViews: Array<{ name: string; slice_status: string; activity_band: string }> = payload.executors;
  const alice = executorViews.find((e) => e.name === ALICE);
  const bob = executorViews.find((e) => e.name === BOB);

  assert.equal(alice?.slice_status, 'completed', `alice slice_status: ${alice?.slice_status}`);
  assert.equal(bob?.slice_status, 'pending', `bob slice_status: ${bob?.slice_status}`);

  // Per-#309: a just-witnessed executor should be 'fresh', not 'stale'.
  // The whole wave is < 5s old in this test, so both should read as fresh.
  assert.equal(
    bob?.activity_band,
    'fresh',
    `bob just witnessed; band should be fresh; got: ${bob?.activity_band}`,
  );
});

test('S4: gate complete --by <non-executor> is refused', (t) => {
  const { root, cleanup } = bootstrap({ members: [ALICE, BOB, CRITIC, 'eve'] });
  t.after(cleanup);

  const created = runGate(root, [
    'request',
    '--from', 'eris',
    '--executors', `${ALICE},${BOB}`,
    '--action', 'non-executor close smoke',
    '--reason', 'verify slice closure is per-named-executor',
  ]);
  const id = extractRequestId(created.stdout + created.stderr);
  runGate(root, ['approve', id, '--by', CRITIC]);
  runGate(root, ['execute', id, '--by', ALICE]);

  // eve is a registered member but NOT in the executor list.
  // Slice closure must reject — per-slice ownership is the contract.
  const refused = runGate(root, [
    'complete', id, '--by', 'eve', '--note', 'eve trying to stamp',
  ]);
  assert.notEqual(
    refused.status,
    0,
    `non-executor close should be refused; got status ${refused.status}`,
  );
});

test('S4: any-fail composition — one slice fail flips the wave to failed', (t) => {
  const { root, cleanup } = bootstrap({ members: [ALICE, BOB, CRITIC] });
  t.after(cleanup);

  const created = runGate(root, [
    'request',
    '--from', 'eris',
    '--executors', `${ALICE},${BOB}`,
    '--action', 'any-fail smoke',
    '--reason', 'verify wave terminal = failed when any slice fails',
  ]);
  const id = extractRequestId(created.stdout + created.stderr);
  runGate(root, ['approve', id, '--by', CRITIC]);
  runGate(root, ['execute', id, '--by', ALICE]);

  // Alice completes successfully; Bob fails. The wave must reach
  // `failed` — even though one slice succeeded, the compose-rule is
  // "any-fail wins."
  assert.equal(runGate(root, [
    'complete', id, '--by', ALICE, '--note', 'A success',
  ]).status, 0);
  assert.equal(runGate(root, [
    'fail', id, '--by', BOB, '--reason', 'B blocked on upstream issue',
  ]).status, 0);

  const finalState = JSON.parse(runGate(root, ['show', id, '--format', 'json']).stdout);
  assert.equal(
    finalState.state,
    'failed',
    `wave should be failed when any slice fails; got: ${finalState.state}`,
  );
});
