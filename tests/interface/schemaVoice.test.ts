// gate schema --voice <name> — voice-flavored description overlay
// (#345 cluster #5).
//
// Pins:
//   1. no --voice → doctrinal descriptions verbatim
//   2. --voice <plugin-name> → summary + per-flag overrides applied
//   3. fields NOT overridden fall through (augment-not-replace)
//   4. unknown voice name → silent miss (no error, no overlay)
//   5. plugin without `schema` section → unchanged output
//   6. text mode renders the overlaid summary

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(opts?: { withSchemaOverride?: boolean }): { root: string; cleanup: () => void } {
  const withOverride = opts?.withSchemaOverride ?? true;
  const root = makeTempRoot('guild-schema-voice-');
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\n' +
      'host_names: [human]\n' +
      'plugins:\n' +
      '  trusted: true\n' +
      '  voices:\n' +
      '    - plugins/voices/eris.mjs\n',
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  mkdirSync(join(root, 'plugins', 'voices'), { recursive: true });
  const schemaSection = withOverride
    ? `,
  schema: {
    verbs: {
      complete: {
        summary: 'flavored-complete-summary',
        input: {
          cliff: 'flavored-cliff-description',
        },
      },
    },
  }`
    : '';
  writeFileSync(
    join(root, 'plugins', 'voices', 'eris.mjs'),
    `export default {
  name: 'eris',
  verbs: {
    complete: [ { when: 'default', template: 't' } ],
  }${schemaSection},
};
`,
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(cwd: string, args: string[]): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], { cwd, env: { ...process.env }, encoding: 'utf8' });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? -1 };
}

test('schema (no --voice): doctrinal descriptions verbatim', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, ['schema', '--verb', 'complete', '--format', 'json']);
    assert.equal(r.status, 0);
    const p = JSON.parse(r.stdout);
    const complete = p.verbs[0];
    assert.equal(complete.summary, 'transition executing → completed');
    // Doctrinal cliff description references "Forward-pointing hint"
    assert.match(complete.input.properties.cliff.description, /Forward-pointing hint/);
  } finally { cleanup(); }
});

test('schema --voice eris: summary + property overrides applied', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, ['schema', '--verb', 'complete', '--voice', 'eris', '--format', 'json']);
    assert.equal(r.status, 0);
    const p = JSON.parse(r.stdout);
    const complete = p.verbs[0];
    assert.equal(complete.summary, 'flavored-complete-summary');
    assert.equal(complete.input.properties.cliff.description, 'flavored-cliff-description');
  } finally { cleanup(); }
});

test('schema --voice eris: non-overridden fields fall through verbatim', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, ['schema', '--verb', 'complete', '--voice', 'eris', '--format', 'json']);
    const p = JSON.parse(r.stdout);
    const complete = p.verbs[0];
    // `note` is NOT in the override map → doctrinal description.
    // The doctrinal complete schema declares `note: str` (just type),
    // so description may be undefined — assert it is NOT the flavored
    // string (the load-bearing contract).
    assert.notEqual(complete.input.properties.note?.description, 'flavored-cliff-description');
    // `by` is also not overridden → unchanged.
    assert.notEqual(complete.input.properties.by?.description, 'flavored-cliff-description');
  } finally { cleanup(); }
});

test('schema --voice unknown: silent miss, doctrinal descriptions returned', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, ['schema', '--verb', 'complete', '--voice', 'nonexistent', '--format', 'json']);
    assert.equal(r.status, 0, 'unknown voice name must not error');
    const p = JSON.parse(r.stdout);
    assert.equal(p.verbs[0].summary, 'transition executing → completed');
  } finally { cleanup(); }
});

test('schema --voice <plugin-without-schema>: no overlay, plain pass-through', () => {
  const { root, cleanup } = bootstrap({ withSchemaOverride: false });
  try {
    const r = runGate(root, ['schema', '--verb', 'complete', '--voice', 'eris', '--format', 'json']);
    assert.equal(r.status, 0);
    const p = JSON.parse(r.stdout);
    assert.equal(p.verbs[0].summary, 'transition executing → completed');
  } finally { cleanup(); }
});

test('schema --voice eris --format text: overlaid summary renders', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, ['schema', '--verb', 'complete', '--voice', 'eris', '--format', 'text']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /flavored-complete-summary/);
  } finally { cleanup(); }
});
