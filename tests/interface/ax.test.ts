// AX — AI-experience affordances.
//
// These tests pin agent-facing behaviors that a tool layer depends on:
//   - boot.suggested_next reaches beyond onboarding into the live
//     workflow (executing-by-me / unreviewed-mine / approved-for-me /
//     pending-as-executor) so an agent's orientation call returns
//     a single next verb to dispatch.
//   - --format json errors arrive on stderr as a parseable envelope
//     alongside the human-readable `error: …` line.
//   - board --format json echoes any implicit scoping so a JSON
//     consumer can tell "empty because filtered" from "empty because
//     nothing in flight".
//   - show --fields trims the payload for hot-loop callers.
//   - --dry-run previews state transitions without persisting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-ax-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, d));
  }
  for (const name of ['alice', 'bob']) {
    writeFileSync(
      join(root, 'members', `${name}.yaml`),
      `name: ${name}\ncategory: professional\nactive: true\n`,
    );
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
  input?: string,
): { stdout: string; stderr: string; status: number } {
  const opts: Parameters<typeof spawnSync>[2] = {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  };
  if (input !== undefined) opts.input = input;
  const r = spawnSync(process.execPath, [GATE, ...args], opts);
  return {
    stdout: typeof r.stdout === 'string' ? r.stdout : '',
    stderr: typeof r.stderr === 'string' ? r.stderr : '',
    status: r.status ?? -1,
  };
}

const today = () => new Date().toISOString().slice(0, 10);
const rid = (n: number) => `${today()}-${String(n).padStart(4, '0')}`;

// ── boot.suggested_next: workflow-stage routing ───────────────────

test('boot.suggested_next: pending-as-executor → approve', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.suggested_next?.verb, 'approve');
    assert.equal(payload.suggested_next?.args?.id, rid(1));
    assert.equal(payload.suggested_next?.args?.by, 'bob');
  } finally {
    cleanup();
  }
});

test('boot.suggested_next: approved-for-me → execute', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, ['approve', rid(1), '--by', 'alice']);
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.suggested_next?.verb, 'execute');
    assert.equal(payload.suggested_next?.args?.id, rid(1));
  } finally {
    cleanup();
  }
});

test('boot.suggested_next: executing-by-me → complete (takes priority)', () => {
  // If I'm mid-flight on request A and also have approved-for-me B
  // waiting, orient me back to A first — "finish what's in your hand".
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'A', '--reason', 'r', '--executor', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, ['approve', rid(1), '--by', 'alice']);
    runGate(root, ['execute', rid(1), '--by', 'bob']);
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'B', '--reason', 'r', '--executor', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, ['approve', rid(2), '--by', 'alice']);
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.suggested_next?.verb, 'complete');
    assert.equal(payload.suggested_next?.args?.id, rid(1));
  } finally {
    cleanup();
  }
});

test('boot.suggested_next: unreviewed-mine → review', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r', '--auto-review', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.suggested_next?.verb, 'review');
    assert.equal(payload.suggested_next?.args?.id, rid(1));
    assert.equal(payload.suggested_next?.args?.lense, 'devil');
  } finally {
    cleanup();
  }
});

// ── --format json: structured error envelope ─────────────────────

test('--format json: errors emit a JSON envelope on stderr', () => {
  const { root, cleanup } = bootstrap();
  try {
    // Complete an id that doesn't exist → DomainError.
    const { stdout, stderr, status } = runGate(
      root,
      ['approve', '9999-99-99-0001', '--by', 'alice', '--format', 'json'],
    );
    assert.equal(status, 1);
    assert.equal(stdout, '');
    // First line of stderr is the JSON envelope; the second is the
    // human-readable `error: …` line kept for terminal readers.
    const firstLine = stderr.split('\n').find((l) => l.trim().startsWith('{'));
    assert.ok(firstLine, 'expected a JSON envelope line on stderr');
    const payload = JSON.parse(firstLine!);
    assert.equal(payload.ok, false);
    assert.equal(typeof payload.error?.message, 'string');
    assert.match(payload.error.message, /Request not found/);
  } finally {
    cleanup();
  }
});

test('--format json not set: errors stay text-only (no JSON leak)', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stderr, status } = runGate(
      root,
      ['approve', '9999-99-99-0001', '--by', 'alice'],
    );
    assert.equal(status, 1);
    // stderr has the `error:` line and nothing else — no JSON envelope
    // should leak into non-json mode.
    assert.equal(/\{\s*"ok"/.test(stderr), false);
    assert.match(stderr, /^error: /);
  } finally {
    cleanup();
  }
});

// ── board --format json: filter meta ─────────────────────────────

test('board --format json: _meta.filter echoes GUILD_ACTOR scoping', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['board', '--format', 'json'], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    assert.deepEqual(payload._meta?.filter, { actor: 'alice', source: 'GUILD_ACTOR' });
  } finally {
    cleanup();
  }
});

test('board --format json: _meta.filter echoes --for source when explicit', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['board', '--format', 'json', '--for', 'alice']);
    const payload = JSON.parse(stdout);
    assert.deepEqual(payload._meta?.filter, { actor: 'alice', source: '--for' });
  } finally {
    cleanup();
  }
});

test('board --format json: no _meta when unfiltered (global view)', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['board', '--format', 'json']);
    const payload = JSON.parse(stdout);
    assert.equal('_meta' in payload, false);
  } finally {
    cleanup();
  }
});

// ── gate show --fields ───────────────────────────────────────────

test('show --fields: trims JSON to requested keys', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['show', rid(1), '--fields', 'state,executor']);
    const payload = JSON.parse(stdout);
    assert.deepEqual(Object.keys(payload).sort(), ['executor', 'state']);
    assert.equal(payload.state, 'pending');
    assert.equal(payload.executor, 'bob');
  } finally {
    cleanup();
  }
});

test('show --fields: unknown keys silently dropped (not errored)', () => {
  // "Silently dropped" is an intentional agent affordance: tool layers
  // may enumerate an optimistic field set; we don't want speculative
  // keys to take down the whole call.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['show', rid(1), '--fields', 'state,not_a_field']);
    const payload = JSON.parse(stdout);
    assert.deepEqual(Object.keys(payload), ['state']);
  } finally {
    cleanup();
  }
});

// ── gate suggest: tight-loop sibling of boot ─────────────────────

test('suggest --format json: returns the same triple as boot, no orientation payload', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const bootOut = JSON.parse(runGate(root, ['boot'], { GUILD_ACTOR: 'bob' }).stdout);
    const suggestOut = JSON.parse(runGate(root, ['suggest'], { GUILD_ACTOR: 'bob' }).stdout);
    // Same suggestion.
    assert.deepEqual(bootOut.suggested_next, suggestOut.suggested_next);
    // Orientation keys present in boot, absent in suggest.
    assert.ok('status' in bootOut);
    assert.ok('tail' in bootOut);
    assert.equal('status' in suggestOut, false);
    assert.equal('tail' in suggestOut, false);
    // Payload shrinks dramatically — suggest is the hot-loop form.
    const bootStr = JSON.stringify(bootOut);
    const suggestStr = JSON.stringify(suggestOut);
    assert.ok(
      suggestStr.length < bootStr.length / 3,
      `expected suggest to be <1/3 of boot, got ${suggestStr.length} vs ${bootStr.length}`,
    );
  } finally {
    cleanup();
  }
});

test('suggest: null when registered actor has nothing to do', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['suggest'], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.suggested_next, null);
  } finally {
    cleanup();
  }
});

test('suggest --format text: compact two-line form for humans', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(
      root,
      ['suggest', '--format', 'text'],
      { GUILD_ACTOR: 'bob' },
    );
    // Line 1: → verb arg=val arg=val
    // Line 2: the reason, indented
    const lines = stdout.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /^→ approve/);
    assert.match(lines[0]!, /id=/);
    assert.match(lines[0]!, /by=bob/);
    assert.match(lines[1]!, /^  /);
  } finally {
    cleanup();
  }
});

// ── boot.verbs_available_now: state-aware verb discovery ────────

test('boot.verbs_available_now: actionable lists all valid transitions', () => {
  // bob has executing-by-me (0001) AND unreviewed-mine (0002). suggested_next
  // picks ONE; actionable lists ALL siblings so a branching agent sees
  // the other options.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 't1', '--reason', 'r', '--executor', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, ['approve', rid(1), '--by', 'alice']);
    runGate(root, ['execute', rid(1), '--by', 'bob']);
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 't2', '--reason', 'r', '--auto-review', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
    const p = JSON.parse(stdout);
    const verbs = p.verbs_available_now.actionable.map(
      (a: { verb: string }) => a.verb,
    );
    assert.ok(verbs.includes('complete'), 'complete missing');
    assert.ok(verbs.includes('fail'), 'fail missing');
    assert.ok(verbs.includes('review'), 'review missing');
    // suggested_next is ONE of the actionable entries.
    assert.ok(
      verbs.includes(p.suggested_next.verb),
      'suggested_next must be in actionable list',
    );
  } finally {
    cleanup();
  }
});

test('boot.verbs_available_now: always_readable present for anonymous caller', () => {
  // Initial-agent discovery: without identity, actionable is empty
  // (can't transition anything), but always_readable still names
  // the read surface so newcomers see the map.
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['boot']);
    const p = JSON.parse(stdout);
    assert.equal(p.verbs_available_now.actionable.length, 0);
    assert.equal(p.verbs_available_now.requires_other_actor.length, 0);
    assert.ok(p.verbs_available_now.always_readable.length >= 10);
    assert.ok(p.verbs_available_now.always_readable.includes('suggest'));
    assert.ok(p.verbs_available_now.always_readable.includes('schema'));
    assert.ok(p.verbs_available_now.always_readable.includes('unresponded'));
  } finally {
    cleanup();
  }
});

test('boot.verbs_available_now: requires_other_actor surfaces pending blockers', () => {
  // 2.A: a non-host author who filed a pending request sees the
  // approval blocker — verb=approve, candidates=[host], reason
  // explains why they can't act alone. This is the gap that bit
  // first-time agents: suggested_next would return "by: host" with
  // no obvious context for why the actor's own --by wouldn't work.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'pending', '--reason', 'r', '--executor', 'alice'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'alice' });
    const p = JSON.parse(stdout);
    assert.equal(p.verbs_available_now.actionable.length, 0);
    assert.ok(
      p.verbs_available_now.requires_other_actor.length >= 1,
      'expected a pending-approval blocker for alice',
    );
    const blocker = p.verbs_available_now.requires_other_actor[0];
    assert.equal(blocker.verb, 'approve');
    assert.deepEqual(blocker.candidates, ['human']);
    assert.match(blocker.reason, /pending/i);
  } finally {
    cleanup();
  }
});

test('boot.verbs_available_now: host self-approval doesnt double-list as blocker', () => {
  // When the actor IS the host, pending requests on their own
  // record show up under actionable (pending-as-executor) — NOT
  // under requires_other_actor, since the host can self-approve.
  const { root, cleanup } = bootstrap();
  try {
    // human is the host; have human file + name self executor
    runGate(
      root,
      ['request', '--from', 'human', '--action', 'self', '--reason', 'r', '--executor', 'human'],
      { GUILD_ACTOR: 'human' },
    );
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'human' });
    const p = JSON.parse(stdout);
    assert.equal(
      p.verbs_available_now.requires_other_actor.length,
      0,
      'host should not see their own pending-approval as blocker',
    );
  } finally {
    cleanup();
  }
});

test('write response suggested_next carries actor_resolved', () => {
  // 2.E: the boolean lets an orchestrator branch without parsing
  // `args.by` against the env. True when args.by is absent or
  // matches GUILD_ACTOR, false otherwise.
  const { root, cleanup } = bootstrap();
  try {
    const created = runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'alice', '--format', 'json'],
      { GUILD_ACTOR: 'alice' },
    );
    const payload = JSON.parse(created.stdout);
    // Pending state suggests approve by host (human). alice is not
    // the host, so actor_resolved=false.
    assert.equal(payload.suggested_next.verb, 'approve');
    assert.equal(payload.suggested_next.args.by, 'human');
    assert.equal(payload.suggested_next.actor_resolved, false);
  } finally {
    cleanup();
  }
});

test('boot.verbs_available_now: actionable entries carry id + reason', () => {
  // The reason converts "approve exists" into "approve is valid on
  // this id because …" — teaching not just catalog.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
    const p = JSON.parse(stdout);
    const approve = p.verbs_available_now.actionable.find(
      (a: { verb: string }) => a.verb === 'approve',
    );
    assert.ok(approve, 'approve should be actionable');
    assert.equal(approve.id, rid(1));
    assert.match(approve.reason, /pending/);
    assert.match(approve.reason, /executor/);
  } finally {
    cleanup();
  }
});

// ── voice calibration: Two-Persona Devil gets a memory ──────────

test('voices --with-calibration: aligns verdicts against terminal outcomes', () => {
  // Carol files sharp concerns on things that later fail — her
  // devil-lense calibration should read as "trusted". Bob rubber-
  // stamps ok on things that fail — "learning".
  const { root, cleanup } = bootstrap();
  try {
    // Register carol (only alice + bob exist in the bootstrap).
    const r = runGate(root, ['register', '--name', 'carol']);
    assert.equal(r.status, 0);

    // 7 lifecycles: 4 failed + 3 completed. Bob always ok, carol
    // rejects failures and oks completions.
    const outcomes: Array<['completed' | 'failed', number]> = [
      ['completed', 1], ['failed', 2], ['failed', 3], ['completed', 4],
      ['failed', 5], ['failed', 6], ['completed', 7],
    ];
    for (const [state, n] of outcomes) {
      const id = rid(n);
      runGate(
        root,
        ['request', '--from', 'alice', '--action', `t${n}`, '--reason', 'r', '--executor', 'alice'],
        { GUILD_ACTOR: 'alice' },
      );
      runGate(root, ['approve', id, '--by', 'alice']);
      runGate(root, ['execute', id, '--by', 'alice']);
      if (state === 'completed') {
        runGate(root, ['complete', id, '--by', 'alice']);
      } else {
        runGate(root, ['fail', id, '--by', 'alice', '--reason', 'nope']);
      }
      runGate(root, [
        'review', id, '--by', 'bob', '--lense', 'devil', '--verdict', 'ok', '--comment', 'b',
      ]);
      const carolV = state === 'completed' ? 'ok' : 'reject';
      runGate(root, [
        'review', id, '--by', 'carol', '--lense', 'devil', '--verdict', carolV, '--comment', 'c',
      ]);
    }

    const { stdout: carolJson } = runGate(
      root,
      ['voices', 'carol', '--format', 'json', '--with-calibration'],
      { GUILD_ACTOR: 'alice' },
    );
    const carol = JSON.parse(carolJson).calibration;
    assert.equal(carol.by_lens.devil.status, 'trusted');
    assert.equal(carol.by_lens.devil.aligned, 7);
    assert.equal(carol.by_lens.devil.missed, 0);

    const { stdout: bobJson } = runGate(
      root,
      ['voices', 'bob', '--format', 'json', '--with-calibration'],
      { GUILD_ACTOR: 'alice' },
    );
    const bob = JSON.parse(bobJson).calibration;
    assert.equal(bob.by_lens.devil.status, 'learning');
    assert.equal(bob.by_lens.devil.aligned, 3);
    assert.equal(bob.by_lens.devil.missed, 4);
  } finally {
    cleanup();
  }
});

test('voices: self-view hides calibration (no self-optimisation)', () => {
  // Voter shouldn't see their own score — the calibration only lands
  // when viewing OTHER voices. Keeps the signal honest (if you can't
  // see it, you can't game it).
  const { root, cleanup } = bootstrap();
  try {
    // Seed one review so there's data to hide.
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, [
      'review', rid(1), '--by', 'bob', '--lense', 'devil', '--verdict', 'ok', '--comment', 'b',
    ]);

    // bob views himself: calibration block NOT rendered in text.
    const selfText = runGate(root, ['voices', 'bob', '--format', 'text'], { GUILD_ACTOR: 'bob' });
    assert.equal(/calibration/.test(selfText.stdout), false);

    // alice views bob: calibration block IS present (or at least the
    // footer header renders, even if sample count is low).
    const viewText = runGate(root, ['voices', 'bob', '--format', 'text'], { GUILD_ACTOR: 'alice' });
    assert.match(viewText.stdout, /calibration/);

    // JSON path: self-view returns null calibration under the flag.
    const selfJson = runGate(
      root,
      ['voices', 'bob', '--format', 'json', '--with-calibration'],
      { GUILD_ACTOR: 'bob' },
    );
    const payload = JSON.parse(selfJson.stdout);
    assert.equal(payload.calibration, null);
  } finally {
    cleanup();
  }
});

test('voices: default JSON shape unchanged (backward compat)', () => {
  // `--with-calibration` is opt-in; without it, the JSON remains an
  // array of utterances so existing consumers don't break.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['voices', 'alice', '--format', 'json']);
    const payload = JSON.parse(stdout);
    assert.ok(Array.isArray(payload), 'default JSON should still be an array');
  } finally {
    cleanup();
  }
});

test('voices calibration: samples < 5 reads as "uncalibrated"', () => {
  // Noise floor: a handful of verdicts isn't signal. Show the count
  // so a reader sees where we are on the ramp, but don't claim a
  // status from incomplete data.
  const { root, cleanup } = bootstrap();
  try {
    for (let n = 1; n <= 3; n++) {
      runGate(
        root,
        ['fast-track', '--from', 'alice', '--action', `t${n}`, '--reason', 'r'],
        { GUILD_ACTOR: 'alice' },
      );
      runGate(root, [
        'review', rid(n), '--by', 'bob', '--lense', 'devil', '--verdict', 'ok', '--comment', 'b',
      ]);
    }
    const { stdout } = runGate(
      root,
      ['voices', 'bob', '--format', 'json', '--with-calibration'],
      { GUILD_ACTOR: 'alice' },
    );
    const calib = JSON.parse(stdout).calibration;
    assert.equal(calib.by_lens.devil.status, 'uncalibrated');
    assert.equal(calib.by_lens.devil.sample_count, 3);
    assert.equal(calib.by_lens.devil.alignment, null);
  } finally {
    cleanup();
  }
});

// ── gate thank: cross-actor appreciation primitive ──────────────

test('thank: records appreciation with by/to/reason on the request', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { status } = runGate(
      root,
      ['thank', 'bob', '--for', rid(1), '--reason', 'nice work'],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(status, 0);
    const { stdout } = runGate(root, ['show', rid(1), '--fields', 'thanks']);
    const payload = JSON.parse(stdout);
    assert.equal(payload.thanks.length, 1);
    assert.equal(payload.thanks[0].by, 'alice');
    assert.equal(payload.thanks[0].to, 'bob');
    assert.equal(payload.thanks[0].reason, 'nice work');
    assert.equal(typeof payload.thanks[0].at, 'string');
  } finally {
    cleanup();
  }
});

test('thank: does NOT affect state or reviews (orthogonal record)', () => {
  // Critical invariant: thanks is NOT a state transition and does
  // NOT feed calibration. Keep these concerns orthogonal.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, ['thank', 'alice', '--for', rid(1), '--reason', 'ty'], {
      GUILD_ACTOR: 'alice',
    });
    const { stdout } = runGate(root, ['show', rid(1)]);
    const p = JSON.parse(stdout);
    assert.equal(p.state, 'completed');
    assert.equal(p.reviews.length, 0);
    assert.equal(p.thanks.length, 1);
  } finally {
    cleanup();
  }
});

test('thank: reason is optional', () => {
  // Most of the time the fact of the thank is the signal; a reason
  // is a grace note. The schema doesn't require it.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { status } = runGate(root, ['thank', 'bob', '--for', rid(1)], {
      GUILD_ACTOR: 'alice',
    });
    assert.equal(status, 0);
    const { stdout } = runGate(root, ['show', rid(1), '--fields', 'thanks']);
    const thanks = JSON.parse(stdout).thanks;
    assert.equal(thanks[0].reason, undefined);
  } finally {
    cleanup();
  }
});

test('thank: self-thank emits stderr notice but succeeds', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r'],
      { GUILD_ACTOR: 'alice' },
    );
    const { status, stderr } = runGate(
      root,
      ['thank', 'alice', '--for', rid(1), '--reason', 'past me'],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(status, 0);
    assert.match(stderr, /self-thank/);
  } finally {
    cleanup();
  }
});

test('thank: unknown --to actor fails with a validation error', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r'],
      { GUILD_ACTOR: 'alice' },
    );
    const { status, stderr } = runGate(
      root,
      ['thank', 'ghost', '--for', rid(1)],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(status, 1);
    assert.match(stderr, /ghost/);
  } finally {
    cleanup();
  }
});

test('thank --dry-run: preview without persist', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout, status } = runGate(
      root,
      ['thank', 'bob', '--for', rid(1), '--reason', 'preview', '--dry-run'],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(status, 0);
    const p = JSON.parse(stdout);
    assert.equal(p.dry_run, true);
    assert.equal(p.verb, 'thank');
    assert.equal(p.preview.thanks.length, 1);
    // Real record has no thanks yet.
    const after = JSON.parse(
      runGate(root, ['show', rid(1)]).stdout,
    );
    assert.ok(after.thanks === undefined || after.thanks.length === 0);
  } finally {
    cleanup();
  }
});

// ── suggested_next advisory semantics ───────────────────────────

test('suggest --format text: advisory footer goes to stderr, stdout stays composable', () => {
  // Humans scanning the terminal see the reminder that suggested_next
  // is a heuristic. But `$(gate suggest --format text)` captures
  // stdout, which must stay clean for shell composition.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout, stderr } = runGate(
      root,
      ['suggest', '--format', 'text'],
      { GUILD_ACTOR: 'bob' },
    );
    assert.match(stderr, /advisory/);
    assert.equal(/advisory/.test(stdout), false);
    // Stdout still carries the actionable two-line output.
    assert.match(stdout, /→ approve/);
  } finally {
    cleanup();
  }
});

test('schema: suggested_next descriptions name the "advisory, not directive" semantic', () => {
  // This is the durable surface — tool layers reading the schema
  // get the semantic without parsing the runtime output. Easier to
  // wire correctly once than to discover through experimentation.
  const { root, cleanup } = bootstrap();
  try {
    const bootSchema = JSON.parse(
      runGate(root, ['schema', '--verb', 'boot', '--format', 'json']).stdout,
    );
    const bootSN =
      bootSchema.verbs[0].output.properties.suggested_next.description;
    assert.ok(typeof bootSN === 'string');
    assert.match(bootSN, /[Aa]dvisory/);
    assert.match(bootSN, /not a directive|NOT a directive/);

    const suggestSchema = JSON.parse(
      runGate(root, ['schema', '--verb', 'suggest', '--format', 'json']).stdout,
    );
    const suggestSN =
      suggestSchema.verbs[0].output.properties.suggested_next.description;
    assert.ok(typeof suggestSN === 'string');
    assert.match(suggestSN, /[Aa]dvisory/);
    assert.match(suggestSN, /override/);
  } finally {
    cleanup();
  }
});

// ── thank integration: utterance stream & transcript fold-in ────

test('thank: appears in gate tail as a directional utterance', () => {
  // tail is the unified cross-actor stream. Thanks share the stream
  // with authored/review utterances so a reader scanning activity
  // sees the appreciation alongside the decisions.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, ['thank', 'bob', '--for', rid(1), '--reason', 'nice'], {
      GUILD_ACTOR: 'alice',
    });
    const { stdout } = runGate(root, ['tail']);
    assert.match(stdout, /thank alice → bob/);
    assert.match(stdout, /re: x/);
  } finally {
    cleanup();
  }
});

test('voices <name>: surfaces thanks in BOTH directions (given and received)', () => {
  // Reviews are one-sided (only `by` speaks). Thanks involve two
  // actors; voices matches either side so a voice's full
  // appreciation footprint — given AND received — is visible when
  // looking at them.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    // alice thanks bob (bob receives)
    runGate(root, ['thank', 'bob', '--for', rid(1), '--reason', 'a-to-b'], {
      GUILD_ACTOR: 'alice',
    });
    // bob thanks alice (bob gives)
    runGate(root, ['thank', 'alice', '--for', rid(1), '--reason', 'b-to-a'], {
      GUILD_ACTOR: 'bob',
    });
    const { stdout } = runGate(root, ['voices', 'bob', '--format', 'text']);
    // Both directions land in bob's stream.
    assert.match(stdout, /thank alice → bob/);
    assert.match(stdout, /thank bob → alice/);
    assert.match(stdout, /a-to-b/);
    assert.match(stdout, /b-to-a/);
  } finally {
    cleanup();
  }
});

test('voices: lense/verdict filters DO NOT surface thanks (reviews only)', () => {
  // thanks have no lense and no verdict. A lense-scoped query is
  // asking for reviews through that lense; including thanks would
  // be a category error.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, ['thank', 'bob', '--for', rid(1), '--reason', 'nice'], {
      GUILD_ACTOR: 'alice',
    });
    const { stdout } = runGate(
      root,
      ['voices', 'alice', '--format', 'text', '--lense', 'devil'],
    );
    assert.equal(/thank/.test(stdout), false);
    assert.match(stdout, /no utterances|reviews/);
  } finally {
    cleanup();
  }
});

test('transcript: thanks appear as their own prose paragraph + in summary', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, ['thank', 'bob', '--for', rid(1), '--reason', 'elegant'], {
      GUILD_ACTOR: 'alice',
    });
    const { stdout } = runGate(root, ['transcript', rid(1)]);
    assert.match(stdout, /Alice thanked bob/);
    assert.match(stdout, /elegant/);

    const jsonOut = runGate(root, ['transcript', rid(1), '--format', 'json']);
    const p = JSON.parse(jsonOut.stdout);
    assert.equal(p.summary.thank_count, 1);
  } finally {
    cleanup();
  }
});

// ── gate transcript: narrative arc of one request ───────────────

test('transcript: narrative prose names filer, action, executor, reviews', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      [
        'request', '--from', 'alice',
        '--action', 'refactor parser',
        '--reason', 'cut p99 latency',
        '--executor', 'bob',
        '--auto-review', 'alice',
      ],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, ['approve', rid(1), '--by', 'alice']);
    runGate(root, ['execute', rid(1), '--by', 'bob']);
    runGate(root, ['complete', rid(1), '--by', 'bob', '--note', 'landed in abc123']);
    runGate(
      root,
      ['review', rid(1), '--by', 'alice', '--lense', 'devil', '--verdict', 'ok', '--comment', 'LGTM'],
    );
    const { stdout } = runGate(root, ['transcript', rid(1)]);
    assert.match(stdout, /Alice filed/);
    assert.match(stdout, /refactor parser/);
    assert.match(stdout, /bob as executor/);
    assert.match(stdout, /Bob moved it to completed/);
    assert.match(stdout, /devil lense/);
    assert.match(stdout, /verdict of ok/);
    assert.match(stdout, /LGTM/);
    assert.match(stdout, /Final state: completed/);
  } finally {
    cleanup();
  }
});

test('transcript --format json: summary carries structured fields', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, ['approve', rid(1), '--by', 'alice']);
    runGate(root, ['execute', rid(1), '--by', 'bob']);
    runGate(root, ['complete', rid(1), '--by', 'bob']);
    const { stdout } = runGate(root, ['transcript', rid(1), '--format', 'json']);
    const p = JSON.parse(stdout);
    assert.equal(p.id, rid(1));
    assert.ok(typeof p.arc === 'string');
    assert.ok(p.arc.length > 50);
    assert.equal(p.summary.actor_count, 2);
    assert.deepEqual(p.summary.actors.sort(), ['alice', 'bob']);
    assert.equal(p.summary.final_state, 'completed');
    assert.equal(typeof p.summary.duration_ms, 'number');
  } finally {
    cleanup();
  }
});

test('transcript: self-loop arc surfaces as "carried out by X alone"', () => {
  // The textual echo of the self-loop-check plugin: one sentence in
  // the summary names the mono-actor pattern per-request.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['transcript', rid(1)]);
    assert.match(stdout, /carried out by alice alone/);
  } finally {
    cleanup();
  }
});

test('transcript: pending auto-review is named explicitly', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r', '--auto-review', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['transcript', rid(1)]);
    assert.match(stdout, /Auto-review is pending: bob/);
  } finally {
    cleanup();
  }
});

// ── gate show --plain: shell-friendly single-field output ────────

test('show --plain --fields <key>: emits raw value, no JSON quoting', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['show', rid(1), '--fields', 'state', '--plain']);
    assert.equal(stdout, 'pending\n');
  } finally {
    cleanup();
  }
});

test('show --plain: requires exactly one field', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r'],
      { GUILD_ACTOR: 'alice' },
    );
    const noFields = runGate(root, ['show', rid(1), '--plain']);
    assert.equal(noFields.status, 1);
    assert.match(noFields.stderr, /requires exactly one field/);
    const multi = runGate(root, ['show', rid(1), '--fields', 'state,from', '--plain']);
    assert.equal(multi.status, 1);
    assert.match(multi.stderr, /requires exactly one field/);
  } finally {
    cleanup();
  }
});

test('show --plain: missing field = empty stdout + exit 1 (shell-friendly)', () => {
  // `[ -z "$v" ]` should be a usable check for "field not present"
  // without the caller having to parse or differentiate error modes.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout, status } = runGate(
      root,
      ['show', rid(1), '--fields', 'not_a_field', '--plain'],
    );
    assert.equal(stdout, '');
    assert.equal(status, 1);
  } finally {
    cleanup();
  }
});

// ── --dry-run on state-transition verbs ──────────────────────────

test('approve --dry-run: emits preview envelope, does NOT persist', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout, status } = runGate(
      root,
      ['approve', rid(1), '--by', 'alice', '--dry-run'],
    );
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);
    assert.equal(payload.dry_run, true);
    assert.equal(payload.verb, 'approve');
    assert.deepEqual(payload.would_transition, { from: 'pending', to: 'approved' });
    assert.equal(payload.preview.state, 'approved');
    // After dry-run, the real record is still pending.
    const after = JSON.parse(
      runGate(root, ['show', rid(1), '--fields', 'state']).stdout,
    );
    assert.equal(after.state, 'pending');
  } finally {
    cleanup();
  }
});

test('review --dry-run: preview includes new review without persisting', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r'],
      { GUILD_ACTOR: 'alice' },
    );
    // Bare `--dry-run` followed by the positional comment `looks good`
    // works because `dry-run` is listed in KNOWN_BOOLEAN_FLAGS — the
    // parser won't speculatively consume the next token as the flag's
    // value. Before that fix this line needed `--dry-run=true`.
    const { stdout, status } = runGate(
      root,
      [
        'review', rid(1),
        '--by', 'bob',
        '--lense', 'devil',
        '--verdict', 'ok',
        '--dry-run',
        'looks good',
      ],
    );
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);
    assert.equal(payload.dry_run, true);
    assert.equal(payload.verb, 'review');
    // No state transition for review — envelope omits the field.
    assert.equal('would_transition' in payload, false);
    assert.equal(payload.preview.reviews.length, 1);
    // After dry-run, real reviews list is still empty.
    const after = JSON.parse(runGate(root, ['show', rid(1)]).stdout);
    assert.equal(after.reviews.length, 0);
  } finally {
    cleanup();
  }
});


// ── suggest text-mode footer: context-sensitivity ─────────────────

test('suggest --format text suppresses advisory footer for export verb', () => {
  // GUILD_ACTOR-unset bootstrap: suggest returns verb=export which is
  // a shell builtin used to set the env var, not a gate dispatch.
  // The "# advisory — override freely" footer applies to heuristic
  // gate verbs; pinning it onto an env-var bootstrap reads as
  // "you can ignore this", which is wrong — without GUILD_ACTOR the
  // agent stays anonymous. The footer is suppressed for export.
  const { root, cleanup } = bootstrap();
  try {
    const out = runGate(root, ["suggest", "--format", "text"]);
    assert.equal(out.status, 0);
    assert.match(out.stdout, /export GUILD_ACTOR/);
    // No advisory footer (which would land on stderr) for the
    // export case.
    assert.doesNotMatch(out.stderr, /advisory/);
  } finally {
    cleanup();
  }
});

test('suggest --format text keeps advisory footer for gate verbs', () => {
  // Regression: the footer should still appear when the suggestion
  // is a real gate dispatch (not export). Drives a request to
  // pending-as-executor so suggest returns a non-null gate verb.
  const { root, cleanup } = bootstrap();
  try {
    runGate(root, [
      "request",
      "--from", "alice",
      "--action", "do thing",
      "--reason", "r",
      "--executor", "bob",
    ], { GUILD_ACTOR: "alice" });
    const out = runGate(root, ["suggest", "--format", "text"], { GUILD_ACTOR: "bob" });
    assert.equal(out.status, 0);
    assert.match(out.stdout, /^→ approve/m);
    assert.match(out.stderr, /advisory — override freely/);
  } finally {
    cleanup();
  }
});
