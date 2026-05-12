// Synergy S3 — Agora-to-Gate Lift
// ================================
//
// E2E test for the cross-passage relay pattern: actor A explores in
// agora, suspends with a cliff + invitation, and actor B (or A
// later) lifts the suspension into a `gate request` via `--from-agora
// <play-id>`. The cliff lands as the request's `reason`; the
// invitation lands as the `action`; the play_id is stamped on
// `source_agora_play` so the request links back to its origin.
//
// What we assert:
//
//   - A `gate request --from-agora <id>` succeeds when the play is
//     suspended, and the resulting record carries:
//       * `action` ← invitation
//       * `reason` ← cliff
//       * `source_agora_play` ← play_id
//   - The `--from` actor on the gate side can differ from the agora
//     `--by` actor — the relay carries *intent*, not authorship.
//   - A concluded play refuses the lift (records the closed-thread
//     contract surfaced in the request handler's error catalog).
//   - A playing-but-not-yet-suspended play refuses the lift (no
//     cliff/invitation to bridge).
//
// Why this synergy is in the catalog:
//
//   Purpose: keep thought-in-motion and judgment moments connected.
//   Agora carries the "what was being figured out"; gate carries the
//   "what we decided to do." Without the bridge, a request that
//   inherits intent from a long agora session loses the trail —
//   you'd paraphrase the cliff into --reason by hand and the link is
//   lossy. With `--from-agora`, the substrate itself preserves the
//   pivot: read the request and follow `source_agora_play` back to
//   the deliberation.
//
//   Trade-off: the lift is one-shot — re-suspending the play and
//   lifting again produces a new request that shares the same
//   source_agora_play, but the substrate does not enforce
//   "one request per suspension" or "one suspension per request."
//   Operators have to keep the play's life cycle visible: file
//   the request, then conclude or fresh-suspend the play; leaving
//   it suspended after a lift makes it easy to accidentally lift
//   the same cliff twice.
//
// Linked playbook section: `docs/playbook.md` § "Synergies" → S3.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  bootstrap,
  runGate,
  extractRequestId,
} from '../_e2e_helpers.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const AGORA = resolve(here, '../../../bin/agora.mjs');

function runAgora(
  cwd: string,
  args: readonly string[],
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [AGORA, ...args], {
    cwd,
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

function extractPlayId(output: string): string {
  // agora play emits e.g. "✓ play started: 2026-05-12-001 [playing]"
  const m = output.match(/\b(\d{4}-\d{2}-\d{2}-\d{3})\b/);
  if (!m) throw new Error(`could not find play id in output: ${output}`);
  return m[1] as string;
}

const A = 'alice';
const B = 'bob';

test('S3: A suspends play, B lifts via --from-agora → request inherits cliff/invitation', (t) => {
  const { root, cleanup } = bootstrap({ members: [A, B] });
  t.after(cleanup);

  // A creates a game and a play, makes a move, suspends with a
  // substantive cliff + invitation.
  const newGame = runAgora(root, [
    'new', '--slug', 'auth-redesign', '--kind', 'sandbox',
    '--title', 'auth flow redesign exploration', '--by', A,
  ]);
  assert.equal(newGame.status, 0, newGame.stderr);

  const startPlay = runAgora(root, ['play', '--slug', 'auth-redesign', '--by', A]);
  assert.equal(startPlay.status, 0, startPlay.stderr);
  const playId = extractPlayId(startPlay.stdout + startPlay.stderr);

  assert.equal(runAgora(root, [
    'move', playId, '--game', 'auth-redesign', '--by', A,
    '--text', 'session A: revisited the cookie vs JWT trade-off',
  ]).status, 0);

  const susp = runAgora(root, [
    'suspend', playId, '--game', 'auth-redesign', '--by', A,
    '--cliff', 'JWT path leaves us with a stateless refresh problem unresolved',
    '--invitation', 'ship a spike on session-cookie path so concrete data informs the call',
  ]);
  assert.equal(susp.status, 0, susp.stderr);

  // B (different --from) lifts the suspension into a gate request.
  const lifted = runGate(root, [
    'request',
    '--from', B,
    '--executors', B,
    '--from-agora', playId,
  ]);
  assert.equal(lifted.status, 0, `--from-agora lift failed: ${lifted.stderr}`);
  const reqId = extractRequestId(lifted.stdout + lifted.stderr);

  // Inspect the record: action ← invitation, reason ← cliff,
  // source_agora_play ← play_id.
  const shown = runGate(root, ['show', reqId, '--format', 'json']);
  const record = JSON.parse(shown.stdout);

  assert.equal(
    record.action,
    'ship a spike on session-cookie path so concrete data informs the call',
    `action should lift from invitation; got: ${record.action}`,
  );
  assert.equal(
    record.reason,
    'JWT path leaves us with a stateless refresh problem unresolved',
    `reason should lift from cliff; got: ${record.reason}`,
  );
  assert.equal(
    record.source_agora_play,
    playId,
    `source_agora_play should stamp the play id; got: ${record.source_agora_play}`,
  );
  // The relay carries intent, not authorship: --from is B, not A.
  assert.equal(record.from, B);
});

test('S3: a concluded play refuses the lift — closed-thread contract', (t) => {
  const { root, cleanup } = bootstrap({ members: [A, B] });
  t.after(cleanup);

  assert.equal(runAgora(root, [
    'new', '--slug', 'closed-thread', '--kind', 'sandbox',
    '--title', 't', '--by', A,
  ]).status, 0);
  const startPlay = runAgora(root, ['play', '--slug', 'closed-thread', '--by', A]);
  const playId = extractPlayId(startPlay.stdout + startPlay.stderr);
  assert.equal(runAgora(root, [
    'move', playId, '--game', 'closed-thread', '--by', A, '--text', 'thinking',
  ]).status, 0);
  assert.equal(runAgora(root, [
    'conclude', playId, '--game', 'closed-thread', '--by', A, '--note', 'closed',
  ]).status, 0);

  const lifted = runGate(root, [
    'request',
    '--from', B,
    '--executors', B,
    '--from-agora', playId,
  ]);
  assert.notEqual(
    lifted.status,
    0,
    `concluded play should refuse lift; got status ${lifted.status}`,
  );
  assert.match(
    lifted.stderr,
    /concluded/i,
    `stderr should name the closed-thread refusal; got: ${lifted.stderr}`,
  );
});

test('S3: a play with no suspension refuses the lift — nothing to bridge', (t) => {
  const { root, cleanup } = bootstrap({ members: [A, B] });
  t.after(cleanup);

  assert.equal(runAgora(root, [
    'new', '--slug', 'no-cliff', '--kind', 'sandbox',
    '--title', 't', '--by', A,
  ]).status, 0);
  const startPlay = runAgora(root, ['play', '--slug', 'no-cliff', '--by', A]);
  const playId = extractPlayId(startPlay.stdout + startPlay.stderr);
  assert.equal(runAgora(root, [
    'move', playId, '--game', 'no-cliff', '--by', A, '--text', 'thinking',
  ]).status, 0);
  // No suspend — play is still playing.

  const lifted = runGate(root, [
    'request',
    '--from', B,
    '--executors', B,
    '--from-agora', playId,
  ]);
  assert.notEqual(
    lifted.status,
    0,
    `playing-but-not-suspended play should refuse lift; got status ${lifted.status}`,
  );
  assert.match(
    lifted.stderr,
    /no suspension|suspend/i,
    `stderr should name the no-suspension refusal; got: ${lifted.stderr}`,
  );
});

test('S3: explicit --action overrides the invitation lift; --reason overrides cliff', (t) => {
  const { root, cleanup } = bootstrap({ members: [A, B] });
  t.after(cleanup);

  assert.equal(runAgora(root, [
    'new', '--slug', 'override-test', '--kind', 'sandbox',
    '--title', 't', '--by', A,
  ]).status, 0);
  const startPlay = runAgora(root, ['play', '--slug', 'override-test', '--by', A]);
  const playId = extractPlayId(startPlay.stdout + startPlay.stderr);
  assert.equal(runAgora(root, [
    'move', playId, '--game', 'override-test', '--by', A, '--text', 'm',
  ]).status, 0);
  assert.equal(runAgora(root, [
    'suspend', playId, '--game', 'override-test', '--by', A,
    '--cliff', 'auto-cliff',
    '--invitation', 'auto-invitation',
  ]).status, 0);

  // Override action; reason should still lift from cliff.
  const lifted = runGate(root, [
    'request',
    '--from', B,
    '--executors', B,
    '--from-agora', playId,
    '--action', 'manually-overridden action',
  ]);
  assert.equal(lifted.status, 0, lifted.stderr);
  const reqId = extractRequestId(lifted.stdout + lifted.stderr);

  const record = JSON.parse(runGate(root, ['show', reqId, '--format', 'json']).stdout);
  assert.equal(record.action, 'manually-overridden action');
  assert.equal(record.reason, 'auto-cliff', 'unspecified axis still lifts');
  // Source link survives the partial override.
  assert.equal(record.source_agora_play, playId);
});
