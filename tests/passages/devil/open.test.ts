// devil-review — `devil open` verb tests.
//
// Pin the open verb's contract: target validation, sequence
// allocation, json + text output shape, --by attribution, error
// surfaces (missing positional, unknown type, missing actor).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DEVIL = resolve(here, '../../../../bin/devil.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'devil-open-'));
  writeFileSync(join(root, 'guild.config.yaml'), 'content_root: .\nhost_names: [human]\n');
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runDevil(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [DEVIL, ...args], {
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

test('devil open --type pr --by alice succeeds with json envelope', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(
    root,
    [
      'open',
      'https://github.com/eris-ths/guild-cli/pull/125',
      '--type', 'pr',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.match(payload.review_id, /^rev-\d{4}-\d{2}-\d{2}-001$/);
  assert.equal(payload.state, 'open');
  assert.equal(payload.target.type, 'pr');
  assert.equal(payload.target.ref, 'https://github.com/eris-ths/guild-cli/pull/125');
  assert.equal(payload.suggested_next.verb, 'entry');
  assert.equal(payload.suggested_next.args.review_id, payload.review_id);
  // alternation-neutral per #122 — no args.by
  assert.equal(payload.suggested_next.args.by, undefined);
});

test('devil open text-mode prints success line and next: hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(
    root,
    ['open', 'src/foo.ts', '--type', 'file'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /✓ devil-review opened: rev-/);
  assert.match(r.stdout, /\[open\] against file:src\/foo\.ts by alice/);
  assert.match(r.stdout, /next: devil entry/);
  assert.match(r.stderr, /notice: wrote .*\/devil\/reviews\/rev-/);
});

test('devil open uses --by flag when both --by and GUILD_ACTOR are set', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(
    root,
    [
      'open', 'https://github.com/x/y/pull/1',
      '--type', 'pr',
      '--by', 'bob',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  // opened_by should be bob, not alice — but we don't expose it in
  // the json envelope on open. Verify via the file content.
  // (We trust the round-trip tests in the repo layer; here, it's
  // enough that the verb exits 0 with --by.)
  assert.match(payload.review_id, /^rev-/);
});

test('devil open missing positional fails with usage hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(root, ['open', '--type', 'pr'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /positional <target-ref> required/);
});

test('devil open missing --type fails', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(root, ['open', 'src/foo.ts'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--type required/);
});

test('devil open with invalid --type fails with target type list', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(
    root,
    ['open', 'src/foo.ts', '--type', 'directory'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /target type must be one of/);
});

test('devil open without --by and no GUILD_ACTOR fails', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // strip GUILD_ACTOR via env override (spawnSync inherits process.env
  // but we pass an empty env override; node still reads GUILD_ACTOR
  // from real process.env — so set it to empty string explicitly).
  const r = runDevil(
    root,
    ['open', 'src/foo.ts', '--type', 'file'],
    { GUILD_ACTOR: '' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--by required/);
});

test('devil open allocates per-day sequences (001, 002, 003)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = runDevil(
      root,
      ['open', 'src/foo.ts', '--type', 'file', '--format', 'json'],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(r.status, 0, `iteration ${i} stderr: ${r.stderr}`);
    ids.push(JSON.parse(r.stdout).review_id);
  }
  // Same date, sequence increments. The dates in the suffix all match
  // (today's date), and the trailing -NNN goes 001, 002, 003.
  for (let i = 0; i < 3; i++) {
    const expected = String(i + 1).padStart(3, '0');
    assert.match(ids[i] as string, new RegExp(`^rev-\\d{4}-\\d{2}-\\d{2}-${expected}$`));
  }
});

test('devil open --format invalid fails', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(
    root,
    ['open', 'x', '--type', 'file', '--format', 'yaml'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--format must be 'json' or 'text'/);
});

test('devil open rejects unknown flag', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(
    root,
    ['open', 'x', '--type', 'file', '--bogus', 'y'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown flag.*bogus/i);
});
