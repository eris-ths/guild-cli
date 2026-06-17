// gate list --state <bogus>: the error enumerates the valid states.
//
// Bug-killing-flow target (issue i-2026-05-30-0001, root-caused in agora
// play invalid-state-hint): `gate list --state bogus` errored with a bare
// `Invalid state: bogus` and no valid set, while sibling unknown-flag
// errors DO list valid flags — an asymmetric touch-feel that violates the
// "error + recovery path" house style. The hint must be built at the
// interface boundary because only it knows the full CLI-valid set =
// REQUEST_STATES ∪ {all} ('all' is an interface sugar the domain rejects).

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
  const root = mkdtempSync(join(tmpdir(), 'guild-invalid-state-'));
  writeFileSync(join(root, 'guild.config.yaml'), 'content_root: .\nhost_names: [eris]\n');
  mkdirSync(join(root, 'members'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('gate list --state <bogus>: error enumerates the valid states + the all sugar', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = run(root, ['list', '--state', 'bogus'], { GUILD_ACTOR: 'eris' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /invalid --state 'bogus'/);
    // Every domain state must be named, plus the interface-only `all`.
    for (const s of ['pending', 'approved', 'executing', 'completed', 'failed', 'denied', 'all']) {
      assert.match(r.stderr, new RegExp(`\\b${s}\\b`), `valid-states hint must name '${s}'`);
    }
  } finally {
    cleanup();
  }
});

test('gate list: valid states (and the all sugar, and the default) still work', () => {
  const { root, cleanup } = bootstrap();
  try {
    for (const args of [['list', '--state', 'pending'], ['list', '--state', 'all'], ['list']]) {
      const r = run(root, args, { GUILD_ACTOR: 'eris' });
      assert.equal(r.status, 0, `${args.join(' ')} should succeed; got: ${r.stderr}`);
    }
  } finally {
    cleanup();
  }
});
