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
    assert.ok(p.verbs_available_now.always_readable.length >= 10);
    assert.ok(p.verbs_available_now.always_readable.includes('suggest'));
    assert.ok(p.verbs_available_now.always_readable.includes('schema'));
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
    assert.match(stdout, /devil lens/);
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
