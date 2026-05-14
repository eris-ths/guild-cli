// past_cliffs voice re-rendering (#345 cluster Zeigarnik refinement, PR-B).
//
// Pins:
//   1. no voice → doctrinal dry render (3 lines per cliff entry)
//   2. voice with read.past_cliffs.header → header line voiced, entries dry
//   3. voice with read.past_cliffs.entry → header dry, entries voiced
//   4. voice with both → fully voiced
//   5. variables interpolate from cliff state (substrate truth, never invented)
//   6. JSON mode unaffected — structured past_cliffs unchanged regardless
//   7. unknown var renders as literal `{name}` (typo loudness invariant)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

interface BootOpts {
  header?: string;
  entry?: string;
}

function bootstrap(opts: BootOpts = {}): { root: string; cleanup: () => void } {
  const root = makeTempRoot('guild-past-cliffs-voice-');
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
  const pcParts: string[] = [];
  if (opts.header) pcParts.push(`      header: ${JSON.stringify(opts.header)}`);
  if (opts.entry) pcParts.push(`      entry: ${JSON.stringify(opts.entry)}`);
  const pcSection = pcParts.length > 0
    ? `,
  read: {
    past_cliffs: {
${pcParts.join(',\n')},
    },
  }`
    : '';
  writeFileSync(
    join(root, 'plugins', 'voices', 'eris.mjs'),
    `export default {
  name: 'eris',
  verbs: { complete: [{ when: 'default', template: 't' }] }${pcSection},
};
`,
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(cwd: string, args: string[], env: Record<string, string> = {}): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? -1 };
}

function makeCliff(root: string, action = 'do X', cliff = 'next: verify with bob'): void {
  const c = runGate(root, ['request', '--from', 'alice', '--action', action, '--reason', 'r', '--executors', 'alice']);
  const m = c.stdout.match(/created: (\S+)/);
  assert.ok(m);
  const id = m![1]!;
  runGate(root, ['approve', id, '--by', 'alice']);
  runGate(root, ['execute', id, '--by', 'alice']);
  runGate(root, ['complete', id, '--by', 'alice', '--cliff', cliff]);
}

test('past_cliffs render: no voice → doctrinal dry render', () => {
  const { root, cleanup } = bootstrap();
  try {
    makeCliff(root);
    const r = runGate(root, ['boot', '--format', 'text'], { GUILD_VOICE: '', GUILD_ACTOR: 'alice' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /past selves left these cliffs \(1\):/);
    assert.match(r.stdout, /action: do X/);
    assert.match(r.stdout, /cliff: {2}next: verify with bob/);
  } finally { cleanup(); }
});

test('past_cliffs render: voice header only → voiced header, doctrinal entries', () => {
  const { root, cleanup } = bootstrap({ header: '{count} 通の手紙' });
  try {
    makeCliff(root);
    const r = runGate(root, ['boot', '--format', 'text'], { GUILD_VOICE: 'eris', GUILD_ACTOR: 'alice' });
    assert.match(r.stdout, /1 通の手紙/);
    // entries still dry
    assert.match(r.stdout, /action: do X/);
    // doctrinal header replaced
    assert.doesNotMatch(r.stdout, /past selves left these cliffs/);
  } finally { cleanup(); }
});

test('past_cliffs render: voice entry only → voiced entries, doctrinal header', () => {
  const { root, cleanup } = bootstrap({ entry: '  ✧ {action} → {cliff}' });
  try {
    makeCliff(root);
    const r = runGate(root, ['boot', '--format', 'text'], { GUILD_VOICE: 'eris', GUILD_ACTOR: 'alice' });
    assert.match(r.stdout, /past selves left these cliffs/);
    assert.match(r.stdout, /✧ do X → next: verify with bob/);
    // doctrinal 3-line entry shape gone
    assert.doesNotMatch(r.stdout, /action: do X/);
  } finally { cleanup(); }
});

test('past_cliffs render: voice both → fully voiced', () => {
  const { root, cleanup } = bootstrap({
    header: '過去の私から {count} 通:',
    entry: '  {action}「{cliff}」',
  });
  try {
    makeCliff(root);
    const r = runGate(root, ['boot', '--format', 'text'], { GUILD_VOICE: 'eris', GUILD_ACTOR: 'alice' });
    assert.match(r.stdout, /過去の私から 1 通:/);
    assert.match(r.stdout, /do X「next: verify with bob」/);
    // No doctrinal fragments
    assert.doesNotMatch(r.stdout, /past selves left these cliffs/);
    assert.doesNotMatch(r.stdout, /action: do X/);
  } finally { cleanup(); }
});

test('past_cliffs render: variables come from substrate state', () => {
  const { root, cleanup } = bootstrap({ entry: '{closed_by}/{id}/{action}/{cliff}' });
  try {
    makeCliff(root, 'specific action', 'specific cliff');
    const r = runGate(root, ['boot', '--format', 'text'], { GUILD_VOICE: 'eris', GUILD_ACTOR: 'alice' });
    assert.match(r.stdout, /alice\/2026-\d{2}-\d{2}-\d{4}\/specific action\/specific cliff/);
  } finally { cleanup(); }
});

test('past_cliffs render: JSON mode unaffected (structured payload untouched)', () => {
  const { root, cleanup } = bootstrap({ header: 'never seen', entry: 'never seen' });
  try {
    makeCliff(root);
    const r = runGate(root, ['boot', '--format', 'json'], { GUILD_VOICE: 'eris', GUILD_ACTOR: 'alice' });
    const p = JSON.parse(r.stdout);
    // structured shape preserves the raw cliff data — JSON consumers
    // own their narration choice; voice plugin is text-mode only here.
    assert.equal(p.past_cliffs[0].action, 'do X');
    assert.equal(p.past_cliffs[0].cliff, 'next: verify with bob');
    assert.doesNotMatch(r.stdout, /never seen/);
  } finally { cleanup(); }
});

test('past_cliffs render: unknown var renders as literal {name} (typo loud)', () => {
  const { root, cleanup } = bootstrap({ entry: '{action} :: {typo_var}' });
  try {
    makeCliff(root);
    const r = runGate(root, ['boot', '--format', 'text'], { GUILD_VOICE: 'eris', GUILD_ACTOR: 'alice' });
    assert.match(r.stdout, /do X :: \{typo_var\}/);
  } finally { cleanup(); }
});
