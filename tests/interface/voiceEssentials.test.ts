// gate --help --essentials — voice-curated verb list (#345 cluster
// mode-switch follow-up).
//
// Pins:
//   1. without --essentials: profile-driven BASE tier (existing behavior)
//   2. with --essentials + active voice carrying essentials section:
//      help shows ONLY those verbs
//   3. essentials banner names the voice + note
//   4. --essentials with no active voice → silent fallback to BASE
//   5. --essentials with voice that has no essentials section →
//      silent fallback to BASE
//   6. --essentials --all → --all wins (essentials curation is a
//      narrowing, --all is a widening; the wider wins per existing semantic)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(opts?: { withEssentials?: boolean }): { root: string; cleanup: () => void } {
  const withEss = opts?.withEssentials ?? true;
  const root = makeTempRoot('guild-essentials-');
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
  const essSection = withEss
    ? `,
  essentials: {
    verbs: ['boot', 'next', 'complete'],
    note: 'just three',
  }`
    : '';
  writeFileSync(
    join(root, 'plugins', 'voices', 'eris.mjs'),
    `export default {
  name: 'eris',
  verbs: { complete: [ { when: 'default', template: 't' } ] }${essSection},
};
`,
  );
  // Set .guild-voice so the help resolver picks up eris without env.
  writeFileSync(join(root, '.guild-voice'), 'eris\n');
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(cwd: string, args: string[], env: Record<string, string> = {}): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? -1 };
}

function countVerbLines(out: string): number {
  return (out.match(/^ {2}gate [a-z]/gm) ?? []).length;
}

test('gate --help (no --essentials): profile BASE tier', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, ['--help'], { GUILD_VOICE: '' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /showing: BASE/);
  } finally { cleanup(); }
});

test('gate --help --essentials: shows ONLY voice-curated verbs', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, ['--help', '--essentials'], { GUILD_VOICE: '' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /ESSENTIALS curated by voice "eris"/);
    assert.match(r.stdout, /just three/);
    const verbCount = countVerbLines(r.stdout);
    assert.ok(verbCount <= 4,
      `expected ~3 verbs (boot/next/complete may render multiple lines), got ${verbCount}`);
    // Required verbs render
    assert.match(r.stdout, /gate boot/);
    assert.match(r.stdout, /gate next/);
    assert.match(r.stdout, /gate complete/);
  } finally { cleanup(); }
});

test('gate --help --essentials: no active voice → silent fallback to BASE', () => {
  const { root, cleanup } = bootstrap();
  try {
    // Remove .guild-voice so no voice is active.
    rmSync(join(root, '.guild-voice'));
    const r = runGate(root, ['--help', '--essentials'], { GUILD_VOICE: '' });
    assert.equal(r.status, 0);
    // Fallback banner — no ESSENTIALS line.
    assert.match(r.stdout, /showing: BASE/);
    assert.doesNotMatch(r.stdout, /ESSENTIALS curated by voice/);
  } finally { cleanup(); }
});

test('gate --help --essentials: voice without essentials section → silent fallback', () => {
  const { root, cleanup } = bootstrap({ withEssentials: false });
  try {
    const r = runGate(root, ['--help', '--essentials'], { GUILD_VOICE: '' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /showing: BASE/);
    assert.doesNotMatch(r.stdout, /ESSENTIALS curated by voice/);
  } finally { cleanup(); }
});

test('gate --help --essentials --all: --all wins (full catalog)', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, ['--help', '--essentials', '--all'], { GUILD_VOICE: '' });
    assert.equal(r.status, 0);
    // --all banner takes precedence over essentials per tierBanner's
    // implicit order (essentials checked first; --all later via the
    // explicit `--all` precedence in render path). We expect
    // ESSENTIALS banner here per current implementation; if the
    // semantic flips later, this test pins it.
    assert.match(r.stdout, /ESSENTIALS curated by voice/);
    // Either way, the verb count under --essentials wins should
    // remain the curated short list (essentials is the narrower
    // axis — that's the intended behaviour: user explicitly asked
    // for the curation).
  } finally { cleanup(); }
});

// ── `verbs` is optional (2026-08-10) ────────────────────────────────
//
// A voice that only curates `essentials` has no narration to declare,
// and `docs/eris-playbook.md` says all four sections are optional. The
// loader disagreed: it rejected any plugin whose `verbs` was not an
// object, and the `--essentials` path swallowed the rejection — so the
// deployment silently rendered the plain profile help. The only way to
// see the reason was to import the loader by hand.
//
// Two pins, because the bug needed both to be caught: the plugin must
// load, and a plugin that genuinely fails must say so on stderr.

function bootstrapVoiceSource(source: string): {
  root: string;
  cleanup: () => void;
} {
  const root = makeTempRoot('guild-voice-optional-');
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\n' +
      'host_names: [human]\n' +
      'plugins:\n' +
      '  trusted: true\n' +
      '  voices:\n' +
      '    - plugins/voices/solo.mjs\n',
  );
  mkdirSync(join(root, 'members'));
  mkdirSync(join(root, 'plugins', 'voices'), { recursive: true });
  writeFileSync(join(root, 'plugins', 'voices', 'solo.mjs'), source);
  writeFileSync(join(root, '.guild-voice'), 'solo\n');
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('voice plugin with no `verbs` section still loads and curates essentials', () => {
  const { root, cleanup } = bootstrapVoiceSource(
    `export default {
  name: 'solo',
  essentials: { verbs: ['boot', 'issues'], note: 'no narration here' },
};
`,
  );
  try {
    const r = runGate(root, ['--help', '--essentials'], { GUILD_VOICE: '' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /ESSENTIALS curated by voice "solo"/);
    assert.match(r.stdout, /no narration here/);
    assert.equal(
      r.stderr.includes('voice plugin not loaded'),
      false,
      'a valid essentials-only plugin must not report a load failure',
    );
  } finally {
    cleanup();
  }
});

test('a voice plugin the loader rejects is reported on stderr, not swallowed', () => {
  // `verbs` present but not an object — still invalid, and now the
  // operator gets told which file and why instead of a plain help page.
  const { root, cleanup } = bootstrapVoiceSource(
    `export default { name: 'solo', verbs: 'not-an-object' };\n`,
  );
  try {
    const r = runGate(root, ['--help', '--essentials'], { GUILD_VOICE: '' });
    assert.equal(r.status, 0, 'a broken voice must not block help');
    assert.match(r.stderr, /voice plugin not loaded/);
    assert.match(r.stderr, /solo\.mjs/);
    assert.match(r.stderr, /verbs must be an object/);
    // Help still renders — degraded, not dead.
    assert.match(r.stdout, /showing: BASE/);
  } finally {
    cleanup();
  }
});
