// gate voices <name> — typo diagnostic for unknown actors.
//
// Pre-fix, `gate voices <typo>` returned identical empty output to
// `gate voices <registered-but-quiet>`. A caller could not tell
// whether the name was wrong or whether the actor simply had nothing
// to say — classic silent-fallback signal-loss
// (lore/traps/trap_silent_fallback_loses_signal).
//
// Fix: when the result set is empty AND the name matches neither a
// member nor a host, surface a typo diagnostic — `_meta.actor_unknown`
// in JSON mode, a 3-line "did you typo the name?" hint in text mode.
// A registered actor with no utterances is left alone (unchanged
// shape), so existing consumers reading the array form keep working.

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
  const root = mkdtempSync(join(tmpdir(), 'guild-voices-typo-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
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
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

test('gate voices <typo> --format text surfaces a "did you typo" hint', () => {
  const b = bootstrap();
  try {
    const r = run(b.root, ['voices', 'ghost-actor', '--format', 'text']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\(no utterances from ghost-actor\)/);
    assert.match(r.stdout, /not a registered member or host/);
    assert.match(r.stdout, /did you typo the name\?/);
    assert.match(r.stdout, /gate tail/);
  } finally {
    b.cleanup();
  }
});

test('gate voices <registered-quiet> --format text does NOT surface the typo hint', () => {
  const b = bootstrap();
  try {
    const r = run(b.root, ['voices', 'alice', '--format', 'text']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\(no utterances from alice\)/);
    assert.doesNotMatch(
      r.stdout,
      /typo/,
      'registered actor with no utterances must not be flagged as a typo',
    );
  } finally {
    b.cleanup();
  }
});

test('gate voices <host-name> --format text does NOT surface the typo hint', () => {
  // Hosts can have utterances (authored requests). When eris has none
  // recorded yet, the empty result must stay quiet — eris is a
  // configured host, not a typo.
  const b = bootstrap();
  try {
    const r = run(b.root, ['voices', 'eris', '--format', 'text']);
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /typo/);
  } finally {
    b.cleanup();
  }
});

test('gate voices <typo> --format json emits _meta.actor_unknown envelope', () => {
  const b = bootstrap();
  try {
    const r = run(b.root, ['voices', 'ghost-actor', '--format', 'json']);
    assert.equal(r.status, 0);
    const payload = JSON.parse(r.stdout);
    assert.deepEqual(payload.utterances, []);
    assert.equal(payload._meta.actor_unknown, true);
  } finally {
    b.cleanup();
  }
});

test('gate voices <registered-quiet> --format json keeps array shape', () => {
  // Existing JSON consumers depend on the array shape for the common
  // path (registered actor with results). The envelope shape only
  // triggers on the typo branch — registered-but-quiet stays as `[]`.
  const b = bootstrap();
  try {
    const r = run(b.root, ['voices', 'alice', '--format', 'json']);
    assert.equal(r.status, 0);
    const payload = JSON.parse(r.stdout);
    assert.ok(Array.isArray(payload), 'registered actor must keep array shape');
    assert.equal(payload.length, 0);
  } finally {
    b.cleanup();
  }
});

test('gate voices <typo> --format json --with-calibration carries _meta.actor_unknown', () => {
  const b = bootstrap();
  try {
    const r = run(b.root, [
      'voices',
      'ghost-actor',
      '--format',
      'json',
      '--with-calibration',
    ]);
    assert.equal(r.status, 0);
    const payload = JSON.parse(r.stdout);
    assert.deepEqual(payload.utterances, []);
    assert.equal(payload._meta.actor_unknown, true);
    // calibration field still present (null is fine; the contract is
    // that the object envelope is the shape).
    assert.ok('calibration' in payload);
  } finally {
    b.cleanup();
  }
});
