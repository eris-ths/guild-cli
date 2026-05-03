// E2E: .guild-actor file fallback works through the gate CLI surface.
//
// The unit test (resolveGuildActor.test.ts) covers the resolver in
// isolation; this test pins the integration: a real `gate` subprocess
// invocation, with no GUILD_ACTOR env, picks up the actor from a
// `.guild-actor` file in the content_root.
//
// Surfaced by issue i-2026-05-03-0001 from the develop-branch
// dogfood: env-only resolution breaks for AI agent loops where each
// subprocess gets a fresh shell. Pinning E2E here ensures the
// agora/devil passages and the gate verb layer all honor the
// substrate-side fallback consistently.

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
  const root = mkdtempSync(join(tmpdir(), 'guild-actor-file-e2e-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, d));
  }
  for (const s of ['pending', 'approved', 'executing', 'completed', 'failed', 'denied']) {
    mkdirSync(join(root, 'requests', s));
  }
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(
  cwd: string,
  args: string[],
  envOverrides: Record<string, string | undefined>,
): { stdout: string; stderr: string; status: number } {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  // Strip any inherited GUILD_ACTOR so the test is hermetic.
  delete env['GUILD_ACTOR'];
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env,
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

test('gate boot: .guild-actor file resolves actor when GUILD_ACTOR env unset', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  writeFileSync(join(root, '.guild-actor'), 'alice\n');
  const r = runGate(root, ['boot', '--format', 'json'], {});
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.actor, 'alice', 'actor must come from .guild-actor');
});

test('gate boot: env wins over .guild-actor when both set', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  writeFileSync(join(root, '.guild-actor'), 'from-file');
  // alice is the only registered member; we'd need two for env-vs-file
  // to produce visibly different results. Register a second.
  writeFileSync(
    join(root, 'members', 'bob.yaml'),
    'name: bob\ncategory: professional\nactive: true\n',
  );
  writeFileSync(join(root, '.guild-actor'), 'alice');
  const r = runGate(root, ['boot', '--format', 'json'], { GUILD_ACTOR: 'bob' });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.actor, 'bob', 'env GUILD_ACTOR must win over .guild-actor');
});

test('gate boot: ancestor .guild-actor found from subdir cwd', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  writeFileSync(join(root, '.guild-actor'), 'alice');
  const subdir = join(root, 'sub', 'deeper');
  mkdirSync(subdir, { recursive: true });
  const r = runGate(subdir, ['boot', '--format', 'json'], {});
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.actor, 'alice');
});

test('gate boot: no env + no file → actor is null (not an error)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // No .guild-actor written.
  const r = runGate(root, ['boot', '--format', 'json'], {});
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.actor, null);
});
