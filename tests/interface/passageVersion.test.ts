// E2E version surface across all four CLIs (gate / agora / devil / ctx).
//
// Pre-fix, the three passage binaries hardcoded their version strings
// (no package version, no `-v` flag). gate alone used the shared
// `getPackageVersion` + `isVersionFlag` helpers. The three passages now
// share the helper, so:
//   - every binary accepts both `--version` and `-v`
//   - the package version flows through, not a stale literal
//   - the per-passage status phrase ("alpha, 9 verbs", "v1 complete")
//     stays alongside so a reader sees lineage and surface maturity at
//     once
//
// This file pins the e2e shape on each binary so a future rename of
// the version helpers can't silently regress one passage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');
const AGORA = resolve(here, '../../../bin/agora.mjs');
const DEVIL = resolve(here, '../../../bin/devil.mjs');
const CTX = resolve(here, '../../../bin/ctx.mjs');
const GUILD = resolve(here, '../../../bin/guild.mjs');

function run(bin: string, args: string[]): string {
  const r = spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
  return r.stdout;
}

const SEMVER = /\d+\.\d+\.\d+/;

test('gate --version: prints package version', () => {
  assert.match(run(GATE, ['--version']), new RegExp(`^guild-cli ${SEMVER.source}`));
});

test('gate -v: same as --version', () => {
  assert.equal(run(GATE, ['-v']), run(GATE, ['--version']));
});

test('guild --version: prints package version', () => {
  assert.match(run(GUILD, ['--version']), new RegExp(`^guild-cli ${SEMVER.source}`));
});

test('agora --version: includes package version + alpha status', () => {
  const out = run(AGORA, ['--version']);
  assert.match(out, new RegExp(`agora \\(under guild-cli ${SEMVER.source}\\)`));
  assert.match(out, /alpha/);
});

test('agora -v: same as --version', () => {
  assert.equal(run(AGORA, ['-v']), run(AGORA, ['--version']));
});

test('devil --version: includes package version + v1 status', () => {
  const out = run(DEVIL, ['--version']);
  assert.match(out, new RegExp(`devil-review \\(under guild-cli ${SEMVER.source}\\)`));
  assert.match(out, /v1 complete/);
});

test('devil -v: same as --version', () => {
  assert.equal(run(DEVIL, ['-v']), run(DEVIL, ['--version']));
});

test('ctx --version: includes package version + phase 1 status', () => {
  const out = run(CTX, ['--version']);
  assert.match(out, new RegExp(`ctx \\(under guild-cli ${SEMVER.source}\\)`));
  assert.match(out, /alpha phase 1/);
});

test('ctx -v: same as --version', () => {
  assert.equal(run(CTX, ['-v']), run(CTX, ['--version']));
});
