// parseDoctorJson — boundary validator for `gate repair`.
// Verifies the contract that protects intervention from malformed
// or hostile doctor JSON inputs (D3 from noir devil review on req
// 2026-04-15-0012).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDoctorJson } from '../../src/interface/gate/handlers/repair.js';

const VALID = JSON.stringify({
  summary: {},
  findings: [
    {
      area: 'issues',
      source: '/abs/path/issues/i-x.yaml',
      kind: 'hydration_error',
      message: '...',
    },
  ],
});

test('parseDoctorJson: accepts well-formed payload', () => {
  const findings = parseDoctorJson(VALID);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.area, 'issues');
});

test('parseDoctorJson: rejects relative source (D3)', () => {
  const json = JSON.stringify({
    findings: [
      {
        area: 'issues',
        source: 'issues/i-relative.yaml',
        kind: 'hydration_error',
        message: '...',
      },
    ],
  });
  assert.throws(
    () => parseDoctorJson(json),
    /must be an absolute path/,
  );
});

test('parseDoctorJson: rejects unknown kind', () => {
  const json = JSON.stringify({
    findings: [
      {
        area: 'issues',
        source: '/abs/x.yaml',
        kind: 'made_up_kind',
        message: '...',
      },
    ],
  });
  assert.throws(() => parseDoctorJson(json), /kind invalid/);
});

test('parseDoctorJson: rejects unknown area', () => {
  const json = JSON.stringify({
    findings: [
      {
        area: 'inbox',
        source: '/abs/x.yaml',
        kind: 'hydration_error',
        message: '...',
      },
    ],
  });
  assert.throws(() => parseDoctorJson(json), /area invalid/);
});

test('parseDoctorJson: rejects missing source', () => {
  const json = JSON.stringify({
    findings: [
      { area: 'issues', kind: 'hydration_error', message: '...' },
    ],
  });
  assert.throws(() => parseDoctorJson(json), /source missing/);
});

test('parseDoctorJson: rejects non-array findings', () => {
  assert.throws(
    () => parseDoctorJson(JSON.stringify({ findings: 'oops' })),
    /non-array/,
  );
});

test('parseDoctorJson: rejects non-object top-level', () => {
  assert.throws(() => parseDoctorJson('null'), /top-level/);
});
