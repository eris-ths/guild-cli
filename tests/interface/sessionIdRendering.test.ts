// `gate show --format text` — session_id surfaces (#249 slice 3).
//
// Coverage:
//   - opened_by_session line appears when stamped (header position)
//   - opened_by_session line absent when unset (byte-stable)
//   - claimed by: gets `[session=<id>]` tag when claimed_by_session set
//   - witnesses: each entry gets `[session=<id>]` suffix per actor
//   - notes + sessions coexist: `name (note) [session=<id>]`
//   - mixed: some witnesses with session, others without (only those
//     with attribution get the bracket tag)
//
// Records-outlive-writers: every absence path is asserted to NOT
// emit the new line/tag — pre-#249 records show identically to today.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  writeFileSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = makeTempRoot('guild-sessrender-');
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  mkdirSync(join(root, 'members'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function run(
  cwd: string,
  args: string[],
  env: Record<string, string | undefined> = {},
): { stdout: string; stderr: string; status: number } {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  }
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: merged,
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

function registerAll(root: string, names: string[]): void {
  for (const n of names) {
    const r = run(root, ['register', '--name', n]);
    assert.equal(r.status, 0, `register ${n} failed: ${r.stderr}`);
  }
}

function newRequest(
  root: string,
  from: string,
  env: Record<string, string | undefined> = {},
): string {
  const r = run(
    root,
    ['request', '--from', from, '--action', 'do thing', '--reason', 'because', '--format', 'json'],
    env,
  );
  assert.equal(r.status, 0, `request failed: ${r.stderr}`);
  return (JSON.parse(r.stdout) as { id: string }).id;
}

test('show text: opened_by_session line appears when set', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice']);
  const id = newRequest(root, 'alice', { GUILD_SESSION_ID: 'eris-local-evening' });

  const r = run(root, ['show', id, '--format', 'text']);
  assert.equal(r.status, 0);
  assert.match(
    r.stdout,
    /^ {2}opened_by_session: eris-local-evening$/m,
    'opened_by_session line should be in header column',
  );
  // Position: between source_agora_play (or promoted_from) and
  // created. Check it lands above `created:` since `source_agora_play`
  // is absent in this fixture.
  const idxOpened = r.stdout.indexOf('opened_by_session:');
  const idxCreated = r.stdout.indexOf('created:');
  assert.ok(
    idxOpened > 0 && idxCreated > idxOpened,
    'opened_by_session must come before created:',
  );
});

test('show text: opened_by_session absent when env unset (byte-stable)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice']);
  const id = newRequest(root, 'alice', { GUILD_SESSION_ID: undefined });

  const r = run(root, ['show', id, '--format', 'text']);
  assert.equal(r.status, 0);
  assert.ok(
    !r.stdout.includes('opened_by_session'),
    'no session stamped → no opened_by_session line',
  );
});

test('show text: claim line gets [session=<id>] tag', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia']);
  const id = newRequest(root, 'alice');
  const c = run(
    root,
    ['claim', id, '--by', 'leysia'],
    { GUILD_SESSION_ID: 'leysia-tmux-3' },
  );
  assert.equal(c.status, 0, `claim: ${c.stderr}`);

  const r = run(root, ['show', id, '--format', 'text']);
  assert.equal(r.status, 0);
  assert.match(
    r.stdout,
    /claimed by: leysia \[session=leysia-tmux-3\] at \d{4}-\d{2}-\d{2}T/,
    'claim line should include the session bracket tag',
  );
});

test('show text: claim line without session keeps original shape', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia']);
  const id = newRequest(root, 'alice');
  assert.equal(run(root, ['claim', id, '--by', 'leysia']).status, 0);

  const r = run(root, ['show', id, '--format', 'text']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /claimed by: leysia at \d{4}-\d{2}-\d{2}T/);
  assert.ok(
    !/claimed by:.*\[session=/.test(r.stdout),
    'unstamped claim must not carry a session tag',
  );
});

test('show text: claim line with note + session keeps both', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia']);
  const id = newRequest(root, 'alice');
  const c = run(
    root,
    ['claim', id, '--by', 'leysia', '--note', 'starting now'],
    { GUILD_SESSION_ID: 'leysia-tmux-3' },
  );
  assert.equal(c.status, 0, `claim: ${c.stderr}`);

  const r = run(root, ['show', id, '--format', 'text']);
  assert.equal(r.status, 0);
  // Order: actor, then [session=...], then `at TS`, then ` — note`.
  assert.match(
    r.stdout,
    /claimed by: leysia \[session=leysia-tmux-3\] at \d{4}-\d{2}-\d{2}T[^\n]+ — starting now/,
  );
});

test('show text: witness line gets [session=<id>] per actor', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia', 'miki']);
  const id = newRequest(root, 'alice');
  assert.equal(
    run(
      root,
      ['witness', id, '--by', 'leysia'],
      { GUILD_SESSION_ID: 'leysia-tmux-3' },
    ).status,
    0,
  );
  assert.equal(
    run(
      root,
      ['witness', id, '--by', 'miki'],
      { GUILD_SESSION_ID: 'miki-laptop' },
    ).status,
    0,
  );

  const r = run(root, ['show', id, '--format', 'text']);
  assert.equal(r.status, 0);
  // Both witnesses tagged with their respective sessions.
  assert.match(
    r.stdout,
    /witnesses: leysia \[session=leysia-tmux-3\], miki \[session=miki-laptop\]/,
  );
});

test('show text: witness mixed sessions/notes — only-session, only-note, both, neither', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia', 'miki', 'noir']);
  const id = newRequest(root, 'alice');
  // leysia: session only
  assert.equal(
    run(root, ['witness', id, '--by', 'leysia'], { GUILD_SESSION_ID: 'leysia-1' }).status,
    0,
  );
  // miki: note only (no session env)
  assert.equal(
    run(
      root,
      ['witness', id, '--by', 'miki', '--note', 'perf'],
      { GUILD_SESSION_ID: undefined },
    ).status,
    0,
  );
  // noir: both
  assert.equal(
    run(
      root,
      ['witness', id, '--by', 'noir', '--note', 'dedup'],
      { GUILD_SESSION_ID: 'noir-2' },
    ).status,
    0,
  );
  // alice: bare witness (also acts as the request author).
  assert.equal(
    run(root, ['witness', id, '--by', 'alice'], { GUILD_SESSION_ID: undefined }).status,
    0,
  );

  const r = run(root, ['show', id, '--format', 'text']);
  assert.equal(r.status, 0);
  // Each actor should render with the right combination. Order is
  // registration order (leysia, miki, noir, alice).
  assert.match(
    r.stdout,
    /witnesses: leysia \[session=leysia-1\], miki \(perf\), noir \(dedup\) \[session=noir-2\], alice/,
  );
});

test('show text: witness without any session keeps pre-#249 shape', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia']);
  const id = newRequest(root, 'alice');
  assert.equal(run(root, ['witness', id, '--by', 'leysia']).status, 0);

  const r = run(root, ['show', id, '--format', 'text']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /witnesses: leysia$/m);
  assert.ok(
    !/witnesses:.*\[session=/.test(r.stdout),
    'unstamped witness must not carry a session tag',
  );
});
