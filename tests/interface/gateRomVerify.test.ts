// `gate rom verify` — CLI reach for the v1 RomPlugin envelope contract
// (docs/design/rom-plugin.md).
//
// The domain invariants themselves are pinned in
// tests/domain/RomEnvelope.test.ts. What this file pins is the part a
// pure-domain test cannot see: that the verb is actually reachable,
// that a rejection leaves a non-zero exit code (a validator whose
// failures exit 0 is decoration), and that a run log — not just a bare
// JSON document — is accepted, which is the form an engine emits.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

const VALID = {
  v: 1,
  engine: {
    windows: 3,
    names: ['fd_write', 'fd_read', 'proc_exit'],
    feat: 'sandbox,nonrec,budget',
  },
  cost: { instrs: 1812458726, hostcalls: 14, mempeak_pages: 528, mode: 'verify' },
  io: { out_bytes: 230415, out_fnv1a: '0x8f2ad431' },
  capabilities: {
    declared: 3,
    used: 2,
    used_names: [
      { name: 'fd_write', count: 12 },
      { name: 'proc_exit', count: 1 },
    ],
  },
};

function bootstrap(): { root: string; cleanup: () => void } {
  const root = makeTempRoot('guild-rom-');
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\nrole: member\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(root: string, args: string[], stdin?: string) {
  return spawnSync(process.execPath, [GATE, ...args], {
    cwd: root,
    encoding: 'utf8',
    input: stdin,
    env: { ...process.env, GUILD_ACTOR: 'alice' },
  });
}

test('gate rom verify accepts a conforming envelope from a file', () => {
  const { root, cleanup } = bootstrap();
  try {
    const path = join(root, 'report.json');
    writeFileSync(path, JSON.stringify(VALID));
    const r = runGate(root, ['rom', 'verify', path]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /contract satisfied/);
    assert.match(r.stdout, /declared=3 used=2/);
  } finally {
    cleanup();
  }
});

test('gate rom verify --format json returns the parsed envelope', () => {
  const { root, cleanup } = bootstrap();
  try {
    const path = join(root, 'report.json');
    writeFileSync(path, JSON.stringify(VALID));
    const r = runGate(root, ['rom', 'verify', path, '--format', 'json']);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.envelope.capabilities.used, 2);
  } finally {
    cleanup();
  }
});

test('gate rom verify reads stdin with `-`', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, ['rom', 'verify', '-'], JSON.stringify(VALID));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /contract satisfied/);
  } finally {
    cleanup();
  }
});

test('gate rom verify finds the envelope inside a run log', () => {
  // The shape an engine actually emits: the envelope on one line of a
  // larger stream, behind a prefix the substrate deliberately does not
  // know about.
  const { root, cleanup } = bootstrap();
  try {
    const log =
      'starting run\n' +
      `[agent] ${JSON.stringify(VALID)}\n` +
      'done\n';
    const r = runGate(root, ['rom', 'verify', '-'], log);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /contract satisfied/);
  } finally {
    cleanup();
  }
});

test('gate rom verify exits non-zero when used ⊄ declared', () => {
  // The whole point: a violation must be loud. An exit code of 0 here
  // would make the verb decoration.
  const { root, cleanup } = bootstrap();
  try {
    const bad = structuredClone(VALID);
    bad.capabilities.used_names = [
      { name: 'fd_write', count: 12 },
      { name: 'path_open', count: 1 },
    ];
    const path = join(root, 'bad.json');
    writeFileSync(path, JSON.stringify(bad));
    const r = runGate(root, ['rom', 'verify', path]);
    assert.notEqual(r.status, 0, 'a contract violation exited 0');
    assert.match(r.stderr, /path_open/);
  } finally {
    cleanup();
  }
});

test('gate rom verify rejects an unsupported version by name', () => {
  const { root, cleanup } = bootstrap();
  try {
    const bad = structuredClone(VALID);
    bad.v = 2;
    const path = join(root, 'v2.json');
    writeFileSync(path, JSON.stringify(bad));
    const r = runGate(root, ['rom', 'verify', path]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /version 2/);
  } finally {
    cleanup();
  }
});

test('gate rom with no subcommand names the one that exists', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, ['rom']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /gate rom verify/);
  } finally {
    cleanup();
  }
});

test('rom is hidden from default help but present in the schema contract', () => {
  // Principle 11: `gate schema` is exhaustive regardless of tier, so a
  // cold agent discovers the verb even though a human's default help
  // does not carry it.
  const { root, cleanup } = bootstrap();
  try {
    const plain = runGate(root, ['--help']);
    assert.equal(plain.status, 0, `stderr: ${plain.stderr}`);
    assert.ok(
      !/gate rom verify/.test(plain.stdout),
      'rom leaked into the default (BASE) help surface',
    );

    const all = runGate(root, ['--help', '--all']);
    assert.match(all.stdout, /gate rom verify/);

    const schema = runGate(root, ['schema', '--format', 'json']);
    assert.equal(schema.status, 0, `stderr: ${schema.stderr}`);
    const verbs = JSON.parse(schema.stdout).verbs as Array<{ name: string }>;
    assert.ok(
      verbs.some((v) => v.name === 'rom'),
      'rom missing from gate schema',
    );
  } finally {
    cleanup();
  }
});
