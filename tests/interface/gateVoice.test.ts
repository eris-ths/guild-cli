// gate voice — mode-switch lever for the 4-layer voice resolution.
//
// Pins:
//   1. bare `gate voice` introspects + reports "off" when nothing set
//   2. `gate voice <name>` writes .guild-voice; introspect reflects file source
//   3. `gate voice off` clears the file idempotently
//   4. 4-layer resolution: file is picked up by write-envelope render
//   5. GUILD_VOICE env masks the file layer (introspect surfaces hint)
//   6. config.voice.default is the lowest layer (used when env + file are off)
//   7. invalid name → reject with `next:` hint
//   8. unloaded voice name → permissive set + notice (silent-miss carry-over)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(opts?: { configDefault?: string }): { root: string; cleanup: () => void } {
  const root = makeTempRoot('guild-voice-mode-');
  const cfg =
    'content_root: .\n' +
    'host_names: [human]\n' +
    'plugins:\n' +
    '  trusted: true\n' +
    '  voices:\n' +
    '    - plugins/voices/eris.mjs\n' +
    (opts?.configDefault ? `voice:\n  default: ${opts.configDefault}\n` : '');
  writeFileSync(join(root, 'guild.config.yaml'), cfg);
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  mkdirSync(join(root, 'plugins', 'voices'), { recursive: true });
  writeFileSync(
    join(root, 'plugins', 'voices', 'eris.mjs'),
    `export default {
  name: 'eris',
  verbs: { complete: [ { when: 'default', template: 'V:{action}' } ] },
};
`,
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(cwd: string, args: string[], env: Record<string, string> = {}): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? -1 };
}

test('gate voice (bare): reports off when nothing set', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, ['voice'], { GUILD_VOICE: '' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /voice: off/);
  } finally { cleanup(); }
});

test('gate voice <name>: writes .guild-voice; introspect reports source=file', () => {
  const { root, cleanup } = bootstrap();
  try {
    const set = runGate(root, ['voice', 'eris'], { GUILD_VOICE: '' });
    assert.equal(set.status, 0);
    assert.ok(existsSync(join(root, '.guild-voice')));
    assert.equal(readFileSync(join(root, '.guild-voice'), 'utf8').trim(), 'eris');

    const introspect = runGate(root, ['voice'], { GUILD_VOICE: '' });
    assert.match(introspect.stdout, /voice: eris/);
    assert.match(introspect.stdout, /source: file/);
  } finally { cleanup(); }
});

test('gate voice <name>: write-envelope picks up file-layer voice', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(root, ['voice', 'eris'], { GUILD_VOICE: '' });
    const cr = runGate(root, ['request', '--from', 'alice', '--action', 'X', '--reason', 'r', '--executors', 'alice'], { GUILD_VOICE: '' });
    const m = cr.stdout.match(/created: (\S+)/);
    assert.ok(m);
    const id = m![1]!;
    runGate(root, ['approve', id, '--by', 'alice'], { GUILD_VOICE: '' });
    runGate(root, ['execute', id, '--by', 'alice'], { GUILD_VOICE: '' });
    const r = runGate(root, ['complete', id, '--by', 'alice', '--format', 'json'], { GUILD_VOICE: '' });
    const p = JSON.parse(r.stdout);
    assert.equal(p._meta.voice, 'V:X', 'file-layer voice must drive write-envelope ornamentation');
  } finally { cleanup(); }
});

test('gate voice off: idempotent clear', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(root, ['voice', 'eris'], { GUILD_VOICE: '' });
    assert.ok(existsSync(join(root, '.guild-voice')));
    const r = runGate(root, ['voice', 'off'], { GUILD_VOICE: '' });
    assert.equal(r.status, 0);
    assert.ok(!existsSync(join(root, '.guild-voice')));
    // Second call: already off, no error.
    const r2 = runGate(root, ['voice', 'off'], { GUILD_VOICE: '' });
    assert.equal(r2.status, 0);
    assert.match(r2.stdout, /already off/);
  } finally { cleanup(); }
});

test('gate voice: GUILD_VOICE env masks file layer (introspect surfaces hint)', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(root, ['voice', 'eris']);
    const r = runGate(root, ['voice'], { GUILD_VOICE: 'override-mode' });
    assert.match(r.stdout, /voice: override-mode/);
    assert.match(r.stdout, /source: env/);
    assert.match(r.stdout, /masking lower layers/);
    assert.match(r.stdout, /unset GUILD_VOICE/);
  } finally { cleanup(); }
});

test('gate voice: config.voice.default is the lowest-priority layer', () => {
  const { root, cleanup } = bootstrap({ configDefault: 'baseline' });
  try {
    const r = runGate(root, ['voice'], { GUILD_VOICE: '' });
    assert.match(r.stdout, /voice: baseline/);
    assert.match(r.stdout, /source: config/);
  } finally { cleanup(); }
});

test('gate voice: invalid name → reject with next: hint', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, ['voice', 'Eris-CAPS'], { GUILD_VOICE: '' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /is not valid/);
    assert.match(r.stderr, /next:/);
  } finally { cleanup(); }
});

test('gate voice: unloaded name → permissive set + notice', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, ['voice', 'not-installed-yet'], { GUILD_VOICE: '' });
    assert.equal(r.status, 0, 'set is permissive on whether the plugin is loaded');
    assert.match(r.stdout, /notice: voice "not-installed-yet" is not currently loaded/);
  } finally { cleanup(); }
});

test('gate voice --format json: structured introspect output', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(root, ['voice', 'eris'], { GUILD_VOICE: '' });
    const r = runGate(root, ['voice', '--format', 'json'], { GUILD_VOICE: '' });
    const p = JSON.parse(r.stdout);
    assert.equal(p.active, 'eris');
    assert.equal(p.source, 'file');
    assert.ok(p.file_path.endsWith('.guild-voice'));
  } finally { cleanup(); }
});
