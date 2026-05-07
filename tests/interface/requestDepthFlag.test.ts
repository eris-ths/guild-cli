// gate request --depth (issue #221, Phase 1)
//
// Coverage:
//   1. schema declares `depth` as a string enum on `request`
//   2. enum is exactly [shallow, standard, deep]
//   3. CLI accepts each of the three values + persists it on disk
//      (round-trips via `gate show --format json`)
//   4. CLI rejects a non-enum value with a shape-symmetric error
//   5. Absent --depth: created request emits NO `depth` key (records-
//      outlive-writers; pre-#221 records remain byte-identical)
//   6. KNOWN_FLAGS accepts --depth (no rejectUnknownFlags trip)
//
// Devil prompt three-stage routing is OUT OF SCOPE for this PR
// (issue #221 explicitly defers it). This test pins ONLY the
// flag-admission + persistence layer so a future PR cannot silently
// regress the contract.
//
// The standard=current-behaviour invariant is enforced structurally
// here: standard is a "no field" on disk (toJSON omits it when the
// author declared standard, by design). See the "no depth → no key"
// case below.

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
  const root = mkdtempSync(join(tmpdir(), 'guild-depth-flag-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, d));
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
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env },
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

// ── schema ────────────────────────────────────────────────────────

test('schema: request declares depth as a string enum [shallow, standard, deep]', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, ['schema', '--verb', 'request']);
    assert.equal(r.status, 0, r.stderr);
    const payload = JSON.parse(r.stdout);
    const reqVerb = payload.verbs.find((v: { name: string }) => v.name === 'request');
    assert.ok(reqVerb, 'schema must include `request`');
    const depthProp = reqVerb.input.properties.depth;
    assert.ok(depthProp, 'schema.request.input.properties.depth must be declared');
    assert.equal(depthProp.type, 'string');
    assert.deepEqual(depthProp.enum, ['shallow', 'standard', 'deep']);
    // Advisory framing must be on the description so MCP wirings
    // reading the schema see "hint, not directive" up front.
    assert.match(
      String(depthProp.description ?? ''),
      /advisory/i,
      'depth.description must use advisory framing',
    );
  } finally {
    cleanup();
  }
});

// ── happy path: each enum value persists and round-trips ──────────

for (const depth of ['shallow', 'standard', 'deep'] as const) {
  test(`gate request --depth ${depth}: persisted and visible via gate show`, () => {
    const { root, cleanup } = bootstrap();
    try {
      const create = runGate(root, [
        'request',
        '--from',
        'alice',
        '--action',
        'a',
        '--reason',
        'r',
        '--depth',
        depth,
        '--format',
        'json',
      ]);
      assert.equal(create.status, 0, create.stderr);
      const created = JSON.parse(create.stdout);
      const id = created.id as string;
      assert.ok(id.match(/^\d{4}-\d{2}-\d{2}-\d+$/), `bad id: ${id}`);

      const show = runGate(root, ['show', id, '--format', 'json']);
      assert.equal(show.status, 0, show.stderr);
      const payload = JSON.parse(show.stdout);
      assert.equal(
        payload.depth,
        depth,
        `round-trip lost depth (got: ${JSON.stringify(payload.depth)})`,
      );
    } finally {
      cleanup();
    }
  });
}

// ── omission: pre-#221 byte-identical shape ───────────────────────

test('gate request without --depth: depth key absent on the resulting record', () => {
  const { root, cleanup } = bootstrap();
  try {
    const create = runGate(root, [
      'request',
      '--from',
      'alice',
      '--action',
      'a',
      '--reason',
      'r',
      '--format',
      'json',
    ]);
    assert.equal(create.status, 0, create.stderr);
    const id = JSON.parse(create.stdout).id as string;
    const show = runGate(root, ['show', id, '--format', 'json']);
    assert.equal(show.status, 0, show.stderr);
    const payload = JSON.parse(show.stdout);
    assert.equal(
      'depth' in payload,
      false,
      'absent --depth must NOT emit a depth key (records-outlive-writers)',
    );
  } finally {
    cleanup();
  }
});

// ── enum rejection ────────────────────────────────────────────────

test('gate request --depth medium: rejected with the schema enum listed in the error', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, [
      'request',
      '--from',
      'alice',
      '--action',
      'a',
      '--reason',
      'r',
      '--depth',
      'medium',
    ]);
    assert.notEqual(r.status, 0, 'malformed depth must fail');
    assert.match(r.stderr, /shallow.*standard.*deep/);
    assert.match(r.stderr, /medium/);
  } finally {
    cleanup();
  }
});

// ── KNOWN_FLAGS admission (drift detector also covers it) ─────────

test('gate request --depth: NOT rejected by the unknown-flag guard', () => {
  // If --depth ever drops out of REQUEST_CREATE_KNOWN_FLAGS the
  // rejectUnknownFlags helper would fire BEFORE the enum check, with
  // an "unknown flag" message. This test pins admission distinct from
  // enum validity.
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, [
      'request',
      '--from',
      'alice',
      '--action',
      'a',
      '--reason',
      'r',
      '--depth',
      'shallow',
    ]);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /unknown flag/i);
  } finally {
    cleanup();
  }
});
