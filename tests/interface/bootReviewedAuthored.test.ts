import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';
import {
  GATE,
  bootstrap,
  runGate,
  escapeRegex,
  bootstrapWithMembers,
  registerMember,
  makeRequestWithTarget,
  makeRequestSessioned,
} from './_bootHelpers.js';

// ---------------------------------------------------------------
// reviewed-authored surface (designed in 2026-05-06-0001).
//
// When peers land reviews on a request the actor authored, boot
// lifts them via verbs_available_now.actionable[] (verb=show) and
// suggested_next (when no higher-priority transition is open).
// Boundary scope is the Request aggregate: status_log / reviews /
// thanks all advance it. Message/issue writes do NOT advance it.
//
// Tests below pin the gap-1 (thanks integration), gap-2 (cap), and
// the higher-priority-suppression invariant Devil v3 ratify named.
// ---------------------------------------------------------------

test('gate boot: reviewed-authored surfaces when peer reviews land on authored request', () => {
  const { root, cleanup } = bootstrapWithMembers();
  try {
    // alice authors a fast-track (reaches completed in one shot).
    const filed = runGate(
      root,
      [
        'fast-track',
        '--action',
        'demo work',
        '--reason',
        'reviewed-authored pin',
        '--format',
        'json',
      ],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(filed.status, 0);
    const id = JSON.parse(filed.stdout).id;
    // bob reviews. bob's review is the boundary-crossing event.
    const reviewed = runGate(
      root,
      [
        'review',
        id,
        '--lense',
        'devil',
        '--verdict',
        'ok',
        '--comment',
        'lgtm',
      ],
      { GUILD_ACTOR: 'bob' },
    );
    assert.equal(reviewed.status, 0);

    // alice boots — should see reviewed-authored.
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.suggested_next?.verb, 'show');
    assert.equal(payload.suggested_next?.args?.id, id);
    assert.match(payload.suggested_next?.reason ?? '', /you authored/);
    assert.match(payload.suggested_next?.reason ?? '', /1 review/);
    assert.equal(payload.status.reviews_unseen, 1);

    // actionable[] mirrors it.
    const actionable = payload.verbs_available_now.actionable;
    assert.ok(
      actionable.some(
        (a: { verb: string; id: string }) => a.verb === 'show' && a.id === id,
      ),
      'reviewed-authored entry must appear in actionable[]',
    );
  } finally {
    cleanup();
  }
});

test('gate boot: reviewed-authored boundary advances when author writes a thank (gap-1)', () => {
  // Devil v3 concern: addThank does not touch status_log, so a
  // thanks-only response from the author would not advance the
  // boundary in v2. Pin that v3's thanks integration prevents the
  // surface from sticking after the author thanks the reviewer.
  const { root, cleanup } = bootstrapWithMembers();
  try {
    const filed = runGate(
      root,
      [
        'fast-track',
        '--action',
        'thanks-advances-boundary',
        '--reason',
        'gap-1 regression pin',
        '--format',
        'json',
      ],
      { GUILD_ACTOR: 'alice' },
    );
    const id = JSON.parse(filed.stdout).id;
    runGate(
      root,
      [
        'review',
        id,
        '--lense',
        'devil',
        '--verdict',
        'ok',
        '--comment',
        'lgtm',
      ],
      { GUILD_ACTOR: 'bob' },
    );
    // Confirm surface is up before the thank.
    const before = JSON.parse(
      runGate(root, ['boot'], { GUILD_ACTOR: 'alice' }).stdout,
    );
    assert.equal(before.suggested_next?.verb, 'show');
    assert.equal(before.status.reviews_unseen, 1);

    // alice thanks bob. addThank pushes onto thanks[] (no status_log
    // touch). v3 boundary computes lastAuthoredWriteAt over thanks[]
    // too, so the surface must clear.
    const thanked = runGate(
      root,
      ['thank', 'bob', '--for', id, '--reason', 'thanks for the review'],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(thanked.status, 0);

    const after = JSON.parse(
      runGate(root, ['boot'], { GUILD_ACTOR: 'alice' }).stdout,
    );
    // suggested_next must no longer point at this id (no other open
    // loops in this fixture, so it should be null).
    assert.equal(
      after.suggested_next,
      null,
      'thank by author must advance boundary so reviewed-authored clears',
    );
    assert.ok(
      !('reviews_unseen' in after.status) || after.status.reviews_unseen === 0,
      'reviews_unseen must be cleared (or absent) after thank',
    );
    const actionable = after.verbs_available_now.actionable as Array<{
      verb: string;
      id: string;
    }>;
    assert.ok(
      !actionable.some((a) => a.verb === 'show' && a.id === id),
      'actionable[] must drop the reviewed-authored entry after thank',
    );
  } finally {
    cleanup();
  }
});

test('gate boot: reviewed-authored actionable[] is capped at 5 entries', () => {
  // Voice budget: an actor with N authored × M reviews could balloon
  // the boot payload — boot is on the hot path. Cap actionable[] to
  // 5; the running total still surfaces via status.reviews_unseen.
  const { root, cleanup } = bootstrapWithMembers();
  try {
    const ids: string[] = [];
    // 7 authored requests by alice — file ALL of them first, THEN
    // bob reviews each. If we interleaved (fast-track then review,
    // repeat), each subsequent fast-track would advance alice's
    // boundary (status_log write) past the prior review, and only
    // the most recent review would remain "unseen". Batching keeps
    // every review strictly after alice's last write, which is the
    // shape the cap is protecting against.
    for (let i = 0; i < 7; i++) {
      const filed = runGate(
        root,
        [
          'fast-track',
          '--action',
          `cap probe ${i}`,
          '--reason',
          'cap-5 pin',
          '--format',
          'json',
        ],
        { GUILD_ACTOR: 'alice' },
      );
      assert.equal(filed.status, 0);
      ids.push(JSON.parse(filed.stdout).id);
    }
    for (const id of ids) {
      const reviewed = runGate(
        root,
        [
          'review',
          id,
          '--lense',
          'devil',
          '--verdict',
          'ok',
          '--comment',
          'lgtm',
        ],
        { GUILD_ACTOR: 'bob' },
      );
      assert.equal(reviewed.status, 0);
    }

    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    const showEntries = (
      payload.verbs_available_now.actionable as Array<{ verb: string }>
    ).filter((a) => a.verb === 'show');
    assert.equal(
      showEntries.length,
      5,
      'reviewed-authored entries in actionable[] must be capped at 5',
    );
    // Running total must reflect the full 7, not the capped view.
    assert.equal(payload.status.reviews_unseen, 7);
  } finally {
    cleanup();
  }
});

test('gate boot: reviewed-authored is suppressed when a higher-priority transition is open', () => {
  // Devil v3 ratify invariant: reviewed-authored sits at PRIORITY=4,
  // appended only when the four state-transition kinds are empty.
  // If alice has an executing-mine alongside a reviewed authored
  // request, suggested_next must point at complete, not show.
  const { root, cleanup } = bootstrapWithMembers();
  try {
    // Path A: authored request that gets a peer review (no exec to alice).
    const filedA = runGate(
      root,
      [
        'fast-track',
        '--action',
        'reviewed (low priority)',
        '--reason',
        'priority pin',
        '--format',
        'json',
      ],
      { GUILD_ACTOR: 'alice' },
    );
    const idA = JSON.parse(filedA.stdout).id;
    runGate(
      root,
      [
        'review',
        idA,
        '--lense',
        'devil',
        '--verdict',
        'ok',
        '--comment',
        'lgtm',
      ],
      { GUILD_ACTOR: 'bob' },
    );

    // Path B: a request that ends up executing-by-alice. Use the
    // four-step lifecycle so we can stop at executing.
    const filedB = runGate(
      root,
      [
        'request',
        '--action',
        'executing (high priority)',
        '--reason',
        'priority pin',
        '--executors',
        'alice',
        '--format',
        'json',
      ],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(filedB.status, 0);
    const idB = JSON.parse(filedB.stdout).id;
    // Approve as host, then execute as alice.
    const approved = runGate(root, ['approve', idB], { GUILD_ACTOR: 'human' });
    assert.equal(approved.status, 0);
    const executed = runGate(root, ['execute', idB], { GUILD_ACTOR: 'alice' });
    assert.equal(executed.status, 0);

    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    // Highest-priority transition wins suggested_next.
    assert.equal(payload.suggested_next?.verb, 'complete');
    assert.equal(payload.suggested_next?.args?.id, idB);
    // reviewed-authored must NOT contaminate actionable[] when
    // transitions are present (the if-guard is `out.length === 0`).
    const actionable = payload.verbs_available_now.actionable as Array<{
      verb: string;
      id: string;
    }>;
    assert.ok(
      !actionable.some((a) => a.verb === 'show' && a.id === idA),
      'reviewed-authored must be suppressed when state-transition work is pending',
    );
  } finally {
    cleanup();
  }
});

test('gate boot: host actor does NOT emit the "hosts have no inbox" warning', () => {
  // Pre-fix, every boot run by a host actor produced a 7-line warning
  // block ("inbox enrichment failed for actor=eris ... hosts do not
  // have inboxes"). That fact is already conveyed by `role: 'host'`
  // in the payload; emitting it as a warning every session inverts
  // principle 09 (orientation-disclosure: surface surprising cases,
  // stay quiet otherwise — being a host is not surprising state).
  // The fix skips inbox enrichment for role='host' so the warning
  // never fires on the host path.
  const { root, cleanup } = bootstrap(); // host_names: [human]
  try {
    const { stdout, status } = runGate(root, ['boot'], {
      GUILD_ACTOR: 'human',
    });
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);
    assert.equal(payload.role, 'host', 'host bootstrap precondition');
    const inboxWarning = (payload.warnings as string[]).find((w) =>
      w.includes('inbox enrichment failed'),
    );
    assert.equal(
      inboxWarning,
      undefined,
      'host boot must NOT raise inbox-enrichment warning (by-design no-inbox)',
    );
    // Sanity: a typo'd actor still surfaces the warning (the fix only
    // suppresses the host path, not unknown-actor diagnostics).
    const { stdout: typoStdout } = runGate(root, ['boot'], {
      GUILD_ACTOR: 'nope-typo',
    });
    const typoPayload = JSON.parse(typoStdout);
    assert.equal(typoPayload.role, 'unknown');
    const typoWarning = (typoPayload.warnings as string[]).find((w) =>
      w.includes('inbox enrichment failed'),
    );
    assert.ok(
      typoWarning,
      'unknown actor must still surface inbox-enrichment warning (typo diagnostic)',
    );
  } finally {
    cleanup();
  }
});

test('gate boot: executing wave where author≠executor does NOT surface to the author', () => {
  // Regression for the actionable-misattribution friction observed
  // 2026-05-13 on req 2026-05-08-0012 (author=eris, executors=[miki]).
  // boot surfaced `→ next: gate complete <id> --by eris` to the author,
  // but `gate complete --by <author>` errors with "not in this wave's
  // executors" — the suggestion is unactionable. The fix tightens the
  // executing-mine predicate so the author-only path matches only when
  // the executor list is empty (legacy / self-execute fallback).
  const { root, cleanup } = bootstrapWithMembers();
  try {
    // alice authors a wave executing-by-bob (author ≠ executor).
    const filed = runGate(
      root,
      [
        'request',
        '--action',
        'work for bob',
        '--reason',
        'author-not-executor pin',
        '--executors',
        'bob',
        '--format',
        'json',
      ],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(filed.status, 0);
    const id = JSON.parse(filed.stdout).id;
    assert.equal(
      runGate(root, ['approve', id], { GUILD_ACTOR: 'human' }).status,
      0,
    );
    assert.equal(
      runGate(root, ['execute', id], { GUILD_ACTOR: 'bob' }).status,
      0,
    );

    // alice's boot must NOT name her as `--by` on a complete/fail of
    // this id — she can't dispatch either.
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    const actionable = payload.verbs_available_now.actionable as Array<{
      verb: string;
      id: string;
    }>;
    assert.ok(
      !actionable.some(
        (a) => a.id === id && (a.verb === 'complete' || a.verb === 'fail'),
      ),
      'author-only must not appear in actionable[] complete/fail when executors list names someone else',
    );
    assert.notEqual(
      payload.suggested_next?.args?.id,
      id,
      'author-only must not be steered toward complete/fail on a wave executing-by-someone-else',
    );

    // bob's boot, by contrast, MUST surface the actionable.
    const { stdout: bobStdout } = runGate(root, ['boot'], {
      GUILD_ACTOR: 'bob',
    });
    const bobPayload = JSON.parse(bobStdout);
    const bobActionable = bobPayload.verbs_available_now.actionable as Array<{
      verb: string;
      id: string;
    }>;
    assert.ok(
      bobActionable.some((a) => a.id === id && a.verb === 'complete'),
      'assigned executor must still see complete in actionable[]',
    );
    assert.equal(bobPayload.suggested_next?.verb, 'complete');
    assert.equal(bobPayload.suggested_next?.args?.id, id);
    assert.equal(bobPayload.suggested_next?.args?.by, 'bob');
  } finally {
    cleanup();
  }
});

test('computeLastAuthoredWriteAt aggregates across status_log, reviews, and thanks', async () => {
  // Direct unit test — bypass the CLI to assert the aggregation
  // independently of the boot wiring. status_log (transitions),
  // reviews[] (judgements), and thanks[] (appreciation) all
  // contribute to the boundary. Latest of the three wins.
  const { computeLastAuthoredWriteAt } = await import(
    // Sibling-test pattern: source-relative spec, resolves to
    // dist/src after tsc emit (matches schema.test.ts, voices.test.ts).
    '../../src/interface/gate/handlers/boot.js'
  );

  // Stub `Request`-shaped objects with just the getters
  // computeLastAuthoredWriteAt reads. Plain objects suffice — the
  // function uses no Request methods, only the three array getters.
  // Mirror the in-memory shape: status_log carries `by: string` (raw
  // shape on entries), while reviews[]/thanks[] expose `by: MemberName`
  // via getters — so the stub uses `{ value }` for those.
  type MemberNameStub = { value: string };
  type Stub = {
    statusLog: ReadonlyArray<{ by: string; at: string }>;
    reviews: ReadonlyArray<{ by: MemberNameStub; at: string }>;
    thanks: ReadonlyArray<{ by: MemberNameStub; at: string }>;
  };
  const stubs: Stub[] = [
    {
      statusLog: [{ by: 'alice', at: '2026-05-01T10:00:00.000Z' }],
      reviews: [{ by: { value: 'alice' }, at: '2026-05-02T10:00:00.000Z' }],
      thanks: [{ by: { value: 'alice' }, at: '2026-05-03T10:00:00.000Z' }],
    },
    {
      statusLog: [{ by: 'bob', at: '2026-05-04T10:00:00.000Z' }],
      reviews: [],
      thanks: [],
    },
  ];

  const lastAlice = computeLastAuthoredWriteAt(
    'alice',
    stubs as unknown as Parameters<typeof computeLastAuthoredWriteAt>[1],
  );
  // Latest of the three alice writes is the thank at 2026-05-03.
  assert.equal(lastAlice, '2026-05-03T10:00:00.000Z');

  // bob has no thanks/reviews; only status_log contributes.
  const lastBob = computeLastAuthoredWriteAt(
    'bob',
    stubs as unknown as Parameters<typeof computeLastAuthoredWriteAt>[1],
  );
  assert.equal(lastBob, '2026-05-04T10:00:00.000Z');

  // Actor with no writes anywhere yields null.
  const lastNobody = computeLastAuthoredWriteAt(
    'nobody',
    stubs as unknown as Parameters<typeof computeLastAuthoredWriteAt>[1],
  );
  assert.equal(lastNobody, null);
});

