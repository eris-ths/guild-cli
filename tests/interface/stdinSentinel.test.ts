// STDIN sentinel (`--text -` / --reason - / --comment -) across the
// CLI. Round-3 dogfood caught that `gate message` and `gate broadcast`
// silently stored the literal `-` because their handlers never wired
// the sentinel. `gate issues add` never read the `--text` flag at all.
// Both were symmetry gaps with `gate issues note`, which already had
// the three-route (`--text <s>` / `--text -` / positional) shape.
//
// These tests pin each surface via spawnSync-with-input so the
// stdin path round-trips end-to-end, not just the handler logic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-stdin-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const dir of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, dir));
  }
  for (const name of ['eris', 'claude']) {
    writeFileSync(
      join(root, 'members', `${name}.yaml`),
      `name: ${name}\ncategory: professional\nactive: true\n`,
    );
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(
  cwd: string,
  args: string[],
  opts: { input?: string; env?: Record<string, string> } = {},
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, ...(opts.env ?? {}) },
    input: opts.input,
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status ?? -1,
  };
}

// ── (1) gate message --text - ──

test('gate message --text - reads the message body from stdin', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { status } = runGate(
      root,
      ['message', '--from', 'eris', '--to', 'claude', '--text', '-'],
      { input: 'handoff note from stdin\n', env: { GUILD_ACTOR: 'eris' } },
    );
    assert.equal(status, 0);
    const inbox = YAML.parse(
      readFileSync(join(root, 'inbox', 'claude.yaml'), 'utf8'),
    );
    assert.equal(inbox.messages.length, 1);
    assert.equal(inbox.messages[0].text, 'handoff note from stdin');
  } finally {
    cleanup();
  }
});

test('gate message --text <s> inline still works (no stdin)', () => {
  // Regression guard: the stdin branch must not clobber the existing
  // inline path.
  const { root, cleanup } = bootstrap();
  try {
    const { status } = runGate(
      root,
      [
        'message',
        '--from',
        'eris',
        '--to',
        'claude',
        '--text',
        'inline body',
      ],
      { env: { GUILD_ACTOR: 'eris' } },
    );
    assert.equal(status, 0);
    const inbox = YAML.parse(
      readFileSync(join(root, 'inbox', 'claude.yaml'), 'utf8'),
    );
    assert.equal(inbox.messages[0].text, 'inline body');
  } finally {
    cleanup();
  }
});

// ── (1) gate broadcast --text - ──

test('gate broadcast --text - reads the message body from stdin', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { status } = runGate(
      root,
      ['broadcast', '--from', 'eris', '--text', '-'],
      {
        input: 'guild-wide announcement via pipe\n',
        env: { GUILD_ACTOR: 'eris' },
      },
    );
    assert.equal(status, 0);
    const inbox = YAML.parse(
      readFileSync(join(root, 'inbox', 'claude.yaml'), 'utf8'),
    );
    assert.equal(inbox.messages[0].text, 'guild-wide announcement via pipe');
    // Broadcast type, not "message" — verifies the handler path
    // didn't short-circuit to the wrong code branch.
    assert.equal(inbox.messages[0].type, 'broadcast');
  } finally {
    cleanup();
  }
});

// ── (2) gate issues add --text ──

test('gate issues add --text <s>: inline flag accepted (new in this PR)', () => {
  // Pre-fix: `--text <s>` threw "Usage: gate issues add ... <text>".
  // Pin so users who reach for muscle memory from `issues note` don't
  // bounce off the wall.
  const { root, cleanup } = bootstrap();
  try {
    const { status, stdout } = runGate(
      root,
      [
        'issues',
        'add',
        '--from',
        'eris',
        '--severity',
        'low',
        '--area',
        'ux',
        '--text',
        'flag inline',
      ],
      { env: { GUILD_ACTOR: 'eris' } },
    );
    assert.equal(status, 0);
    assert.match(stdout, /✓ issue:/);
  } finally {
    cleanup();
  }
});

test('gate issues add --text -: reads text from stdin', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { status } = runGate(
      root,
      [
        'issues',
        'add',
        '--from',
        'eris',
        '--severity',
        'low',
        '--area',
        'ux',
        '--text',
        '-',
      ],
      {
        input: 'long issue body from pipe\n',
        env: { GUILD_ACTOR: 'eris' },
      },
    );
    assert.equal(status, 0);
  } finally {
    cleanup();
  }
});

test('gate issues add <positional>: backward-compat legacy form still works', () => {
  // The original (and for a while only) way to pass text. The new
  // --text flag is additive; positional must keep working.
  const { root, cleanup } = bootstrap();
  try {
    const { status, stdout } = runGate(
      root,
      [
        'issues',
        'add',
        '--from',
        'eris',
        '--severity',
        'low',
        '--area',
        'ux',
        'legacy positional body',
      ],
      { env: { GUILD_ACTOR: 'eris' } },
    );
    assert.equal(status, 0);
    assert.match(stdout, /✓ issue:/);
  } finally {
    cleanup();
  }
});

test('gate issues add: neither --text nor positional → informative error', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { status, stderr } = runGate(
      root,
      ['issues', 'add', '--from', 'eris', '--severity', 'low', '--area', 'ux'],
      { env: { GUILD_ACTOR: 'eris' } },
    );
    assert.notEqual(status, 0);
    // Usage names all three routes so the reader sees the full surface.
    assert.match(stderr, /--text <s>/);
    assert.match(stderr, /--text -/);
    assert.match(stderr, /<text>/);
  } finally {
    cleanup();
  }
});

test('gate issues add --text <value-starting-with--> surfaces the POSIX escape hint', () => {
  // Same hint shape as `issues note` + `review`: when the user
  // passes a value that begins with "--", the parser refuses it and
  // the handler's fallback error points at the escape valves.
  //
  // The sentinel `--text` value here is `--severity` — another *known*
  // flag, so strict unknown-flag rejection (see PR adding
  // rejectUnknownFlags to all write verbs) does not short-circuit
  // the handler before the escape-hint path runs. Using an unknown
  // flag like `--reason` as the sentinel would fire the strict-reject
  // guard first and never reach the hint; picking a known flag is
  // deliberate so both guards stay testable independently.
  const { root, cleanup } = bootstrap();
  try {
    const { status, stderr } = runGate(
      root,
      [
        'issues',
        'add',
        '--from',
        'eris',
        '--area',
        'ux',
        '--text',
        '--severity',
        'low',
      ],
      { env: { GUILD_ACTOR: 'eris' } },
    );
    assert.notEqual(status, 0);
    assert.match(stderr, /--text=<value>/);
    assert.match(stderr, /-- <value>/);
  } finally {
    cleanup();
  }
});

// ── positional `-` as stdin sentinel (symmetry with --comment -/--text -) ──

// IDs carry today's UTC date from gate's clock, so the prefix is
// derived at run time rather than baked in (the old `2026-04-18`
// literals only matched on the day the test was authored).
const _today = () => new Date().toISOString().slice(0, 10);

test('gate review <id> ... - reads stdin (positional sentinel)', () => {
  const { root, cleanup } = bootstrap();
  try {
    // Pre-create a target request for review.
    runGate(
      root,
      ['request', '--from', 'eris', '--action', 'x', '--reason', 'r'],
      { env: { GUILD_ACTOR: 'eris' } },
    );
    const reqId = `${_today()}-0001`;
    const { status } = runGate(
      root,
      [
        'review',
        reqId,
        '--by',
        'claude',
        '--lense',
        'devil',
        '--verdict',
        'ok',
        '-',
      ],
      { input: 'stdin review body\n', env: { GUILD_ACTOR: 'claude' } },
    );
    assert.equal(status, 0);
    // Assert via gate show that the comment landed (not literal "-").
    const { stdout } = runGate(root, ['show', reqId, '--format', 'text']);
    assert.match(stdout, /stdin review body/);
    assert.equal(/\[devil\/ok\] by claude.*\n\s+-\n/.test(stdout), false);
  } finally {
    cleanup();
  }
});

test('gate issues note <id> ... - reads stdin (positional sentinel)', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['issues', 'add', '--from', 'eris', '--severity', 'low', '--area', 'x',
       '--text', 'seed'],
      { env: { GUILD_ACTOR: 'eris' } },
    );
    const issueId = `i-${_today()}-0001`;
    const { status } = runGate(
      root,
      ['issues', 'note', issueId, '--by', 'eris', '-'],
      { input: 'stdin note body\n', env: { GUILD_ACTOR: 'eris' } },
    );
    assert.equal(status, 0);
    const { stdout } = runGate(root, ['issues', 'list']);
    assert.match(stdout, /stdin note body/);
  } finally {
    cleanup();
  }
});

test('gate issues add ... - reads stdin (positional sentinel, symmetric to note)', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { status } = runGate(
      root,
      ['issues', 'add', '--from', 'eris', '--severity', 'low', '--area', 'x',
       '-'],
      { input: 'stdin issue body\n', env: { GUILD_ACTOR: 'eris' } },
    );
    assert.equal(status, 0);
    const { stdout } = runGate(root, ['issues', 'list']);
    assert.match(stdout, /stdin issue body/);
  } finally {
    cleanup();
  }
});
