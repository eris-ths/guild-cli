// `gate whoami` discloses which source the resolved actor came from.
//
// `resolveGuildActor` consults two non-flag sources in priority
// order: `GUILD_ACTOR` env, then a `.guild-actor` file walked up
// from cwd. When both produce equally-valid identities, the
// "two configurations look the same on the surface" surface
// (paraphrasing principle 09: orientation-disclosure) means the
// reader can't tell *why* whoami answered the way it did.
//
// This test pins the contract: `gate whoami` writes an `actor
// source: ...` line right after `you are X` that names whichever
// of GUILD_ACTOR / .guild-actor was used. Same disclosure shape
// as `gate boot`'s misconfigured-cwd hint — orientation surfaces
// disclose the path that produced the answer.
//
// Sibling helper test in `resolveGuildActor.test.ts` covers the
// underlying `resolveGuildActorWithSource` function directly;
// this file is the surface assertion.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'whoami-source-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
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
  env: Record<string, string | undefined> = {},
): { stdout: string; stderr: string; status: number } {
  // Build a clean env: take parent env, then apply overrides where
  // an undefined value means "delete this key". Avoids inheriting a
  // GUILD_ACTOR set on the developer's machine into the file-only test.
  const finalEnv: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete finalEnv[k];
    else finalEnv[k] = v;
  }
  const r = spawnSync(process.execPath, [GATE, 'whoami'], {
    cwd,
    env: finalEnv,
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

test('whoami: env source labelled GUILD_ACTOR (env)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = run(root, { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /you are alice .*\(member\)/);
  assert.match(r.stdout, /actor source: GUILD_ACTOR \(env\)/);
});

test('whoami: file source labelled .guild-actor (file)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  writeFileSync(join(root, '.guild-actor'), 'alice\n');
  const r = run(root, { GUILD_ACTOR: undefined });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /you are alice .*\(member\)/);
  assert.match(r.stdout, /actor source: \.guild-actor \(file\)/);
});

test('whoami: env wins over file (legacy contract: env > file)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Both set; env should win and surface accordingly.
  writeFileSync(join(root, '.guild-actor'), 'bob\n');
  const r = run(root, { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /you are alice/);
  assert.match(r.stdout, /actor source: GUILD_ACTOR \(env\)/);
  // Negative — the file-source label must NOT also fire.
  assert.doesNotMatch(r.stdout, /actor source: \.guild-actor/);
});

test('whoami: no source set still fails closed (no provenance line on error path)', (t) => {
  // Pre-existing contract: when neither source resolves, whoami
  // exits 1 with the GUILD_ACTOR-not-set hint. The provenance
  // line is success-path only — no source means no label.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = run(root, { GUILD_ACTOR: undefined });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /GUILD_ACTOR is not set/);
  assert.doesNotMatch(r.stdout, /actor source:/);
});

// JSON path (added with --format json|text symmetry fix). Pins the
// snake_case shape so orchestrators reflecting on identity / role /
// actor_source / recent utterances don't have to regex-parse the
// principle-09 `actor source: ...` line.

function runJson(
  cwd: string,
  env: Record<string, string | undefined> = {},
): { stdout: string; stderr: string; status: number } {
  const finalEnv: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete finalEnv[k];
    else finalEnv[k] = v;
  }
  const r = spawnSync(
    process.execPath,
    [GATE, 'whoami', '--format', 'json'],
    { cwd, env: finalEnv, encoding: 'utf8' },
  );
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

test('whoami --format json: env source returns actor_source: env', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runJson(root, { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.actor, 'alice');
  assert.equal(payload.role, 'member');
  assert.equal(payload.actor_source, 'env');
  assert.equal(payload.display_name, null);
  assert.ok(Array.isArray(payload.recent_utterances));
});

test('whoami --format json: file source returns actor_source: file', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  writeFileSync(join(root, '.guild-actor'), 'alice\n');
  const r = runJson(root, { GUILD_ACTOR: undefined });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.actor, 'alice');
  assert.equal(payload.actor_source, 'file');
});

test('whoami --format json: missing GUILD_ACTOR emits ok:false envelope', (t) => {
  // Error path stays machine-readable in JSON mode — orchestrators
  // shouldn't need to switch parsers based on success/failure.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runJson(root, { GUILD_ACTOR: undefined });
  assert.equal(r.status, 1);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error.message, /GUILD_ACTOR is not set/);
});

test('whoami --format yaml is rejected with the standard message', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = spawnSync(
    process.execPath,
    [GATE, 'whoami', '--format', 'yaml'],
    {
      cwd: root,
      env: { ...process.env, GUILD_ACTOR: 'alice' },
      encoding: 'utf8',
    },
  );
  assert.notEqual(r.status, 0);
  assert.match(
    r.stderr ?? '',
    /--format must be 'json' or 'text'/,
  );
});
