// gate pending: filter-flag surface ↔ docs alignment.
//
// docs/verbs.md once lumped `gate list` and `gate pending` together as
// accepting `--from / --executor / --auto-review / --for`, but `pending`
// is the lean "--for me" shortcut — its KNOWN_FLAGS is {for, format}, and
// it rejects the richer filters that `gate list` accepts. The docs audit
// (#426) and the list help fix (#427) both reasoned about `list` in
// isolation and missed this (surfaced via a two-persona review). These
// pin pending's actual flag surface AND the redirect that points a
// would-be filterer at the capable verb (`gate list --state pending`).

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
  const root = mkdtempSync(join(tmpdir(), 'guild-pending-flags-'));
  writeFileSync(join(root, 'guild.config.yaml'), 'content_root: .\nhost_names: [eris]\n');
  mkdirSync(join(root, 'members'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('gate pending accepts --for and --format (its lean filter surface)', () => {
  const { root, cleanup } = bootstrap();
  try {
    assert.equal(run(root, ['pending', '--for', 'eris'], { GUILD_ACTOR: 'eris' }).status, 0);
    assert.equal(run(root, ['pending', '--format', 'json'], { GUILD_ACTOR: 'eris' }).status, 0);
  } finally {
    cleanup();
  }
});

test('gate pending rejects the richer filters (--executor / --from / --auto-review) it never accepted', () => {
  const { root, cleanup } = bootstrap();
  try {
    for (const flag of ['--executor', '--from', '--auto-review']) {
      const r = run(root, ['pending', flag, 'bob'], { GUILD_ACTOR: 'eris' });
      assert.notEqual(r.status, 0, `pending ${flag} should be rejected`);
      assert.match(r.stderr, new RegExp(`unknown flag: ${flag}`));
    }
  } finally {
    cleanup();
  }
});

test('gate pending unknown-filter error redirects to the capable verb (gate list --state pending)', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = run(root, ['pending', '--executor', 'bob'], { GUILD_ACTOR: 'eris' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /valid flags for 'pending': --for, --format/);
    assert.match(r.stderr, /gate list --state pending/);
  } finally {
    cleanup();
  }
});

test('gate list (the capable verb) still accepts the richer filters', () => {
  const { root, cleanup } = bootstrap();
  try {
    for (const flag of ['--executor', '--from', '--auto-review']) {
      const r = run(root, ['list', '--state', 'pending', flag, 'bob'], { GUILD_ACTOR: 'eris' });
      assert.equal(r.status, 0, `list ${flag} should be accepted; got: ${r.stderr}`);
    }
    // ...and list's unknown-flag error is NOT given the pending redirect.
    const bad = run(root, ['list', '--bogus'], { GUILD_ACTOR: 'eris' });
    assert.notEqual(bad.status, 0);
    assert.doesNotMatch(bad.stderr, /gate list --state pending/);
  } finally {
    cleanup();
  }
});
