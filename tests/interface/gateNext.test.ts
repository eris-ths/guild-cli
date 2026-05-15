// gate next — one-call read-and-dispatch of the top actionable verb.
//
// Composes boot's actionable ladder with verb dispatch so an agent
// loop can chain `gate boot && gate next --confirm` to drain its
// queue. Auto-dispatch is limited to verbs needing only `--by`
// (complete / execute / approve / show); verbs needing extra args
// (review / deny / fail) refuse and prompt for manual invocation.
//
// Pattern doc: memory/eris_first_overrides.md default rubric
// (pure shape, AI-first universal — first iteration of the "agent
// loop ergonomics" cluster).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-next-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

test('gate next: exits 2 with "(no actionable work)" when nothing in queue', () => {
  const b = bootstrap();
  try {
    const r = run(b.root, ['next'], { GUILD_ACTOR: 'alice' });
    assert.equal(r.status, 2, 'exit 2 signals empty actionable (loop terminator)');
    assert.match(r.stdout, /no actionable work/);
  } finally {
    b.cleanup();
  }
});

test('gate next without --confirm prints the plan, exits 0', () => {
  const b = bootstrap();
  try {
    // Seed: eris files a request naming alice as executor → alice
    // sees a pending-as-executor actionable (approve).
    const filed = run(
      b.root,
      [
        'request',
        '--action', 'probe',
        '--reason', 'r',
        '--executors', 'alice',
        '--format', 'json',
      ],
      { GUILD_ACTOR: 'eris' },
    );
    assert.equal(filed.status, 0);
    const id = (JSON.parse(filed.stdout) as { id: string }).id;

    const r = run(b.root, ['next'], { GUILD_ACTOR: 'alice' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, new RegExp(`gate approve ${id} --by alice`));
  } finally {
    b.cleanup();
  }
});

test('gate next --format json emits structured plan envelope', () => {
  const b = bootstrap();
  try {
    const filed = run(
      b.root,
      [
        'request',
        '--action', 'probe',
        '--reason', 'r',
        '--executors', 'alice',
        '--format', 'json',
      ],
      { GUILD_ACTOR: 'eris' },
    );
    const id = (JSON.parse(filed.stdout) as { id: string }).id;

    const r = run(b.root, ['next', '--format', 'json'], { GUILD_ACTOR: 'alice' });
    assert.equal(r.status, 0);
    const payload = JSON.parse(r.stdout);
    assert.equal(payload.dispatched, false);
    assert.equal(payload.plan.verb, 'approve');
    assert.equal(payload.plan.id, id);
    assert.equal(payload.plan.by, 'alice');
    assert.equal(payload.plan.can_auto_dispatch, true);
    assert.match(payload.plan.command, new RegExp(`gate approve ${id} --by alice`));
  } finally {
    b.cleanup();
  }
});

test('gate next --confirm dispatches the top actionable verb', () => {
  const b = bootstrap();
  try {
    const filed = run(
      b.root,
      [
        'request',
        '--action', 'probe',
        '--reason', 'r',
        '--executors', 'alice',
        '--format', 'json',
      ],
      { GUILD_ACTOR: 'eris' },
    );
    const id = (JSON.parse(filed.stdout) as { id: string }).id;

    const r = run(b.root, ['next', '--confirm'], { GUILD_ACTOR: 'alice' });
    assert.equal(r.status, 0, `expected exit 0 from successful dispatch; got ${r.status}: ${r.stderr}`);
    // The dispatched verb's output lands on stdout via inherit; the
    // plan summary lands first.
    assert.match(r.stdout, new RegExp(`→ running: gate approve ${id} --by alice`));
    assert.match(r.stdout, new RegExp(`✓ approved: ${id}`));

    // After dispatch, the request should be approved.
    const show = run(b.root, ['show', id, '--fields', 'state', '--plain']);
    assert.equal(show.stdout.trim(), 'approved');
  } finally {
    b.cleanup();
  }
});

test('gate next agent-loop pattern drains the actionable ladder', () => {
  // The canonical agent loop shape: `while gate next --confirm; do
  // :; done` drains every approve→execute→complete chain alice can
  // run on her queue. Three pending requests should each move
  // through their three lifecycle states, ending with all three
  // completed.
  const b = bootstrap();
  try {
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const filed = run(
        b.root,
        [
          'request',
          '--action', `work${i}`,
          '--reason', 'r',
          '--executors', 'alice',
          '--format', 'json',
        ],
        { GUILD_ACTOR: 'eris' },
      );
      ids.push((JSON.parse(filed.stdout) as { id: string }).id);
    }

    // Drain. Cap iterations defensively so a broken loop doesn't
    // hang the test runner; in practice we expect ~9 iterations
    // (3 ids × 3 transitions each = approve / execute / complete).
    let iter = 0;
    for (; iter < 30; iter += 1) {
      const r = run(b.root, ['next', '--confirm'], { GUILD_ACTOR: 'alice' });
      if (r.status !== 0) break;
    }
    assert.ok(iter < 30, 'drain loop must terminate, not infinite-loop');
    assert.ok(iter >= 9, `loop should run at least 9 dispatches (3 ids × 3 transitions); got ${iter}`);

    // Every request should now be in terminal state.
    for (const id of ids) {
      const show = run(b.root, ['show', id, '--fields', 'state', '--plain']);
      assert.equal(show.stdout.trim(), 'completed', `${id} should be completed after drain`);
    }
  } finally {
    b.cleanup();
  }
});

test('gate next: GUILD_ACTOR unset exits 1 with a setup hint', () => {
  const b = bootstrap();
  try {
    const r = run(b.root, ['next'], { GUILD_ACTOR: '' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /GUILD_ACTOR is not set/);
  } finally {
    b.cleanup();
  }
});

test('gate next: unregistered actor exits 1 pointing to gate register', () => {
  const b = bootstrap();
  try {
    const r = run(b.root, ['next'], { GUILD_ACTOR: 'ghost' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /gate register --name ghost/);
  } finally {
    b.cleanup();
  }
});
