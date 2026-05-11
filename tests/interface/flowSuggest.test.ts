// gate flow-suggest — advisory verb that maps (severity, area, scope)
// to a recommended flow (#307).
//
// Pins:
//   - rule table covers the three default rows from the issue plus
//     the conservative fall-through
//   - JSON envelope shape (recommended / reason / alternatives / inputs)
//   - text mode renders three labelled lines + stderr advisory footer
//   - severity / area validation fails closed with actionable errors
//   - scope is optional, echoed when provided, omitted when not
//   - unknown areas fall through to full-request (conservative default)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  suggestFlow,
  FlowSuggestResult,
} from '../../src/application/request/flowSuggest.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

interface RunResult {
  stdout: string;
  stderr: string;
  status: number;
}
function runGate(args: string[]): RunResult {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd: process.cwd(),
    env: { ...process.env },
    encoding: 'utf8',
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
}

// ---------- pure rule engine tests ----------

test('flow-suggest rule: low + copy → direct-pr', () => {
  const r: FlowSuggestResult = suggestFlow({ severity: 'low', area: 'copy' });
  assert.equal(r.recommended, 'direct-pr');
  assert.match(r.reason, /low.*copy/);
  assert.ok(r.alternatives.includes('full-request'));
});

test('flow-suggest rule: low + doc → direct-pr', () => {
  const r = suggestFlow({ severity: 'low', area: 'doc' });
  assert.equal(r.recommended, 'direct-pr');
});

test('flow-suggest rule: low + style → direct-pr', () => {
  const r = suggestFlow({ severity: 'low', area: 'style' });
  assert.equal(r.recommended, 'direct-pr');
});

test('flow-suggest rule: low + bug → fast-track', () => {
  const r = suggestFlow({ severity: 'low', area: 'bug' });
  assert.equal(r.recommended, 'fast-track');
  assert.ok(r.alternatives.includes('full-request'));
});

test('flow-suggest rule: med + bug → fast-track', () => {
  const r = suggestFlow({ severity: 'med', area: 'bug' });
  assert.equal(r.recommended, 'fast-track');
});

test('flow-suggest rule: high + auth → full-request', () => {
  const r = suggestFlow({ severity: 'high', area: 'auth' });
  assert.equal(r.recommended, 'full-request');
  assert.match(r.reason, /high.*auth/);
});

test('flow-suggest rule: high + security → full-request', () => {
  const r = suggestFlow({ severity: 'high', area: 'security' });
  assert.equal(r.recommended, 'full-request');
});

test('flow-suggest rule: high + data → full-request', () => {
  const r = suggestFlow({ severity: 'high', area: 'data' });
  assert.equal(r.recommended, 'full-request');
});

test('flow-suggest rule: med + bug stays fast-track even with scope', () => {
  const r = suggestFlow({
    severity: 'med',
    area: 'bug',
    scope: 'multi-file',
  });
  assert.equal(r.recommended, 'fast-track');
});

test('flow-suggest rule: case-insensitive on area', () => {
  const r = suggestFlow({ severity: 'low', area: 'COPY' });
  assert.equal(r.recommended, 'direct-pr');
});

test('flow-suggest rule: unknown area → full-request (conservative default)', () => {
  const r = suggestFlow({ severity: 'low', area: 'something-weird' });
  assert.equal(r.recommended, 'full-request');
  assert.ok(r.alternatives.includes('fast-track'));
});

test('flow-suggest rule: high + non-high-risk area → full-request', () => {
  // high severity in an unrecognised area should still fall to the
  // conservative default rather than slip into fast-track.
  const r = suggestFlow({ severity: 'high', area: 'bug' });
  assert.equal(r.recommended, 'full-request');
});

test('flow-suggest rule: med + copy → full-request (no rule matches)', () => {
  // med+cosmetic is intentionally NOT in the direct-pr bucket (the
  // direct-pr rule requires severity=low). This pins the precedence.
  const r = suggestFlow({ severity: 'med', area: 'copy' });
  assert.equal(r.recommended, 'full-request');
});

test('flow-suggest rule: low + cosmetic with scope echoes scope in reason', () => {
  const r = suggestFlow({
    severity: 'low',
    area: 'doc',
    scope: 'single-file',
  });
  assert.equal(r.recommended, 'direct-pr');
  assert.match(r.reason, /single-file/);
});

// ---------- CLI surface tests ----------

test('flow-suggest CLI: JSON envelope shape (low + copy)', () => {
  const r = runGate([
    'flow-suggest',
    '--severity',
    'low',
    '--area',
    'copy',
    '--format',
    'json',
  ]);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.recommended, 'direct-pr');
  assert.equal(typeof payload.reason, 'string');
  assert.ok(Array.isArray(payload.alternatives));
  assert.deepEqual(payload.inputs, { severity: 'low', area: 'copy' });
});

test('flow-suggest CLI: scope echoed in inputs when provided', () => {
  const r = runGate([
    'flow-suggest',
    '--severity',
    'high',
    '--area',
    'auth',
    '--scope',
    'multi-pr',
    '--format',
    'json',
  ]);
  assert.equal(r.status, 0, r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.recommended, 'full-request');
  assert.deepEqual(payload.inputs, {
    severity: 'high',
    area: 'auth',
    scope: 'multi-pr',
  });
});

test('flow-suggest CLI: defaults to json format', () => {
  const r = runGate(['flow-suggest', '--severity', 'low', '--area', 'bug']);
  assert.equal(r.status, 0, r.stderr);
  // Output must be parseable JSON when format flag is omitted.
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.recommended, 'fast-track');
});

test('flow-suggest CLI: text format renders three labelled lines', () => {
  const r = runGate([
    'flow-suggest',
    '--severity',
    'med',
    '--area',
    'bug',
    '--format',
    'text',
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^recommended: fast-track$/m);
  assert.match(r.stdout, /^reason: /m);
  assert.match(r.stdout, /^alternatives: /m);
  // advisory footer goes to stderr so stdout stays clean for shell pipes.
  assert.match(r.stderr, /advisory/);
});

test('flow-suggest CLI: invalid severity fails closed', () => {
  const r = runGate([
    'flow-suggest',
    '--severity',
    'critical',
    '--area',
    'auth',
  ]);
  assert.notEqual(r.status, 0);
  // The error envelope is the standard one; just check the message
  // mentions the validated value so the operator knows what to fix.
  assert.match(r.stderr + r.stdout, /severity/);
});

test('flow-suggest CLI: invalid format fails closed', () => {
  const r = runGate([
    'flow-suggest',
    '--severity',
    'low',
    '--area',
    'copy',
    '--format',
    'xml',
  ]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /format/);
});

test('flow-suggest CLI: missing --severity fails with shape hint', () => {
  const r = runGate(['flow-suggest', '--area', 'copy']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /severity/);
});

test('flow-suggest CLI: missing --area fails with shape hint', () => {
  const r = runGate(['flow-suggest', '--severity', 'low']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /area/);
});

test('flow-suggest CLI: unknown flag rejected', () => {
  const r = runGate([
    'flow-suggest',
    '--severity',
    'low',
    '--area',
    'copy',
    '--bogus',
    'x',
  ]);
  assert.notEqual(r.status, 0);
});
