// gate boot — ladder thickening surfaces (lore_stats + alternative
// next steps in text mode).
//
// What this test pins:
//   1. `lore_stats` is present in JSON, shape { available, principles,
//      traps }, with non-zero counts when run against the real
//      package-shipped lore directory.
//   2. Text mode renders a `lore: <N> principles, <M> traps  (gate
//      lore list)` line below `queues:`.
//   3. When a registered actor has multiple actionable transitions,
//      text mode renders up to two `→ or: gate <verb> <id>` lines
//      beneath `→ next:` — the alternative ladder.
//   4. The primary suggestion is NOT duplicated in the ladder (filter
//      on verb + id matches the suggested_next).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = makeTempRoot('guild-boot-ladder-');
  // Host-only actor (eris) sits in host_names but NOT in members,
  // so role resolves to 'host' (not 'member') and approve becomes
  // actionable for pending requests. alice/bob are the executors.
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, d));
  }
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  writeFileSync(
    join(root, 'members', 'bob.yaml'),
    'name: bob\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

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
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? -1 };
}

test('boot JSON carries lore_stats with non-zero counts (package lore is present)', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = run(root, ['boot']);
    assert.equal(r.status, 0, r.stderr);
    const payload = JSON.parse(r.stdout);
    assert.ok(payload.lore_stats, 'lore_stats missing from payload');
    assert.equal(payload.lore_stats.available, true);
    // Lower bound is intentional — the count grows as principles/
    // traps are added. Pinning an exact value would force this test
    // to update on every lore PR, defeating the purpose.
    assert.ok(
      payload.lore_stats.principles >= 10,
      `expected ≥10 principles, got ${payload.lore_stats.principles}`,
    );
    assert.ok(
      payload.lore_stats.traps >= 1,
      `expected ≥1 trap, got ${payload.lore_stats.traps}`,
    );
  } finally {
    cleanup();
  }
});

test('boot text renders the lore line below queues with the gate lore list hint', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = run(root, ['boot', '--format', 'text']);
    assert.equal(r.status, 0, r.stderr);
    // Order matters: lore line must follow the queues line, not
    // float somewhere else in the payload. Use a regex anchored on
    // both so the relative position is pinned.
    assert.match(
      r.stdout,
      /queues:.*\nlore: \d+ principles, \d+ traps  \(gate lore list\)/,
    );
  } finally {
    cleanup();
  }
});

test('boot text shows alternative ladder when actor has multiple actionable transitions', () => {
  const { root, cleanup } = bootstrap();
  try {
    // Build state where alice has 2+ approved-for-me actionables.
    // Each request is filed by alice with alice as executor, then
    // approved by host eris. After approval, alice's actionable
    // list carries one entry per approved-for-me — the primary
    // suggestion picks one, the ladder must surface at least one
    // alternative.
    const ids: string[] = [];
    for (const i of [1, 2, 3]) {
      const r = run(
        root,
        [
          'request',
          '--action',
          `task-${i}`,
          '--reason',
          'test',
          '--executors',
          'alice',
          '--from',
          'alice',
          '--target',
          `t-${i}`,
          '--format',
          'json',
        ],
        { GUILD_ACTOR: 'alice' },
      );
      const id = JSON.parse(r.stdout).id;
      ids.push(id);
    }
    // Host approves each so alice's queue holds 3 approved-for-me.
    for (const id of ids) {
      run(root, ['approve', id, '--by', 'eris'], { GUILD_ACTOR: 'eris' });
    }
    const r = run(root, ['boot', '--format', 'text'], { GUILD_ACTOR: 'alice' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^→ next: gate /m);
    assert.match(r.stdout, /^→ or:   gate /m);
  } finally {
    cleanup();
  }
});

test('alternative ladder does not echo the primary suggestion', () => {
  const { root, cleanup } = bootstrap();
  try {
    const ids: string[] = [];
    for (const i of [1, 2]) {
      const r = run(
        root,
        [
          'request',
          '--action',
          `task-${i}`,
          '--reason',
          'test',
          '--executors',
          'alice',
          '--from',
          'alice',
          '--target',
          `t-${i}`,
          '--format',
          'json',
        ],
        { GUILD_ACTOR: 'alice' },
      );
      ids.push(JSON.parse(r.stdout).id);
    }
    for (const id of ids) {
      run(root, ['approve', id, '--by', 'eris'], { GUILD_ACTOR: 'eris' });
    }
    const r = run(root, ['boot', '--format', 'text'], { GUILD_ACTOR: 'alice' });
    assert.equal(r.status, 0, r.stderr);
    // Extract the id named on the `→ next:` line and assert that
    // exact id never appears on a `→ or:` line. Without the dedup,
    // the primary would render twice (the catalog still lists it
    // among the actionable set).
    const nextMatch = r.stdout.match(/^→ next: gate \w+ ([0-9-]+)/m);
    if (nextMatch) {
      const primaryId = nextMatch[1];
      const orLines = r.stdout
        .split('\n')
        .filter((l) => l.startsWith('→ or:'));
      for (const line of orLines) {
        assert.ok(
          !line.includes(primaryId!),
          `ladder echoed primary id ${primaryId}: ${line}`,
        );
      }
    }
  } finally {
    cleanup();
  }
});
