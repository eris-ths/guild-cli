// gate request --depth — reviewer-depth advisory (issue #221).
//
// Pins the substrate-level contract:
//   - --depth shallow / standard / deep are accepted, persisted in
//     the request YAML, and round-tripped on read.
//   - Unknown values are rejected at the interface boundary with
//     a flag-shape error message; the value never reaches the
//     domain layer in that case.
//   - --depth omitted: NO depth field in the persisted YAML
//     (pre-#221 byte-stable). Reading code defaults absence to
//     'standard' (issue #221: "Default = standard (互換)").
//   - Hydrate tolerance: a request YAML written before #221 (no
//     depth field) must load without error.
//
// What this test does NOT pin: the Devil agent's behaviour change
// when reading the depth value. That contract lives in operator /
// agent setup (outside this repo); the substrate's job here is
// only to carry the signal through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'gate-depth-'));
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
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, GUILD_ACTOR: 'alice', ...env },
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

function extractRequestId(out: string): string {
  const m = out.match(/(\d{4}-\d{2}-\d{2}-\d{4})/);
  if (!m) throw new Error(`no request id in output: ${out}`);
  return m[0] as string;
}

function readPendingYaml(root: string, id: string): string {
  return readFileSync(join(root, 'requests', 'pending', `${id}.yaml`), 'utf8');
}

for (const depth of ['shallow', 'standard', 'deep'] as const) {
  test(`--depth ${depth}: accepted; persisted as depth: ${depth} in YAML`, (t) => {
    const { root, cleanup } = bootstrap();
    t.after(cleanup);
    const r = run(root, ['request', '--action', 'a', '--reason', 'r', '--depth', depth]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const id = extractRequestId(r.stdout);
    const yaml = readPendingYaml(root, id);
    assert.match(yaml, new RegExp(`^depth: ${depth}$`, 'm'));
  });
}

test('--depth bogus: rejected at interface with flag-shape error; no record written', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = run(root, ['request', '--action', 'a', '--reason', 'r', '--depth', 'bogus']);
  assert.notEqual(r.status, 0);
  assert.match(
    r.stderr,
    /--depth must be one of shallow\|standard\|deep, got: bogus/,
  );
  // No partial write: reject before c.requestUC.create is called.
  // The pending dir may not exist yet — both 'no dir' and 'empty dir'
  // satisfy the contract.
  let entries: string[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readdirSync } = require('node:fs');
    entries = readdirSync(join(root, 'requests', 'pending'));
  } catch {
    entries = [];
  }
  assert.equal(entries.length, 0, `expected no pending records; got: ${entries.join(',')}`);
});

test('--depth omitted: NO depth field in persisted YAML (byte-stable with pre-#221 records)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = run(root, ['request', '--action', 'a', '--reason', 'r']);
  assert.equal(r.status, 0);
  const id = extractRequestId(r.stdout);
  const yaml = readPendingYaml(root, id);
  // Negative: depth must be absent. A `depth: standard` write would
  // make every existing record bit-different on next save.
  assert.doesNotMatch(yaml, /^depth:/m);
});

test('hydrate tolerance: pre-#221 record (no depth field) loads cleanly', (t) => {
  // Synthesize a YAML record by hand without `depth:` and confirm
  // gate show reads it without error. Mirrors how doctor / chain
  // would walk older records on a partially-migrated content root.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  mkdirSync(join(root, 'requests', 'pending'), { recursive: true });
  const id = '2026-05-07-9999';
  const yaml = [
    `id: ${id}`,
    'from: alice',
    'action: legacy',
    'reason: pre-221 record',
    'state: pending',
    `created_at: 2026-05-07T00:00:00.000Z`,
    'status_log:',
    '  - state: pending',
    '    by: alice',
    `    at: 2026-05-07T00:00:00.000Z`,
    '    note: created',
    'reviews: []',
    '',
  ].join('\n');
  writeFileSync(join(root, 'requests', 'pending', `${id}.yaml`), yaml);

  const r = run(root, ['show', id, '--format', 'json']);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout) as Record<string, unknown>;
  assert.equal(payload['id'], id);
  // Absence is the contract: no depth key at all on a legacy record.
  assert.equal('depth' in payload, false);
});

test('--depth shallow: gate show JSON surfaces depth so reviewer agents see the signal', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const created = run(root, [
    'request', '--action', 'a', '--reason', 'r', '--depth', 'shallow',
  ]);
  const id = extractRequestId(created.stdout);

  const r = run(root, ['show', id, '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout) as Record<string, unknown>;
  assert.equal(payload['depth'], 'shallow');
});
