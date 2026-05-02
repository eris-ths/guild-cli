// agora new — v0 skeleton tests.
//
// Pins the contract the future expansion of agora will inherit:
//   - JSON envelope shape (snake_case keys, where_written +
//     config_file disclosure, suggested_next pointing at next verb)
//   - text mode mirrors gate register's surface (success line +
//     stderr notice with absolute path + config)
//   - file lands at <content_root>/agora/games/<slug>.yaml
//   - slug collision fails closed
//   - invalid slug / kind rejected at the boundary
//
// Principle 11 (AI-first, human as projection) governs the contract:
// JSON is the substrate, text is the projection. Both are tested
// here at v0 so future PRs can't quietly drift either.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// At runtime this file lives under dist/tests/passages/agora/, so we
// walk four levels up (agora → passages → tests → dist → repo root)
// to reach bin/. Existing gate tests live at dist/tests/interface/
// and walk three levels — agora's nesting is one level deeper.
const AGORA = resolve(here, '../../../../bin/agora.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'agora-new-'));
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

test('agora new: text mode emits success line + stderr notice + writes YAML at expected path', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(
    root,
    [
      'new',
      '--slug', 'first-game',
      '--kind', 'quest',
      '--title', 'first quest',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  // success line
  assert.match(r.stdout, /✓ created game: first-game \[quest\] — first quest/);
  // stderr notice — mirrors gate register's path-disclosure shape
  assert.match(
    r.stderr,
    new RegExp(
      `^notice: wrote ${escapeRegex(join(root, 'agora', 'games', 'first-game.yaml'))} \\(config: ${escapeRegex(join(root, 'guild.config.yaml'))}\\)\\n$`,
    ),
  );
  // file landed where the notice claimed
  const path = join(root, 'agora', 'games', 'first-game.yaml');
  assert.ok(existsSync(path), 'YAML file should exist');
  const yaml = readFileSync(path, 'utf8');
  assert.match(yaml, /slug: first-game/);
  assert.match(yaml, /kind: quest/);
  assert.match(yaml, /title: first quest/);
  assert.match(yaml, /created_by: alice/);
  // snake_case keys per principle 11 — no camelCase regression
  assert.doesNotMatch(yaml, /createdBy:/);
  assert.doesNotMatch(yaml, /createdAt:/);
});

test('agora new: JSON mode emits snake_case envelope with where_written + config_file + suggested_next', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(
    root,
    [
      'new',
      '--slug', 'sandbox-one',
      '--kind', 'sandbox',
      '--title', 'a sandbox',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.slug, 'sandbox-one');
  assert.equal(payload.kind, 'sandbox');
  assert.equal(
    payload.where_written,
    join(root, 'agora', 'games', 'sandbox-one.yaml'),
  );
  assert.equal(payload.config_file, join(root, 'guild.config.yaml'));
  assert.equal(typeof payload.suggested_next, 'object');
  assert.equal(payload.suggested_next.verb, 'list');
  // No camelCase keys in the envelope (principle 11 + PR #109).
  for (const key of Object.keys(payload)) {
    assert.ok(!/[A-Z]/.test(key), `envelope key "${key}" must be snake_case`);
  }
  // Stderr notice fires in JSON mode too — humans reading stderr see
  // the path even when stdout is machine-bound. Same shape as text.
  assert.match(r.stderr, /^notice: wrote /);
});

test('agora new: --description optional; omitted when empty; preserved when provided', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // omitted
  runAgora(root, ['new', '--slug', 'bare', '--kind', 'quest', '--title', 'bare'], {
    GUILD_ACTOR: 'alice',
  });
  const bare = readFileSync(
    join(root, 'agora', 'games', 'bare.yaml'),
    'utf8',
  );
  assert.doesNotMatch(bare, /^description:/m, 'description omitted when not provided');

  // present
  runAgora(
    root,
    [
      'new',
      '--slug', 'with-desc',
      '--kind', 'sandbox',
      '--title', 'titled',
      '--description', 'hello world',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  const withDesc = readFileSync(
    join(root, 'agora', 'games', 'with-desc.yaml'),
    'utf8',
  );
  assert.match(withDesc, /description: hello world/);
});

test('agora new: slug collision fails closed (no overwrite)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const first = runAgora(
    root,
    ['new', '--slug', 'dup', '--kind', 'quest', '--title', 'first'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(first.status, 0);
  const original = readFileSync(
    join(root, 'agora', 'games', 'dup.yaml'),
    'utf8',
  );

  const second = runAgora(
    root,
    ['new', '--slug', 'dup', '--kind', 'sandbox', '--title', 'second'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /already exists/);
  // File contents unchanged.
  const after = readFileSync(
    join(root, 'agora', 'games', 'dup.yaml'),
    'utf8',
  );
  assert.equal(after, original);
});

test('agora new: invalid slug rejected at domain boundary', (t) => {
  // Uppercase, leading digit, special chars — same class of typo
  // gate's member registration would reject. The boundary fails
  // before any file is written.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  for (const badSlug of ['UpperCase', '1leading-digit', 'has space', 'has/slash']) {
    const r = runAgora(
      root,
      ['new', '--slug', badSlug, '--kind', 'quest', '--title', 't'],
      { GUILD_ACTOR: 'alice' },
    );
    assert.notEqual(r.status, 0, `slug "${badSlug}" should be rejected`);
    assert.match(r.stderr, /slug must match/);
  }
  // No file should have been created in agora/games/.
  assert.ok(
    !existsSync(join(root, 'agora', 'games')) ||
      readDirOrEmpty(join(root, 'agora', 'games')).length === 0,
    'no game file should have been written for invalid slugs',
  );
});

test('agora new: invalid kind rejected', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(
    root,
    ['new', '--slug', 'ok-slug', '--kind', 'match', '--title', 't'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /kind must be one of/);
});

test('agora new: missing GUILD_ACTOR and no --by produces a clear error', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(
    root,
    ['new', '--slug', 'no-actor', '--kind', 'quest', '--title', 't'],
    { GUILD_ACTOR: '' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--by required/);
});

test('agora new: rejects unknown flags loud (principle 10 input contract)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(
    root,
    [
      'new',
      '--slug', 'flag-test',
      '--kind', 'quest',
      '--title', 't',
      '--bogus', 'x',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown flag.*--bogus/);
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readDirOrEmpty(p: string): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readdirSync } = require('node:fs');
    return readdirSync(p);
  } catch {
    return [];
  }
}
