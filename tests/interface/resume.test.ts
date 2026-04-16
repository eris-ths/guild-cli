// gate resume — continuity across sessions.
//
// Key invariants:
//   1. fresh actor (no activity) → empty loops, prose says "arriving fresh"
//   2. actor mid-execution → loop type=executing, suggested_next=complete
//   3. reviewer with unreviewed completion → loop type=pending_review,
//      suggested_next=review, verdict NOT pre-filled (consistent with
//      writeFormat's rubber-stamp guard)
//   4. actor not on the record → handled gracefully; not a crash
//   5. GUILD_ACTOR unset → exit 1, pointed error

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
import { ageHint } from '../../src/interface/gate/handlers/resume.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');
const GUILD = resolve(here, '../../../bin/guild.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-resume-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  mkdirSync(join(root, 'members'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? -1 };
}

function runGuild(cwd: string, args: string[]): void {
  spawnSync(process.execPath, [GUILD, ...args], { cwd, stdio: 'ignore' });
}

test('gate resume: requires GUILD_ACTOR and exits 1 when missing', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { status, stderr } = runGate(root, ['resume'], { GUILD_ACTOR: '' });
    assert.equal(status, 1);
    assert.match(stderr, /GUILD_ACTOR/i);
  } finally {
    cleanup();
  }
});

test('gate resume: fresh actor with no activity → empty loops, "arriving fresh" prose', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGuild(root, ['new', '--name', 'claude', '--category', 'professional']);
    const { stdout, status } = runGate(root, ['resume'], { GUILD_ACTOR: 'claude' });
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);
    assert.equal(payload.actor, 'claude');
    assert.equal(payload.last_context.last_utterance, null);
    assert.deepEqual(payload.last_context.open_loops, []);
    assert.equal(payload.suggested_next, null);
    assert.match(payload.restoration_prose, /arriving fresh/i);
  } finally {
    cleanup();
  }
});

test('gate resume: mid-execution → executing loop + complete suggestion', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGuild(root, ['new', '--name', 'claude', '--category', 'professional']);
    runGate(root, [
      'request',
      '--from', 'claude',
      '--action', 'do the thing',
      '--reason', 'because',
      '--executor', 'claude',
    ]);
    runGate(root, ['approve', '2026-04-16-0001', '--by', 'eris'].concat([]), {});
    // Advance to executing. Note: the generated id is deterministic
    // only by date, which the test uses the current date for — so
    // we discover the id from `gate pending` to avoid date fragility.
    const pending = runGate(root, ['pending', '--format', 'text']);
    const match = pending.stdout.match(/(\d{4}-\d{2}-\d{2}-\d{4})/);
    const id = match?.[1];
    if (!id) {
      // A different test already ran and consumed sequence numbers.
      // Collect approved instead.
      const approvedList = runGate(root, ['list', '--state', 'approved', '--format', 'text']);
      const m2 = approvedList.stdout.match(/(\d{4}-\d{2}-\d{2}-\d{4})/);
      assert.ok(m2, 'could not locate any id for the test request');
    }
    // Re-run the full sequence deterministically now that we know the id
    // shape (we'll just walk pending→approved→executing for the one id).
    const listApproved = runGate(root, ['list', '--state', 'approved', '--format', 'text']);
    const firstId =
      listApproved.stdout.match(/(\d{4}-\d{2}-\d{2}-\d{4})/)?.[1] ?? id;
    assert.ok(firstId);
    runGate(root, ['execute', firstId!, '--by', 'claude']);

    const { stdout } = runGate(root, ['resume'], { GUILD_ACTOR: 'claude' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.last_context.open_loops.length, 1);
    assert.equal(payload.last_context.open_loops[0].type, 'executing');
    assert.equal(payload.last_context.open_loops[0].role, 'executor');
    assert.equal(payload.suggested_next.verb, 'complete');
  } finally {
    cleanup();
  }
});

test('gate resume: pending review → pending_review loop + review suggestion without verdict default', () => {
  // This pins the cross-verb invariant established in writeFormat:
  // a review suggestion MUST NOT pre-fill verdict, or a lazy agent
  // will rubber-stamp. gate resume inherits the same guard by
  // delegating to deriveSuggestedNext.
  const { root, cleanup } = bootstrap();
  try {
    runGuild(root, ['new', '--name', 'alice', '--category', 'professional']);
    runGuild(root, ['new', '--name', 'bob', '--category', 'professional']);
    runGate(root, [
      'request',
      '--from', 'alice',
      '--action', 'ship',
      '--reason', 'now',
      '--executor', 'alice',
      '--auto-review', 'bob',
    ]);
    const list = runGate(root, ['list', '--state', 'pending', '--format', 'text']);
    const id = list.stdout.match(/(\d{4}-\d{2}-\d{2}-\d{4})/)?.[1];
    assert.ok(id);
    runGate(root, ['approve', id!, '--by', 'eris']);
    runGate(root, ['execute', id!, '--by', 'alice']);
    runGate(root, ['complete', id!, '--by', 'alice']);

    // Now resume as bob (the reviewer). Bob has not yet reviewed.
    const { stdout } = runGate(root, ['resume'], { GUILD_ACTOR: 'bob' });
    const payload = JSON.parse(stdout);
    const loops = payload.last_context.open_loops;
    assert.equal(loops.length, 1);
    assert.equal(loops[0].type, 'pending_review');
    assert.equal(loops[0].role, 'reviewer');
    assert.equal(payload.suggested_next.verb, 'review');
    assert.equal(
      payload.suggested_next.args.verdict,
      undefined,
      'review suggestion must NOT pre-fill verdict — same guard as writeFormat',
    );
  } finally {
    cleanup();
  }
});

test('gate resume: unknown actor returns gracefully (empty loops, prose notes fresh arrival)', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout, status } = runGate(root, ['resume'], {
      GUILD_ACTOR: 'nobody-here',
    });
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);
    assert.equal(payload.actor, 'nobody-here');
    assert.deepEqual(payload.last_context.open_loops, []);
    assert.match(payload.restoration_prose, /arriving fresh/i);
  } finally {
    cleanup();
  }
});

test('ageHint: scales from seconds to days', () => {
  const now = '2026-04-16T12:00:00.000Z';
  assert.match(ageHint('2026-04-16T12:00:00.000Z', now), /just now|0s ago/);
  assert.match(ageHint('2026-04-16T11:59:30.000Z', now), /30s ago/);
  assert.match(ageHint('2026-04-16T11:55:00.000Z', now), /5m ago/);
  assert.match(ageHint('2026-04-16T09:00:00.000Z', now), /3h ago/);
  assert.match(ageHint('2026-04-14T12:00:00.000Z', now), /2d ago/);
});

test('ageHint: future timestamps are flagged, not collapsed to "just now"', () => {
  // Clock skew evidence must survive — hiding it behind a cheerful
  // label would strip a signal the operator should see.
  const now = '2026-04-16T12:00:00.000Z';
  assert.match(ageHint('2026-04-16T13:00:00.000Z', now), /future.*clock skew/i);
  // Small positive deltas (<5s) are allowed to surface as "just now"
  // — clock comparisons under a second are noise, not evidence.
  assert.match(ageHint('2026-04-16T12:00:01.000Z', now), /just now/);
});

test('gate resume: GUILD_LOCALE=ja renders Japanese prose', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGuild(root, ['new', '--name', 'claude', '--category', 'professional']);
    const { stdout } = runGate(root, ['resume', '--format', 'text'], {
      GUILD_ACTOR: 'claude',
      GUILD_LOCALE: 'ja',
    });
    assert.match(stdout, /として再開/);
    assert.match(stdout, /新規参加です/);
  } finally {
    cleanup();
  }
});

test('gate resume: --locale arg overrides GUILD_LOCALE', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGuild(root, ['new', '--name', 'claude', '--category', 'professional']);
    // GUILD_LOCALE=ja would select JA, but --locale en must override.
    const { stdout } = runGate(root, ['resume', '--format', 'text', '--locale', 'en'], {
      GUILD_ACTOR: 'claude',
      GUILD_LOCALE: 'ja',
    });
    assert.match(stdout, /arriving fresh/);
  } finally {
    cleanup();
  }
});

test('gate resume: utterance vs transition are labeled distinctly in prose', () => {
  // The devil review caught this: prose should make clear which is
  // a recorded voice vs a lifecycle step, even when they coincide.
  const { root, cleanup } = bootstrap();
  try {
    runGuild(root, ['new', '--name', 'alice', '--category', 'professional']);
    runGate(root, [
      'request',
      '--from', 'alice',
      '--action', 'ship',
      '--reason', 'now',
      '--executor', 'alice',
    ]);
    const { stdout } = runGate(root, ['resume', '--format', 'text'], {
      GUILD_ACTOR: 'alice',
    });
    // Authoring a request creates both an utterance AND a
    // pending→created transition at the same timestamp; the prose
    // should show the utterance line explicitly as (utterance).
    assert.match(stdout, /\(utterance/);
  } finally {
    cleanup();
  }
});
