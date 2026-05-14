// Dogfood-driven polish bundle (#382 follow-up):
//   P0  gate voice introspect hint only fires for env source
//   P1  fast-track fires ornamental voice on its complete segment
//   P3  gate --help --essentials --compact renders 1 line per verb

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(opts?: { configDefault?: string }): { root: string; cleanup: () => void } {
  const root = makeTempRoot('guild-polish-');
  const cfg =
    'content_root: .\n' +
    'host_names: [human]\n' +
    'plugins:\n' +
    '  trusted: true\n' +
    '  voices:\n' +
    '    - plugins/voices/test.mjs\n' +
    (opts?.configDefault ? `voice:\n  default: ${opts.configDefault}\n` : '');
  writeFileSync(join(root, 'guild.config.yaml'), cfg);
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  mkdirSync(join(root, 'plugins', 'voices'), { recursive: true });
  writeFileSync(
    join(root, 'plugins', 'voices', 'test.mjs'),
    `export default {
  name: 'test',
  verbs: {
    complete: [ { when: 'default', template: 'V:{action}' } ],
  },
  essentials: {
    verbs: ['boot', 'fast-track', 'complete'],
    note: 'three',
  },
};
`,
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(cwd: string, args: string[], env: Record<string, string> = {}): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? -1 };
}

test('P0: gate voice with config source does NOT emit a masking hint', () => {
  const { root, cleanup } = bootstrap({ configDefault: 'test' });
  try {
    const r = runGate(root, ['voice'], { GUILD_VOICE: '' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /voice: test \(source: config\)/);
    // The pre-fix code emitted "higher-priority layer in effect" on
    // any non-file source, including config. Config is the BOTTOM
    // layer — nothing masks it — so the hint was misleading.
    assert.doesNotMatch(r.stdout, /higher-priority/);
    assert.doesNotMatch(r.stdout, /masking lower layers/);
  } finally { cleanup(); }
});

test('P0: gate voice with env source DOES emit the masking hint', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, ['voice'], { GUILD_VOICE: 'env-set' });
    assert.match(r.stdout, /source: env/);
    assert.match(r.stdout, /masking lower layers/);
    assert.match(r.stdout, /unset GUILD_VOICE/);
  } finally { cleanup(); }
});

test('P1: fast-track fires ornamental voice (cluster mid-step → complete)', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root,
      ['fast-track', '--from', 'alice', '--action', 'one-shot', '--reason', 'r', '--format', 'json'],
      { GUILD_VOICE: 'test' });
    assert.equal(r.status, 0);
    const p = JSON.parse(r.stdout);
    assert.ok(p._meta, 'fast-track must surface _meta.voice when active voice has a complete template');
    assert.equal(p._meta.voice, 'V:one-shot',
      'voice template fires on fast-track\'s complete segment');
  } finally { cleanup(); }
});

test('P1: fast-track without active voice → no _meta (silent contract carries)', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root,
      ['fast-track', '--from', 'alice', '--action', 'X', '--reason', 'r', '--format', 'json'],
      { GUILD_VOICE: '' });
    const p = JSON.parse(r.stdout);
    assert.equal(p._meta, undefined);
  } finally { cleanup(); }
});

test('P3: --essentials --compact renders one line per verb', () => {
  const { root, cleanup } = bootstrap({ configDefault: 'test' });
  try {
    const r = runGate(root, ['--help', '--essentials', '--compact'], { GUILD_VOICE: '' });
    assert.equal(r.status, 0);
    // The full --essentials renders multi-line entries; --compact
    // collapses each entry to its first usage line. Count usage
    // lines (lines starting "  gate <verb>") — they should match
    // the count of curated verbs (modulo verbs with no help entry).
    const usageLines = (r.stdout.match(/^ {2}gate [a-z]/gm) ?? []).length;
    // The fixture curates 3 verbs (boot, fast-track, complete).
    // All three have help entries → 3 usage lines.
    assert.equal(usageLines, 3, `expected 3 usage lines in compact mode, got ${usageLines}`);
    // Description lines (continuation lines under each entry) should
    // be ABSENT in compact mode — that's the whole point of compact.
    // Look for the "next-pointing hint" continuation that the
    // multi-line render emits; if it's gone, compact is working.
    assert.doesNotMatch(r.stdout, /Surfaced under/);
    assert.doesNotMatch(r.stdout, /forward-pointing/);
  } finally { cleanup(); }
});

test('P3: --essentials without --compact still renders multi-line (default)', () => {
  const { root, cleanup } = bootstrap({ configDefault: 'test' });
  try {
    const r = runGate(root, ['--help', '--essentials'], { GUILD_VOICE: '' });
    assert.equal(r.status, 0);
    // Multi-line entries return — at least one continuation line
    // referencing per-flag detail should appear.
    assert.match(r.stdout, /next-step|forward-pointing|Surfaced under|Single-command/);
  } finally { cleanup(); }
});

test('P3: --compact without --essentials is a noop (default tier rendering)', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, ['--help', '--compact'], { GUILD_VOICE: '' });
    // Standard profile BASE tier — multi-line entries are intended
    // here; --compact only narrows the essentials projection.
    assert.equal(r.status, 0);
    assert.match(r.stdout, /showing: BASE/);
  } finally { cleanup(); }
});
