// --explain — universal orientation flag.
//
// Surfaces this test pins:
//   - `--explain` on a registered verb writes the orientation line
//     to stderr, leaving stdout untouched.
//   - `--explain` composes with `--format json` without corrupting
//     the stdout JSON payload (a pipeline reading stdout into a
//     JSON parser stays working).
//   - `--explain` is universal: it passes through
//     `rejectUnknownFlags` even on verbs that don't list it in
//     their KNOWN_FLAGS set. When the verb has no message
//     registered, the flag is accepted silently (no error, no
//     output).
//   - `--explain` does NOT short-circuit: the verb's normal output
//     still runs.

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
  const root = mkdtempSync(join(tmpdir(), 'guild-explain-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, d));
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('gate lore list --explain emits orientation to stderr, leaves stdout intact', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = spawnSync(process.execPath, [GATE, 'lore', 'list', '--explain'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /^\(explain: lists every package-shipped/);
    // stdout is the actual list — does NOT carry the explain line.
    assert.doesNotMatch(r.stdout, /^\(explain:/);
    assert.match(r.stdout, /\[principle\]/);
  } finally {
    cleanup();
  }
});

test('gate lore list --explain --format json keeps stdout parseable as JSON', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = spawnSync(
      process.execPath,
      [GATE, 'lore', 'list', '--explain', '--format', 'json'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /^\(explain:/);
    // stdout must parse — the orientation line stayed on stderr.
    const parsed = JSON.parse(r.stdout);
    assert.ok(Array.isArray(parsed));
  } finally {
    cleanup();
  }
});

test('gate lore show --explain emits show-specific orientation', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = spawnSync(
      process.execPath,
      [GATE, 'lore', 'show', '01-silent-calibration', '--explain'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /^\(explain: reads one principle or trap/);
  } finally {
    cleanup();
  }
});

test('--explain on a verb with no registered message is accepted silently (no unknown-flag error)', () => {
  // `gate voices` is a read verb without an EXPLAIN_MESSAGES entry.
  // The flag must still pass rejectUnknownFlags — universal flags
  // are never rejected, even when no message is registered. The
  // contract: register a message later, no callsite change needed.
  const { root, cleanup } = bootstrap();
  try {
    const r = spawnSync(
      process.execPath,
      [GATE, 'voices', '--explain'],
      { cwd: root, encoding: 'utf8' },
    );
    // We don't pin exit code (voices may fail for other reasons in a
    // bare tmpdir), but the stderr must NOT contain an "unknown
    // flag" complaint about `--explain`.
    assert.doesNotMatch(r.stderr, /unknown flag.*--explain/);
  } finally {
    cleanup();
  }
});
