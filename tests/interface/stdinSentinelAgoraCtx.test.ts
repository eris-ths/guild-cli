// STDIN sentinel — the agora and ctx half.
//
// `tests/interface/stdinSentinel.test.ts` pins the gate surfaces after
// round-3 dogfood found handlers that accepted `-` but never wired it,
// silently storing the literal one-character body. The same gap was
// still open on every prose flag outside gate:
//
//   agora move --text -            agora suspend --cliff -/--invitation -
//   agora conclude/resume --note - ctx record/supersede --fact -
//
// Field report that produced this file: a downstream house passed
// `--text -` and `--fact -` for a day on the strength of the gate
// convention. 18 agora moves and 9 ctx records landed with a body of
// `-` and exit status 0. Nothing surfaced until the play was read back
// after a context compaction — and one of the emptied moves was the
// handoff record written *for* that compaction, i.e. the copy that
// existed precisely because no other copy would.
//
// So these tests pin three things per surface, not one:
//   (1) `-` round-trips the body from stdin
//   (2) two `-` flags in one invocation are refused (one stdin)
//   (3) an empty pipe is refused rather than stored

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const AGORA = resolve(here, '../../../bin/agora.mjs');
const CTX = resolve(here, '../../../bin/ctx.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-stdin-ac-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, d));
  }
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(
  bin: string,
  cwd: string,
  args: string[],
  input?: string,
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    env: { ...process.env },
    input,
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

function seedPlay(root: string): string {
  run(AGORA, root, [
    'new', '--slug', 'sandbox', '--kind', 'sandbox',
    '--title', 'Sandbox', '--by', 'alice',
  ]);
  run(AGORA, root, ['play', '--slug', 'sandbox', '--by', 'alice']);
  const today = new Date().toISOString().slice(0, 10);
  return `${today}-001`;
}

function playPath(root: string, playId: string): string {
  return join(root, 'agora', 'plays', 'sandbox', `${playId}.yaml`);
}

function readPlay(root: string, playId: string): { moves: { text: string }[] } {
  return YAML.parse(readFileSync(playPath(root, playId), 'utf8'));
}

function rawPlay(root: string, playId: string): string {
  return readFileSync(playPath(root, playId), 'utf8');
}

function readOnlyCtx(root: string): { fact: string } {
  const dir = join(root, 'ctx');
  const files = readdirSync(dir).filter((f) => f.endsWith('.yaml'));
  assert.equal(files.length, 1, 'expected exactly one ctx record');
  return YAML.parse(readFileSync(join(dir, files[0] as string), 'utf8'));
}

// ── (1) agora move --text - ──

test('agora move --text - reads the move body from stdin', () => {
  const { root, cleanup } = bootstrap();
  try {
    const playId = seedPlay(root);
    const body = 'first line\n\nthird line — multi-paragraph prose survives';
    const { status } = run(
      AGORA, root,
      ['move', playId, '--by', 'alice', '--text', '-'],
      `${body}\n`,
    );
    assert.equal(status, 0);
    const moves = readPlay(root, playId).moves;
    assert.equal(moves.length, 1);
    assert.equal(moves[0]?.text, body);
  } finally {
    cleanup();
  }
});

test('agora move --text - refuses an empty stdin instead of storing it', () => {
  const { root, cleanup } = bootstrap();
  try {
    const playId = seedPlay(root);
    const { status, stderr } = run(
      AGORA, root,
      ['move', playId, '--by', 'alice', '--text', '-'],
      '',
    );
    assert.notEqual(status, 0);
    assert.match(stderr, /stdin was empty/);
    assert.equal(readPlay(root, playId).moves.length, 0);
  } finally {
    cleanup();
  }
});

// ── (2) agora suspend --cliff - / --invitation - ──

test('agora suspend --cliff - reads the cliff from stdin', () => {
  const { root, cleanup } = bootstrap();
  try {
    const playId = seedPlay(root);
    const { status } = run(
      AGORA, root,
      [
        'suspend', playId, '--by', 'alice',
        '--cliff', '-',
        '--invitation', 'pick up the failing lane',
      ],
      'the harness went red on lane 4\n',
    );
    assert.equal(status, 0);
    const yaml = rawPlay(root, playId);
    assert.match(yaml, /cliff: the harness went red on lane 4/);
    assert.match(yaml, /invitation: pick up the failing lane/);
  } finally {
    cleanup();
  }
});

test('agora suspend refuses --cliff - and --invitation - together', () => {
  const { root, cleanup } = bootstrap();
  try {
    const playId = seedPlay(root);
    const { status, stderr } = run(
      AGORA, root,
      ['suspend', playId, '--by', 'alice', '--cliff', '-', '--invitation', '-'],
      'only one body to give\n',
    );
    assert.notEqual(status, 0);
    assert.match(stderr, /only one stdin/);
    // The play must still be resumable — a refused suspend is a no-op.
    assert.equal(readPlay(root, playId).moves.length, 0);
  } finally {
    cleanup();
  }
});

// ── (3) ctx record --fact - ──

test('ctx record --fact - reads the fact from stdin', () => {
  const { root, cleanup } = bootstrap();
  try {
    const body = 'measured 2026-08-16: the sentinel was unwired outside gate';
    const { status } = run(
      CTX, root,
      ['record', '--by', 'alice', '--tag', 'topic:records', '--fact', '-'],
      `${body}\n`,
    );
    assert.equal(status, 0);
    assert.equal(readOnlyCtx(root).fact, body);
  } finally {
    cleanup();
  }
});

test('ctx record --fact - refuses an empty stdin instead of storing it', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { status, stderr } = run(
      CTX, root,
      ['record', '--by', 'alice', '--tag', 'topic:records', '--fact', '-'],
      '   \n',
    );
    assert.notEqual(status, 0);
    assert.match(stderr, /stdin was empty/);
    const ctxDir = join(root, 'ctx');
    assert.equal(existsSync(ctxDir) ? readdirSync(ctxDir).length : 0, 0);
  } finally {
    cleanup();
  }
});

// ── (4) the pass-through case must not regress ──

test('a literal value is unaffected by the sentinel wiring', () => {
  const { root, cleanup } = bootstrap();
  try {
    const playId = seedPlay(root);
    const { status } = run(AGORA, root, [
      'move', playId, '--by', 'alice', '--text', 'plain inline text',
    ]);
    assert.equal(status, 0);
    assert.equal(readPlay(root, playId).moves[0]?.text, 'plain inline text');
  } finally {
    cleanup();
  }
});
