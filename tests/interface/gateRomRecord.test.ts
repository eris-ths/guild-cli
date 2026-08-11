// `gate rom record` / `list` / `show` — the observations substrate kind.
//
// What is worth pinning here, beyond "the round trip works":
//
//   1. a rejected envelope writes NOTHING (a store of unverified
//      measurements is worse than no store — the point of recording is
//      that a later reader can treat `declared ⊇ used` as established)
//   2. envelope keys outside the v1 contract survive write AND read.
//      The reference engine's `policy.denied` — the windows a ROM tried
//      to reach and was refused — is not in the contract, and dropping
//      it would discard the most security-relevant thing in the report.
//   3. a record hand-edited on disk into an inconsistent state fails on
//      READ. Validation on write is not a property of the file; the
//      file is what a later reader actually gets.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
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
  io: { out_bytes: 230415, out_fnv1a: '8f2ad431' },
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
  const root = makeTempRoot('guild-obs-');
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

function writeEnvelope(root: string, name: string, doc: unknown): string {
  const p = join(root, name);
  writeFileSync(p, JSON.stringify(doc));
  return p;
}

function observationFiles(root: string): string[] {
  const dir = join(root, 'observations');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.yaml'));
}

test('record → list → show round trip', () => {
  const { root, cleanup } = bootstrap();
  try {
    const p = writeEnvelope(root, 'rep.json', VALID);
    const rec = runGate(root, [
      'rom', 'record', p, '--for', '2026-08-10-0005', '--source', 'rom-stamp',
    ]);
    assert.equal(rec.status, 0, `stderr: ${rec.stderr}`);
    assert.match(rec.stdout, /o-\d{4}-\d{2}-\d{2}-\d{4}/);

    const list = runGate(root, ['rom', 'list', '--format', 'json']);
    assert.equal(list.status, 0, `stderr: ${list.stderr}`);
    const payload = JSON.parse(list.stdout);
    assert.equal(payload.count, 1);
    const obs = payload.observations[0];
    assert.equal(obs.kind, 'rom');
    assert.equal(obs.by, 'alice');
    assert.equal(obs.subject, '2026-08-10-0005');
    assert.equal(obs.source, 'rom-stamp');

    const show = runGate(root, ['rom', 'show', obs.id, '--format', 'json']);
    assert.equal(show.status, 0, `stderr: ${show.stderr}`);
    assert.equal(JSON.parse(show.stdout).id, obs.id);
  } finally {
    cleanup();
  }
});

test('--for filters, and a non-matching subject returns nothing', () => {
  const { root, cleanup } = bootstrap();
  try {
    const p = writeEnvelope(root, 'rep.json', VALID);
    runGate(root, ['rom', 'record', p, '--for', '2026-08-10-0005']);
    const hit = JSON.parse(
      runGate(root, ['rom', 'list', '--for', '2026-08-10-0005', '--format', 'json'])
        .stdout,
    );
    assert.equal(hit.count, 1);
    const miss = JSON.parse(
      runGate(root, ['rom', 'list', '--for', '2026-01-01-0001', '--format', 'json'])
        .stdout,
    );
    assert.equal(miss.count, 0);
  } finally {
    cleanup();
  }
});

test('an invalid envelope is rejected AND writes nothing', () => {
  const { root, cleanup } = bootstrap();
  try {
    const bad = structuredClone(VALID);
    bad.capabilities.used_names = [
      { name: 'fd_write', count: 12 },
      { name: 'path_open', count: 1 }, // never declared
    ];
    const p = writeEnvelope(root, 'bad.json', bad);
    const r = runGate(root, ['rom', 'record', p]);
    assert.notEqual(r.status, 0, 'an unverified envelope was accepted');
    assert.match(r.stderr, /path_open/);
    assert.deepEqual(
      observationFiles(root),
      [],
      'a rejected envelope still created a record',
    );
  } finally {
    cleanup();
  }
});

test('a specified block round-trips through the typed contract (policy)', () => {
  // `policy` used to be the example of an *unknown* key here: it was on
  // the wire, outside the contract, and preserved only because
  // `ObservationBody.extra` keeps what it does not understand. That
  // preservation is what later made it specifiable from stored runs
  // instead of from prose.
  //
  // Now that it is specified, it must arrive through the typed half —
  // and, because the parser checks it, an envelope whose enforcement
  // claim contradicts its own usage must be refused rather than stored.
  const { root, cleanup } = bootstrap();
  try {
    const withPolicy = {
      ...structuredClone(VALID),
      policy: {
        enforced: true,
        granted: ['fd_write', 'proc_exit'],
        denied: [{ name: 'fd_read', count: 4 }],
        stopped_at: { window: 'fd_read', instr: 91, hostcall: 7 },
      },
    };
    const p = writeEnvelope(root, 'rep.json', withPolicy);
    const rec = runGate(root, ['rom', 'record', p]);
    assert.equal(rec.status, 0, `stderr: ${rec.stderr}`);

    // On disk...
    const files = observationFiles(root);
    assert.equal(files.length, 1);
    const onDisk = readFileSync(
      join(root, 'observations', files[0] as string),
      'utf8',
    );
    assert.match(onDisk, /denied/);
    assert.match(onDisk, /fd_read/);

    // ...and back through hydrate.
    const listed = JSON.parse(
      runGate(root, ['rom', 'list', '--format', 'json']).stdout,
    );
    const policy = listed.observations[0].envelope.policy;
    assert.equal(policy.enforced, true);
    assert.deepEqual(policy.denied, [{ name: 'fd_read', count: 4 }]);
    assert.equal(policy.stopped_at.window, 'fd_read');
  } finally {
    cleanup();
  }
});

test('an enforcement claim contradicted by usage is refused, not stored', () => {
  // The check that makes specifying the block worth anything: the
  // engine says it enforced a grant set and then reports using a window
  // outside it. Before `policy` was specified this envelope recorded
  // cleanly, because nothing read the block it was stored in.
  const { root, cleanup } = bootstrap();
  try {
    const leaky = {
      ...structuredClone(VALID),
      policy: {
        enforced: true,
        granted: ['fd_write'],
        denied: [],
      },
    };
    const p = writeEnvelope(root, 'leaky.json', leaky);
    const rec = runGate(root, ['rom', 'record', p]);
    assert.notEqual(rec.status, 0, 'a leaked grant set was accepted');
    assert.match(rec.stderr, /proc_exit/);
    // Nothing may be left behind by a refused record.
    assert.equal(
      existsSync(join(root, 'observations')) ? observationFiles(root).length : 0,
      0,
      'a refused envelope still wrote an observation',
    );
  } finally {
    cleanup();
  }
});

test('keys still outside the contract survive write and read', () => {
  // The `extra` half, retested with a key that is genuinely unknown
  // today. The wire is allowed to run ahead of the spec; what must not
  // happen is a fact being dropped on write, because it cannot be
  // recovered afterwards.
  const { root, cleanup } = bootstrap();
  try {
    const ahead = {
      ...structuredClone(VALID),
      coverage: { edges: 128, blocks: 44 },
    };
    const p = writeEnvelope(root, 'rep.json', ahead);
    assert.equal(runGate(root, ['rom', 'record', p]).status, 0);

    const onDisk = readFileSync(
      join(root, 'observations', observationFiles(root)[0] as string),
      'utf8',
    );
    assert.match(onDisk, /coverage/);
    assert.match(onDisk, /128/);

    const listed = JSON.parse(
      runGate(root, ['rom', 'list', '--format', 'json']).stdout,
    );
    assert.deepEqual(listed.observations[0].envelope.coverage, {
      edges: 128,
      blocks: 44,
    });
  } finally {
    cleanup();
  }
});

test('a record edited on disk into an inconsistent state fails on READ', () => {
  // Validation on write is not a property of the file. This is the
  // check that makes "recorded means verified" true for a later reader
  // rather than true only at the moment of writing.
  const { root, cleanup } = bootstrap();
  try {
    const p = writeEnvelope(root, 'rep.json', VALID);
    assert.equal(runGate(root, ['rom', 'record', p]).status, 0);
    const file = join(root, 'observations', observationFiles(root)[0] as string);

    // declared says 3 and engine.names lists 3; make them disagree.
    const text = readFileSync(file, 'utf8').replace(
      '    declared: 3',
      '    declared: 20',
    );
    assert.match(text, /declared: 20/, 'the edit did not apply — test is vacuous');
    writeFileSync(file, text);

    const listed = runGate(root, ['rom', 'list', '--format', 'json']);
    assert.equal(JSON.parse(listed.stdout).count, 0, 'a corrupted record was served');
    assert.match(listed.stderr, /hydrate failed|declared/);
  } finally {
    cleanup();
  }
});

test('rom record needs an actor when GUILD_ACTOR is unset', () => {
  const { root, cleanup } = bootstrap();
  try {
    const p = writeEnvelope(root, 'rep.json', VALID);
    const env = { ...process.env };
    delete env['GUILD_ACTOR'];
    const r = spawnSync(process.execPath, [GATE, 'rom', 'record', p], {
      cwd: root,
      encoding: 'utf8',
      env,
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--by|GUILD_ACTOR/);
  } finally {
    cleanup();
  }
});
