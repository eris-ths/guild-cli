// Voice plugin end-to-end contract (#345 — second dogfood validation of
// principle 15, ornamental-voice surface).
//
// Pins:
//   1. no GUILD_VOICE / no plugin → no `_meta` on envelope
//   2. GUILD_VOICE set + plugin loaded + matching template → `_meta.voice`
//      string interpolated from request snapshot
//   3. `when: cliff_present` matches only when cliff is present;
//      `cliff_absent` matches only when cliff is absent
//   4. doctrinal voice (message / suggested_next.reason) is UNCHANGED
//      when ornamental voice fires — augment-not-replace invariant
//   5. text-mode renders ornamental voice on stderr (a single line)
//      so JSON-piped consumers stay clean
//   6. `plugins.trusted: true` is required — without it, plugin path
//      is dropped with an onMalformed notice

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

interface Bootstrap {
  root: string;
  cleanup: () => void;
}

function bootstrap(opts?: { trusted?: boolean }): Bootstrap {
  const trusted = opts?.trusted ?? true;
  const root = makeTempRoot('guild-voice-');
  const trustLine = trusted ? '  trusted: true\n' : '';
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\n' +
      'host_names: [human]\n' +
      'plugins:\n' +
      trustLine +
      '  voices:\n' +
      '    - plugins/voices/test-voice.mjs\n',
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  mkdirSync(join(root, 'plugins', 'voices'), { recursive: true });
  writeFileSync(
    join(root, 'plugins', 'voices', 'test-voice.mjs'),
    `export default {
  name: 'test',
  verbs: {
    complete: [
      { when: 'cliff_present', template: '{action} :: cliff = {cliff}' },
      { when: 'default', template: '{action} :: done' },
    ],
  },
};
`,
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(cwd: string, args: string[], env: Record<string, string> = {}): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status ?? -1 };
}

function buildAndComplete(root: string, opts?: { cliff?: string }): string {
  const r1 = runGate(root, ['request', '--from', 'alice', '--action', 'do X', '--reason', 'r', '--executors', 'alice']);
  const m = r1.stdout.match(/created: (\S+)/);
  assert.ok(m, `parse id: ${r1.stdout}`);
  const id = m![1]!;
  runGate(root, ['approve', id, '--by', 'alice']);
  runGate(root, ['execute', id, '--by', 'alice']);
  return id;
}

test('voice: no GUILD_VOICE → no _meta on envelope', () => {
  const { root, cleanup } = bootstrap();
  try {
    const id = buildAndComplete(root);
    const r = runGate(root, ['complete', id, '--by', 'alice', '--format', 'json']);
    assert.equal(r.status, 0);
    const p = JSON.parse(r.stdout);
    assert.equal(p._meta, undefined, 'no GUILD_VOICE should suppress _meta');
  } finally {
    cleanup();
  }
});

test('voice: GUILD_VOICE picks plugin, cliff_present template fires with interpolation', () => {
  const { root, cleanup } = bootstrap();
  try {
    const id = buildAndComplete(root);
    const r = runGate(root,
      ['complete', id, '--by', 'alice', '--cliff', 'verify with bob', '--format', 'json'],
      { GUILD_VOICE: 'test' });
    assert.equal(r.status, 0);
    const p = JSON.parse(r.stdout);
    assert.ok(p._meta, '_meta should be present when voice is active and matched');
    assert.equal(p._meta.voice, 'do X :: cliff = verify with bob');
  } finally {
    cleanup();
  }
});

test('voice: cliff_absent path falls to `default` when no cliff', () => {
  const { root, cleanup } = bootstrap();
  try {
    const id = buildAndComplete(root);
    const r = runGate(root,
      ['complete', id, '--by', 'alice', '--format', 'json'],
      { GUILD_VOICE: 'test' });
    const p = JSON.parse(r.stdout);
    assert.equal(p._meta.voice, 'do X :: done');
  } finally {
    cleanup();
  }
});

test('voice: GUILD_VOICE referencing unknown plugin → no _meta (silent miss, not error)', () => {
  const { root, cleanup } = bootstrap();
  try {
    const id = buildAndComplete(root);
    const r = runGate(root,
      ['complete', id, '--by', 'alice', '--format', 'json'],
      { GUILD_VOICE: 'nonexistent' });
    assert.equal(r.status, 0);
    const p = JSON.parse(r.stdout);
    assert.equal(p._meta, undefined, 'unknown voice name should not error, just suppress _meta');
  } finally {
    cleanup();
  }
});

test('voice: doctrinal voice (message + suggested_next) unchanged when ornamental voice fires', () => {
  const { root, cleanup } = bootstrap();
  try {
    const id = buildAndComplete(root);
    const without = runGate(root,
      ['complete', id, '--by', 'alice', '--format', 'json']);

    // Second wave for the GUILD_VOICE case (the first wave is now closed)
    const id2 = buildAndComplete(root);
    const withVoice = runGate(root,
      ['complete', id2, '--by', 'alice', '--format', 'json'],
      { GUILD_VOICE: 'test' });

    const p1 = JSON.parse(without.stdout);
    const p2 = JSON.parse(withVoice.stdout);
    // Strip the embedded ids before comparing — voice doesn't touch
    // the message prose, but ids differ between the two waves.
    const stripId = (s: string) => s.replace(/2026-\d{2}-\d{2}-\d{4}/g, 'ID');
    assert.equal(stripId(p1.message), stripId(p2.message),
      'augment-not-replace: doctrinal `message` shape must be byte-identical with/without voice');
    // suggested_next.reason is doctrinal prose; voice does not touch it.
    // Compare reason verbatim; verb/args may carry ids so check separately.
    assert.equal(p1.suggested_next?.reason, p2.suggested_next?.reason,
      'augment-not-replace: suggested_next.reason must be byte-identical');
  } finally {
    cleanup();
  }
});

test('voice: text-mode renders voice on stderr (one line)', () => {
  const { root, cleanup } = bootstrap();
  try {
    const id = buildAndComplete(root);
    const r = runGate(root,
      ['complete', id, '--by', 'alice', '--cliff', 'pickup', '--format', 'text'],
      { GUILD_VOICE: 'test' });
    assert.equal(r.status, 0);
    // stdout: doctrinal "✓ completed: <id>"; stderr: ornamental "(voice: ...)"
    assert.match(r.stdout, /✓ completed:/);
    assert.match(r.stderr, /\(voice: do X :: cliff = pickup\)/);
  } finally {
    cleanup();
  }
});

test('voice: `plugins.trusted: true` required — without it, plugin is dropped', () => {
  const { root, cleanup } = bootstrap({ trusted: false });
  try {
    const id = buildAndComplete(root);
    const r = runGate(root,
      ['complete', id, '--by', 'alice', '--format', 'json'],
      { GUILD_VOICE: 'test' });
    // The plugin isn't loaded, so GUILD_VOICE=test resolves to nothing.
    // No error — just silent miss + onMalformed notice on the load side.
    const p = JSON.parse(r.stdout);
    assert.equal(p._meta, undefined,
      'without plugins.trusted, voice plugin should not load');
  } finally {
    cleanup();
  }
});
