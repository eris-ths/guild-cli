// Synergy S1 — Mirror Persona Loop
// =================================
//
// E2E test for the solo flow's load-bearing pattern: the same human-
// or-AI actor running both `executor` and `mirror` roles within one
// content_root, by using two distinct `--by` names. This is the
// minimal expression of the Two-Persona Devil discipline (principle
// 02 + principle 08).
//
// The verb arc (post-#334, six verbs):
//
//   register --name <you>
//   register --name <you-mirror>
//   request   --from <you>     --executors <you>          ...
//   approve   <id> --by <you-mirror>
//   review    <id> --by <you-mirror> --lense user --verdict ok
//   execute   <id> --by <you>
//   complete  <id> --by <you>
//
// What we assert end-to-end:
//
//   - The final wave state is `completed`.
//   - Each verb succeeds (exit 0).
//   - `executors[]` carries `<you>` only — the mirror is NOT recorded
//     as an executor; their stake lives on the approve/review entries.
//   - `status_log[]` records both `<you>` and `<you-mirror>` as `by`
//     values, on the transitions each owned.
//   - `reviews[]` contains exactly one entry, authored by the mirror.
//
// Why this synergy is in the catalog:
//
//   Purpose: keep authorship and review legible inside a solo flow,
//   without inflating ceremony — one body of work, two perspectives
//   stamped on it.
//
//   Trade-off: review depth is operator discipline, not enforced.
//   The mirror is the same actor wearing a different hat; if the
//   hat-swap is shallow, the discipline degrades to a self-stamp.
//   Devil review (audience-#1 dogfood) catches this when the
//   mirror's `--verdict concern` ratio collapses to zero.
//
// Linked playbook section: `docs/playbook.md` § "Synergies" → S1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrap,
  runGate,
  extractRequestId,
} from '../_e2e_helpers.js';

const YOU = 'claude';
const MIRROR = 'claude-mirror';

test('S1: mirror persona loop — solo arc completes with two --by personas', (t) => {
  const { root, cleanup } = bootstrap({
    members: [YOU, MIRROR],
  });
  t.after(cleanup);

  // Step 1: file the request as the executor persona.
  const created = runGate(root, [
    'request',
    '--from', YOU,
    '--executors', YOU,
    '--action', 'mirror persona loop smoke',
    '--reason', 'verify two-persona-devil discipline end-to-end',
  ]);
  assert.equal(created.status, 0, `request failed: ${created.stderr}`);
  const id = extractRequestId(created.stdout + created.stderr);

  // Step 2: approve as mirror — the discipline is the
  // executor-and-approver-are-different rule, enforced here by
  // operator choice (self_approve: allowed by default in solo
  // profile, so this would technically work with --by YOU too).
  const approved = runGate(root, ['approve', id, '--by', MIRROR]);
  assert.equal(approved.status, 0, `approve failed: ${approved.stderr}`);

  // Step 3: review as mirror, lense=user, verdict=ok.
  const reviewed = runGate(root, [
    'review', id,
    '--by', MIRROR,
    '--lense', 'user',
    '--verdict', 'ok',
    '--note', 'first-pass mirror review',
  ]);
  assert.equal(reviewed.status, 0, `review failed: ${reviewed.stderr}`);

  // Step 4: execute as the executor persona.
  const executed = runGate(root, ['execute', id, '--by', YOU]);
  assert.equal(executed.status, 0, `execute failed: ${executed.stderr}`);

  // Step 5: complete as the executor.
  const completed = runGate(root, [
    'complete', id, '--by', YOU, '--note', 'done',
  ]);
  assert.equal(completed.status, 0, `complete failed: ${completed.stderr}`);

  // Final state inspection via show --format json.
  const shown = runGate(root, ['show', id, '--format', 'json']);
  assert.equal(shown.status, 0, shown.stderr);
  const record = JSON.parse(shown.stdout);

  assert.equal(record.state, 'completed', 'final state should be completed');
  // executors[] carries the executor only — the mirror is NOT an executor.
  // Post-#294, executors may serialize as objects or as a flat name array
  // depending on whether slice closure ran; normalise both shapes.
  const execNames = (record.executors as Array<unknown>).map((e) =>
    typeof e === 'string' ? e : (e as { name: string }).name,
  );
  assert.deepEqual(execNames, [YOU], 'executor list should be [YOU] only');

  // status_log records BOTH personas, on their respective transitions.
  const log = record.status_log as Array<{ by: string; state: string }>;
  const transitionsByActor = new Map<string, Set<string>>();
  for (const e of log) {
    if (!transitionsByActor.has(e.by)) transitionsByActor.set(e.by, new Set());
    transitionsByActor.get(e.by)!.add(e.state);
  }
  assert.ok(
    transitionsByActor.get(MIRROR)?.has('approved'),
    `mirror should have approved; got log: ${JSON.stringify(log)}`,
  );
  assert.ok(
    transitionsByActor.get(YOU)?.has('executing'),
    `executor should have executed; got log: ${JSON.stringify(log)}`,
  );
  assert.ok(
    transitionsByActor.get(YOU)?.has('completed'),
    `executor should have completed; got log: ${JSON.stringify(log)}`,
  );

  // reviews[] carries exactly one entry, authored by the mirror.
  const reviews = record.reviews as Array<{ by: string; lense: string; verdict: string }>;
  assert.equal(reviews.length, 1, 'should have exactly one review');
  assert.equal(reviews[0]?.by, MIRROR);
  assert.equal(reviews[0]?.lense, 'user');
  assert.equal(reviews[0]?.verdict, 'ok');
});

test('S1: same-actor approve+execute (no mirror) also works — discipline is operator choice', (t) => {
  // This case documents the trade-off: with default solo profile
  // (`self_approve: allowed`), the verb arc runs even when one
  // actor wears both hats. The synergy's *value* is the discipline
  // of using a separate --by, not a hard enforcement.
  const { root, cleanup } = bootstrap({ members: [YOU] });
  t.after(cleanup);

  const created = runGate(root, [
    'request',
    '--from', YOU,
    '--executors', YOU,
    '--action', 'self-approve smoke',
    '--reason', 'document trade-off',
  ]);
  assert.equal(created.status, 0, created.stderr);
  const id = extractRequestId(created.stdout + created.stderr);

  // No mirror — approve/review by YOU.
  assert.equal(runGate(root, ['approve', id, '--by', YOU]).status, 0);
  assert.equal(
    runGate(root, [
      'review', id, '--by', YOU,
      '--lense', 'user', '--verdict', 'ok',
      '--note', 'self-stamped (no mirror) — trade-off arm',
    ]).status,
    0,
  );
  assert.equal(runGate(root, ['execute', id, '--by', YOU]).status, 0);
  assert.equal(runGate(root, ['complete', id, '--by', YOU]).status, 0);

  const shown = runGate(root, ['show', id, '--format', 'json']);
  const record = JSON.parse(shown.stdout);
  assert.equal(record.state, 'completed');

  // status_log only carries YOU — the trade-off surface is that
  // the substrate cannot tell after the fact whether the operator
  // exercised the mirror discipline or stamped through.
  const distinctActors = new Set(
    (record.status_log as Array<{ by: string }>).map((e) => e.by),
  );
  assert.deepEqual([...distinctActors], [YOU]);
});

test('S1: swarm profile flip — self_approve: forbidden requires a separate --by', (t) => {
  // Forward-compat anchor: the same arc on `profile: swarm` REQUIRES
  // the mirror. `gate approve --by YOU` is rejected; the mirror call
  // succeeds. This pins the contract documented in README's Solo
  // flow ("when you later flip to swarm profile, self_approve:
  // forbidden kicks in and a separate --by is required by config").
  const { root, cleanup } = bootstrap({
    members: [YOU, MIRROR],
    extraConfig: 'profile: swarm\n',
  });
  t.after(cleanup);

  const created = runGate(root, [
    'request',
    '--from', YOU,
    '--executors', YOU,
    '--action', 'swarm-profile smoke',
    '--reason', 'verify self_approve: forbidden contract',
  ]);
  assert.equal(created.status, 0, created.stderr);
  const id = extractRequestId(created.stdout + created.stderr);

  // Self-approve refused under swarm profile.
  const selfApprove = runGate(root, ['approve', id, '--by', YOU]);
  assert.notEqual(
    selfApprove.status,
    0,
    `swarm profile must refuse self-approve; got status ${selfApprove.status} stderr=${selfApprove.stderr}`,
  );

  // Mirror succeeds.
  const mirrorApprove = runGate(root, ['approve', id, '--by', MIRROR]);
  assert.equal(
    mirrorApprove.status,
    0,
    `mirror approve must succeed: ${mirrorApprove.stderr}`,
  );
});
