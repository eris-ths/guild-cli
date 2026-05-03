// devil-review — CLI scaffold tests.
//
// Pin the v0 scaffold contract: --help / --version work, schema
// verb runs (json + text formats), unknown verbs surface a "v0
// scaffold" error message that names the issue (so a confused agent
// can pull #126 for the design context).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DEVIL = resolve(here, '../../../../bin/devil.mjs');

function runDevil(
  cwd: string,
  args: string[],
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [DEVIL, ...args], {
    cwd,
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

function tmpRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'devil-cli-'));
  writeFileSync(join(root, 'guild.config.yaml'), 'content_root: .\nhost_names: [human]\n');
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('devil with no args prints help and exits 0', (t) => {
  const { root, cleanup } = tmpRoot();
  t.after(cleanup);
  const r = runDevil(root, []);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /devil-review .* security-backstop/);
  assert.match(r.stdout, /v0 scaffold/);
});

test('devil --help prints help and exits 0', (t) => {
  const { root, cleanup } = tmpRoot();
  t.after(cleanup);
  const r = runDevil(root, ['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /devil-review/);
  assert.match(r.stdout, /issues\/126/);
});

test('devil --version prints version and exits 0', (t) => {
  const { root, cleanup } = tmpRoot();
  t.after(cleanup);
  const r = runDevil(root, ['--version']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /devil-review .* snapshot/);
});

test('devil schema --format json emits the v0 contract (10 verbs)', (t) => {
  const { root, cleanup } = tmpRoot();
  t.after(cleanup);
  const r = runDevil(root, ['schema', '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload['$schema'], 'http://json-schema.org/draft-07/schema#');
  assert.equal(payload.passage, 'devil-review');
  assert.ok(Array.isArray(payload.verbs));
  // Currently implemented: open + entry + list + show + dismiss +
  // resolve + suspend + resume + conclude + schema. The only
  // remaining verb is ingest (next commit).
  const names = payload.verbs.map((v: { name: string }) => v.name).sort();
  assert.deepEqual(
    names,
    [
      'conclude', 'dismiss', 'entry', 'list', 'open',
      'resolve', 'resume', 'schema', 'show', 'suspend',
    ],
  );
});

test('devil schema --format text emits a terse summary', (t) => {
  const { root, cleanup } = tmpRoot();
  t.after(cleanup);
  const r = runDevil(root, ['schema', '--format', 'text']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /devil-review/);
  assert.match(r.stdout, /10 verb\(s\)/);
  assert.match(r.stdout, /open {2}\[write\]/);
  assert.match(r.stdout, /entry {2}\[write\]/);
  assert.match(r.stdout, /list {2}\[read\]/);
  assert.match(r.stdout, /show {2}\[read\]/);
  assert.match(r.stdout, /dismiss {2}\[write\]/);
  assert.match(r.stdout, /resolve {2}\[write\]/);
  assert.match(r.stdout, /suspend {2}\[write\]/);
  assert.match(r.stdout, /resume {2}\[write\]/);
  assert.match(r.stdout, /conclude {2}\[write\]/);
  assert.match(r.stdout, /schema {2}\[meta\]/);
});

test('devil schema --verb <unknown> errors out', (t) => {
  const { root, cleanup } = tmpRoot();
  t.after(cleanup);
  const r = runDevil(root, ['schema', '--verb', 'nope']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no devil verb named "nope"/);
});

test('devil <unknown-verb> surfaces v0 scaffold error', (t) => {
  const { root, cleanup } = tmpRoot();
  t.after(cleanup);
  const r = runDevil(root, ['ingest', 'something']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown verb: ingest/);
  assert.match(r.stderr, /v0 scaffold/);
  assert.match(r.stderr, /#126/);
});

test('devil schema rejects unknown flag', (t) => {
  const { root, cleanup } = tmpRoot();
  t.after(cleanup);
  const r = runDevil(root, ['schema', '--bogus', 'x']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown flag.*bogus/i);
});

test('devil schema --format invalid errors out', (t) => {
  const { root, cleanup } = tmpRoot();
  t.after(cleanup);
  const r = runDevil(root, ['schema', '--format', 'yaml']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--format must be 'json' or 'text'/);
});
