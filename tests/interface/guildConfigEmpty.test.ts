// `GUILD_CONFIG=""` footgun-nudge verification via CLI subprocess.
//
// Split from tests/infrastructure/guildConfigDiscovery.test.ts: the
// in-process variant monkey-patched `process.stderr.write` to capture
// the nudge text, which interacted with the node:test runner's worker
// stdio on Windows + Node 20 and produced CI hangs. The CLI here owns
// its own process boundary, so stderr capture is clean.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function runGate(
  cwd: string,
  args: readonly string[],
  env: Record<string, string>,
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
}

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-config-empty-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  mkdirSync(join(root, 'members'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('GUILD_CONFIG="" emits the empty-but-set stderr nudge before walking up', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['doctor', '--summary'], { GUILD_CONFIG: '' });
  // Exit succeeds because empty is treated as unset, walk-up finds
  // the local config, doctor reports clean.
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
  // The nudge fires on stderr.
  assert.match(r.stderr, /GUILD_CONFIG is set but empty/);
  assert.match(r.stderr, /unset GUILD_CONFIG/);
});

test('GUILD_CONFIG unset (env var absent) emits no nudge', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Explicitly omit GUILD_CONFIG from the child env. The runGate
  // helper merges over process.env, so we have to overwrite-as-empty
  // and rely on the env-isolation strategy used by other tests. The
  // simplest portable form: pass a sentinel and check the nudge does
  // NOT fire (Node treats undefined entries in the env object as
  // omitted from the child).
  const r = spawnSync(process.execPath, [GATE, 'doctor', '--summary'], {
    cwd: root,
    encoding: 'utf8',
    env: (() => {
      const copy: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (k === 'GUILD_CONFIG') continue;
        if (typeof v === 'string') copy[k] = v;
      }
      return copy;
    })(),
  });
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
  assert.doesNotMatch(r.stderr ?? '', /GUILD_CONFIG is set but empty/);
});

// -------------------- bogus path → clean error envelope (no stack trace) --------------------

test('GUILD_CONFIG=/nonexistent prints clean error: line, no Node stack trace', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['voices'], { GUILD_CONFIG: '/nonexistent/guild.config.yaml' });
  assert.notEqual(r.status, 0, 'bogus path must exit non-zero');
  // Clean error envelope: starts with `error: ` and carries the
  // DomainError message verbatim.
  assert.match(r.stderr, /^error: GUILD_CONFIG=/m);
  assert.match(r.stderr, /does not exist/);
  // Must NOT surface as a raw Node "Unhandled promise rejection"
  // stack trace — that's the regression the bin-level catch
  // handler closes (handleMainError in bin/_lib/).
  assert.doesNotMatch(r.stderr, /at file:\/\/.*bin\/gate\.mjs/);
  assert.doesNotMatch(r.stderr, /Node\.js v\d+/);
});

// -------------------- nudge dedup --------------------

test('GUILD_CONFIG="" emits the nudge exactly once per process (dedup)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['voices'], { GUILD_CONFIG: '' });
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
  // GuildConfig.load() fires multiple times per invocation (top-
  // level + plugin loaders). The module-private flag ensures the
  // stderr nudge surfaces exactly once.
  const matches = r.stderr.match(/GUILD_CONFIG is set but empty/g);
  assert.equal(
    matches === null ? 0 : matches.length,
    1,
    `expected nudge to fire exactly once, got ${matches === null ? 0 : matches.length}`,
  );
});
