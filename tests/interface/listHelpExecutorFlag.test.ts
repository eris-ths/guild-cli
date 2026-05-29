// gate list: help text ↔ runtime flag alignment (principle 10 /
// trap_help_text_drift_on_new_verb).
//
// The BASE `gate --help` catalog advertised the list filter as
// `--executors a[,b,...]` (plural, copied from `gate request`'s
// multi-executor flag), but the `list` verb's KNOWN_FLAGS only accepts
// `--executor` (singular — "match waves naming this one executor") and
// rejects `--executors` with "unknown flag". An agent copying the
// advertised flag from --help hit a wall. These pin the help line and
// the runtime to the same singular flag so they can't drift apart again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function run(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
}

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-list-help-'));
  writeFileSync(join(root, 'guild.config.yaml'), 'content_root: .\nhost_names: [eris]\n');
  mkdirSync(join(root, 'members'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('gate --help advertises the list filter as --executor (singular), not --executors', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = run(root, ['--help']);
    const listLine = stdout.split('\n');
    const i = listLine.findIndex((l) => l.includes('gate list --state'));
    assert.ok(i >= 0, 'gate list entry must appear in --help');
    // The wrapped continuation line carries the filter flags.
    const block = `${listLine[i]}\n${listLine[i + 1] ?? ''}`;
    assert.match(block, /--executor <m>/, 'list help must advertise --executor (singular)');
    assert.doesNotMatch(block, /--executors/, 'list help must not advertise --executors (plural) — list rejects it');
  } finally {
    cleanup();
  }
});

test('gate list accepts --executor and rejects --executors (runtime truth the help now matches)', () => {
  const { root, cleanup } = bootstrap();
  try {
    const ok = run(root, ['list', '--executor', 'bob'], { GUILD_ACTOR: 'eris' });
    assert.equal(ok.status, 0, ok.stderr);

    const bad = run(root, ['list', '--executors', 'bob'], { GUILD_ACTOR: 'eris' });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /unknown flag: --executors/);
  } finally {
    cleanup();
  }
});
