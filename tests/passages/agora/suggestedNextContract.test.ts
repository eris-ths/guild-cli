// agora suggested_next contract regression tests.
//
// Issues #121 and #122 from the play-report by another Claude
// instance. This test pins the post-fix contract so the same
// drift can't reappear silently.
//
// (#121) suggested_next.reason text drift:
//   - Pre-fix, agora new and agora move had reason strings
//     written during incremental commit sequence ("(when
//     implemented)", "(... lands in subsequent commits)") that
//     remained when subsequent verbs landed. surface drifted
//     from substrate.
//   - Post-fix, no agora verb's suggested_next.reason mentions
//     unimplemented future state. This test scans every verb's
//     JSON output for known-stale phrases.
//
// (#122) suggested_next.args.by alternation bias:
//   - Pre-fix, agora play/move/suspend/resume all set
//     suggested_next.args.by to the just-acted actor, implicitly
//     recommending same-actor continuation.
//   - Post-fix, args.by is omitted — the orchestrator (or
//     human + AI pair) decides who acts next. agora doesn't
//     carry policy about actor continuation.

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
const AGORA = resolve(here, '../../../../bin/agora.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'agora-suggested-next-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  mkdirSync(join(root, 'members'));
  for (const name of ['alice', 'bob']) {
    writeFileSync(
      join(root, 'members', `${name}.yaml`),
      `name: ${name}\ncategory: professional\nactive: true\n`,
    );
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runAgora(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [AGORA, ...args], {
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

// ---- (#121) reason drift detector ----

const STALE_PHRASES: ReadonlyArray<{ phrase: RegExp; description: string }> = [
  { phrase: /\(when implemented\)/, description: '"(when implemented)" — verb is now implemented' },
  { phrase: /lands? in subsequent commits?/i, description: '"lands in subsequent commits" — those commits are merged' },
  { phrase: /\(when [a-z\s]+ lands?\)/, description: '"(when X lands)" parenthetical — X has landed' },
  { phrase: /will be implemented/i, description: '"will be implemented" — verb already exists' },
];

function assertNoStaleReason(payload: { suggested_next?: { reason?: unknown } | null }): void {
  if (!payload.suggested_next) return; // null is valid (terminal verbs)
  const reason = payload.suggested_next.reason;
  if (typeof reason !== 'string') return;
  for (const { phrase, description } of STALE_PHRASES) {
    assert.doesNotMatch(
      reason,
      phrase,
      `suggested_next.reason contains stale phrase: ${description}\n  reason was: ${reason}`,
    );
  }
}

test('agora new: suggested_next.reason has no stale "(when implemented)" prose', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(
    root,
    ['new', '--slug', 'g', '--kind', 'sandbox', '--title', 'g', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assertNoStaleReason(JSON.parse(r.stdout));
});

test('agora play: suggested_next.reason has no stale prose', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runAgora(
    root,
    ['new', '--slug', 'g', '--kind', 'sandbox', '--title', 'g'],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runAgora(
    root,
    ['play', '--slug', 'g', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assertNoStaleReason(JSON.parse(r.stdout));
});

test('agora move: suggested_next.reason has no stale prose', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runAgora(
    root,
    ['new', '--slug', 'g', '--kind', 'sandbox', '--title', 'g'],
    { GUILD_ACTOR: 'alice' },
  );
  const playId = JSON.parse(
    runAgora(root, ['play', '--slug', 'g', '--format', 'json'], {
      GUILD_ACTOR: 'alice',
    }).stdout,
  ).play_id;
  const r = runAgora(
    root,
    ['move', playId, '--text', 't', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assertNoStaleReason(JSON.parse(r.stdout));
});

test('agora suspend / resume: suggested_next.reason has no stale prose', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runAgora(
    root,
    ['new', '--slug', 'g', '--kind', 'sandbox', '--title', 'g'],
    { GUILD_ACTOR: 'alice' },
  );
  const playId = JSON.parse(
    runAgora(root, ['play', '--slug', 'g', '--format', 'json'], {
      GUILD_ACTOR: 'alice',
    }).stdout,
  ).play_id;

  const susp = runAgora(
    root,
    ['suspend', playId, '--cliff', 'c', '--invitation', 'i', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(susp.status, 0);
  assertNoStaleReason(JSON.parse(susp.stdout));

  const res = runAgora(
    root,
    ['resume', playId, '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(res.status, 0);
  assertNoStaleReason(JSON.parse(res.stdout));
});

// ---- (#122) suggested_next.args.by absence ----

test('agora play: suggested_next.args does NOT carry by (alternation-neutral)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runAgora(
    root,
    ['new', '--slug', 'g', '--kind', 'sandbox', '--title', 'g'],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runAgora(
    root,
    ['play', '--slug', 'g', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  // play_id is essential context; by is policy and intentionally absent.
  assert.equal(typeof payload.suggested_next.args.play_id, 'string');
  assert.equal(payload.suggested_next.args.by, undefined,
    'args.by must be absent — agora does not bias same-actor continuation (issue #122)');
});

test('agora move: suggested_next.args does NOT carry by', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runAgora(
    root,
    ['new', '--slug', 'g', '--kind', 'sandbox', '--title', 'g'],
    { GUILD_ACTOR: 'alice' },
  );
  const playId = JSON.parse(
    runAgora(root, ['play', '--slug', 'g', '--format', 'json'], {
      GUILD_ACTOR: 'alice',
    }).stdout,
  ).play_id;
  const r = runAgora(
    root,
    ['move', playId, '--text', 't', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.suggested_next.args.by, undefined);
});

test('agora suspend / resume: suggested_next.args does NOT carry by', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runAgora(
    root,
    ['new', '--slug', 'g', '--kind', 'sandbox', '--title', 'g'],
    { GUILD_ACTOR: 'alice' },
  );
  const playId = JSON.parse(
    runAgora(root, ['play', '--slug', 'g', '--format', 'json'], {
      GUILD_ACTOR: 'alice',
    }).stdout,
  ).play_id;

  const susp = JSON.parse(
    runAgora(
      root,
      ['suspend', playId, '--cliff', 'c', '--invitation', 'i', '--format', 'json'],
      { GUILD_ACTOR: 'alice' },
    ).stdout,
  );
  assert.equal(susp.suggested_next.args.by, undefined);

  const res = JSON.parse(
    runAgora(
      root,
      ['resume', playId, '--format', 'json'],
      { GUILD_ACTOR: 'alice' },
    ).stdout,
  );
  assert.equal(res.suggested_next.args.by, undefined);
});

test('agora new: suggested_next.args is empty (no policy, no recommendations)', (t) => {
  // For new, there's no play_id yet to recommend. args is just {}.
  // Pin to confirm we don't accidentally start adding args here either.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(
    root,
    ['new', '--slug', 'g', '--kind', 'sandbox', '--title', 'g', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  const payload = JSON.parse(r.stdout);
  assert.deepEqual(payload.suggested_next.args, {});
});
