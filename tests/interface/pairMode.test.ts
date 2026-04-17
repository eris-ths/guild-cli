// pair-mode Layer 1 — `with` field surfaces on every agent-facing view.
//
// The invariant: what was once written with a partner stays visible
// as a partnered utterance. voices, show, resume, tail must all
// render `(with <partner>)` so readers can't mistake a paired
// decision for a solo one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectUtterances,
  renderUtterance,
  RequestJSON,
  AuthoredUtterance,
} from '../../src/interface/gate/voices.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');
const GUILD = resolve(here, '../../../bin/guild.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-pair-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  mkdirSync(join(root, 'members'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? -1 };
}

function runGuild(cwd: string, args: string[]): void {
  spawnSync(process.execPath, [GUILD, ...args], { cwd, stdio: 'ignore' });
}

test('collectUtterances carries `with` onto authored utterances', () => {
  const reqs: RequestJSON[] = [
    {
      id: 'x',
      from: 'alice',
      action: 'a',
      reason: 'r',
      created_at: '2026-04-16T00:00:00Z',
      with: ['eris'],
    },
  ];
  const out = collectUtterances(reqs, {});
  assert.equal(out.length, 1);
  const first = out[0]! as AuthoredUtterance;
  assert.equal(first.kind, 'authored');
  assert.deepEqual(first.with, ['eris']);
});

test('renderUtterance appends "(with ...)" on authored lines; unchanged when solo', () => {
  const solo = renderUtterance(
    {
      kind: 'authored',
      at: '2026-04-16T00:00:00Z',
      requestId: 'x',
      from: 'alice',
      action: 'a',
      reason: 'r',
    },
    true,
  );
  assert.doesNotMatch(solo, /\(with /);

  const paired = renderUtterance(
    {
      kind: 'authored',
      at: '2026-04-16T00:00:00Z',
      requestId: 'x',
      from: 'alice',
      action: 'a',
      reason: 'r',
      with: ['eris', 'bob'],
    },
    true,
  );
  assert.match(paired, /\(with eris, bob\)/);
});

test('gate request --with eris persists the field and `gate show` renders it', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGuild(root, ['new', '--name', 'claude', '--category', 'professional']);
    runGate(root, [
      'request',
      '--from', 'claude',
      '--with', 'eris',
      '--action', 'paired work',
      '--reason', 'felt like it',
    ]);
    const list = runGate(root, ['list', '--state', 'pending', '--format', 'text']);
    const id = list.stdout.match(/(\d{4}-\d{2}-\d{2}-\d{4})/)?.[1];
    assert.ok(id);
    const show = runGate(root, ['show', id!, '--format', 'text']);
    assert.match(show.stdout, /with:\s+eris/);
    // Also in JSON output
    const showJson = runGate(root, ['show', id!, '--format', 'json']);
    const payload = JSON.parse(showJson.stdout);
    assert.deepEqual(payload['with'], ['eris']);
  } finally {
    cleanup();
  }
});

test('gate request --with accepts comma-separated list', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGuild(root, ['new', '--name', 'claude', '--category', 'professional']);
    runGuild(root, ['new', '--name', 'alice', '--category', 'professional']);
    runGate(root, [
      'request',
      '--from', 'claude',
      '--with', 'eris, alice',
      '--action', 'a',
      '--reason', 'r',
    ]);
    const list = runGate(root, ['list', '--state', 'pending', '--format', 'text']);
    const id = list.stdout.match(/(\d{4}-\d{2}-\d{2}-\d{4})/)?.[1];
    const show = runGate(root, ['show', id!, '--format', 'json']);
    const payload = JSON.parse(show.stdout);
    assert.deepEqual(payload['with'], ['eris', 'alice']);
  } finally {
    cleanup();
  }
});

test('gate request rejects --with for unknown member/host', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGuild(root, ['new', '--name', 'claude', '--category', 'professional']);
    const { status, stderr } = runGate(root, [
      'request',
      '--from', 'claude',
      '--with', 'ghost',
      '--action', 'a',
      '--reason', 'r',
    ]);
    assert.equal(status, 1);
    assert.match(stderr, /--with.*ghost|no such member or host/i);
  } finally {
    cleanup();
  }
});

test('gate resume prose surfaces "shaped with <partner>" for paired utterances', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGuild(root, ['new', '--name', 'claude', '--category', 'professional']);
    runGate(root, [
      'fast-track',
      '--from', 'claude',
      '--with', 'eris',
      '--action', 'paired decision',
      '--reason', 'shaped together',
    ]);
    const { stdout } = runGate(root, ['resume', '--format', 'text'], {
      GUILD_ACTOR: 'claude',
    });
    assert.match(stdout, /shaped with eris/);
  } finally {
    cleanup();
  }
});

test('gate resume (ja) uses "と一緒に" for paired utterances', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGuild(root, ['new', '--name', 'claude', '--category', 'professional']);
    runGate(root, [
      'fast-track',
      '--from', 'claude',
      '--with', 'eris',
      '--action', 'paired',
      '--reason', 'r',
    ]);
    const { stdout } = runGate(
      root,
      ['resume', '--format', 'text', '--locale', 'ja'],
      { GUILD_ACTOR: 'claude' },
    );
    assert.match(stdout, /と一緒に/);
  } finally {
    cleanup();
  }
});
