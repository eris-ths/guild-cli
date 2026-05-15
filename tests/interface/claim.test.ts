// `gate claim` — cross-session stake claim (issue #226 phase 1).
//
// MVP scope: claim verb only (witness deferred). Coverage:
//   - first-time claim writes (claimed_by, claimed_at) and persists
//   - same-actor re-claim is a no-op (idempotent, doesn't bump claimed_at)
//   - different actor → exit 1 with a clear conflict message
//   - non-(pending|approved) state → exit 1 (state guard)
//   - terminal transition (complete) auto-releases the claim
//   - claim-then-immediately-complete: auto-release fires even when
//     the claim was just stamped (the "almost done" race)
//   - hydrate tolerance: a record without claim fields loads as
//     unclaimed (claimed_by/claimed_at = null in JSON / absent in YAML)
//   - gate show text mode shows `claimed by: <a> at <ts>` line
//   - gate show json includes claimed_by/claimed_at fields

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
  const root = mkdtempSync(join(tmpdir(), 'guild-claim-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  mkdirSync(join(root, 'members'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function run(
  cwd: string,
  args: string[],
  actor?: string,
): { stdout: string; stderr: string; status: number } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (actor !== undefined) env['GUILD_ACTOR'] = actor;
  else delete env['GUILD_ACTOR'];
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env,
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

function registerAll(root: string, names: string[]): void {
  for (const n of names) {
    run(root, ['register', '--name', n]);
  }
}

function newRequest(root: string, from: string, executor?: string): string {
  const args = [
    'request',
    '--from',
    from,
    '--action',
    'do thing',
    '--reason',
    'because',
    '--format',
    'json',
  ];
  if (executor !== undefined) {
    args.push('--executors', executor);
  }
  const r = run(root, args);
  assert.equal(r.status, 0, `request failed: ${r.stderr}`);
  return (JSON.parse(r.stdout) as { id: string }).id;
}

test('gate claim: first-time stamps claimed_by + claimed_at', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia']);
  const id = newRequest(root, 'alice');

  const r = run(root, ['claim', id, '--by', 'leysia', '--format', 'json']);
  assert.equal(r.status, 0, `claim failed: ${r.stderr}`);
  const payload = JSON.parse(r.stdout) as Record<string, unknown>;
  assert.equal(payload['ok'], true);
  assert.equal(payload['id'], id);

  // Inspect the stored record via show.
  const show = run(root, ['show', id, '--format', 'json']);
  const j = JSON.parse(show.stdout) as Record<string, unknown>;
  assert.equal(j['claimed_by'], 'leysia');
  assert.equal(typeof j['claimed_at'], 'string');
  // ISO 8601 sanity (not pinning the value, just the shape).
  assert.match(String(j['claimed_at']), /^\d{4}-\d{2}-\d{2}T/);
});

test('gate claim: same-actor re-claim is a no-op (idempotent, claimed_at unchanged)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia']);
  const id = newRequest(root, 'alice');

  const first = run(root, ['claim', id, '--by', 'leysia', '--format', 'json']);
  assert.equal(first.status, 0);
  const showFirst = run(root, ['show', id, '--format', 'json']);
  const claimedAtFirst = (JSON.parse(showFirst.stdout) as Record<string, unknown>)['claimed_at'];

  // Re-run the same claim from the same actor.
  const second = run(root, ['claim', id, '--by', 'leysia', '--format', 'text']);
  assert.equal(second.status, 0, `re-claim failed: ${second.stderr}`);
  assert.match(second.stdout, /already claimed/);

  const showSecond = run(root, ['show', id, '--format', 'json']);
  const claimedAtSecond = (JSON.parse(showSecond.stdout) as Record<string, unknown>)['claimed_at'];
  assert.equal(
    claimedAtSecond,
    claimedAtFirst,
    'claimed_at should NOT bump on a same-actor re-claim',
  );
});

test('gate claim: different actor on already-claimed → exit 1, conflict message', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia', 'miki']);
  const id = newRequest(root, 'alice');

  const ok = run(root, ['claim', id, '--by', 'leysia']);
  assert.equal(ok.status, 0);

  const conflict = run(root, ['claim', id, '--by', 'miki']);
  assert.equal(conflict.status, 1);
  assert.match(conflict.stderr, /already claimed by leysia/);
});

test('gate claim: refuses on executing state (state guard)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia']);
  const id = newRequest(root, 'alice', 'leysia');
  // pending → approved → executing
  assert.equal(run(root, ['approve', id, '--by', 'eris']).status, 0);
  assert.equal(run(root, ['execute', id, '--by', 'leysia']).status, 0);

  const r = run(root, ['claim', id, '--by', 'leysia']);
  assert.equal(r.status, 1, 'claim on executing should refuse');
  assert.match(
    r.stderr,
    /Cannot claim a request in state "executing"/,
    `expected state-guard message, got: ${r.stderr}`,
  );
});

test('gate claim: complete transition auto-releases the claim', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia']);
  const id = newRequest(root, 'alice', 'leysia');

  // Claim while pending, then walk pending → approved → executing →
  // completed. The claim should survive approve+execute (still mine
  // through the work) and disappear on complete.
  assert.equal(run(root, ['claim', id, '--by', 'leysia']).status, 0);
  assert.equal(run(root, ['approve', id, '--by', 'eris']).status, 0);

  // Mid-flow check: claim is still recorded after approve.
  const midJson = run(root, ['show', id, '--format', 'json']);
  const mid = JSON.parse(midJson.stdout) as Record<string, unknown>;
  assert.equal(mid['claimed_by'], 'leysia', 'claim should survive approve');

  assert.equal(run(root, ['execute', id, '--by', 'leysia']).status, 0);
  assert.equal(run(root, ['complete', id, '--by', 'leysia', '--note', 'done']).status, 0);

  const after = run(root, ['show', id, '--format', 'json']);
  const j = JSON.parse(after.stdout) as Record<string, unknown>;
  assert.equal(j['claimed_by'], undefined, 'claimed_by should be cleared on complete');
  assert.equal(j['claimed_at'], undefined, 'claimed_at should be cleared on complete');
});

test('gate claim: stake-then-immediately-complete edge — auto-release still fires', (t) => {
  // Edge case requested by the wave brief: a session claims right
  // before completing (the "I almost forgot" race). Verifies the
  // auto-release timing works even when claim and complete are
  // back-to-back.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia']);
  const id = newRequest(root, 'alice', 'leysia');
  assert.equal(run(root, ['approve', id, '--by', 'eris']).status, 0);
  assert.equal(run(root, ['execute', id, '--by', 'leysia']).status, 0);

  // Claim is refused on executing (state guard) — so the natural
  // "stake right before complete" sequence is: claim while approved,
  // execute, complete. We exercise that path explicitly.
  const id2 = newRequest(root, 'alice', 'leysia');
  assert.equal(run(root, ['approve', id2, '--by', 'eris']).status, 0);
  assert.equal(run(root, ['claim', id2, '--by', 'leysia']).status, 0);
  // immediately walk through to complete
  assert.equal(run(root, ['execute', id2, '--by', 'leysia']).status, 0);
  assert.equal(run(root, ['complete', id2, '--by', 'leysia']).status, 0);

  const j = JSON.parse(run(root, ['show', id2, '--format', 'json']).stdout) as Record<string, unknown>;
  assert.equal(j['claimed_by'], undefined);
  assert.equal(j['claimed_at'], undefined);
});

test('gate claim: deny transition also auto-releases', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia']);
  const id = newRequest(root, 'alice');
  assert.equal(run(root, ['claim', id, '--by', 'leysia']).status, 0);
  assert.equal(run(root, ['deny', id, '--by', 'eris', '--reason', 'no']).status, 0);

  const j = JSON.parse(run(root, ['show', id, '--format', 'json']).stdout) as Record<string, unknown>;
  assert.equal(j['claimed_by'], undefined);
});

test('gate show text: claimed-by line surfaces below the state log', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia']);
  const id = newRequest(root, 'alice');
  assert.equal(run(root, ['claim', id, '--by', 'leysia']).status, 0);

  const r = run(root, ['show', id, '--format', 'text']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /claimed by: leysia at \d{4}-\d{2}-\d{2}T/);
  // Sanity: the line lives within / immediately after the status_log
  // block, not at the top of the record.
  const idxLog = r.stdout.indexOf('status_log');
  const idxClaim = r.stdout.indexOf('claimed by:');
  assert.ok(idxLog >= 0 && idxClaim > idxLog, 'claimed-by line should appear after status_log');
});

test('hydrate tolerance: legacy record (no claim fields) loads as unclaimed', (t) => {
  // Forge a YAML record with no claimed_by / claimed_at — exactly the
  // shape every pre-#226 record has. The repo must hydrate this
  // without error and `gate show --format json` must report the
  // claim fields as absent (effectively null) rather than throwing.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice']);
  const dir = join(root, 'requests', 'pending');
  mkdirSync(dir, { recursive: true });
  const legacy = `id: 2026-01-01-001
from: alice
action: legacy
reason: pre-claim record
state: pending
created_at: '2026-01-01T00:00:00.000Z'
status_log:
  - state: pending
    by: alice
    at: '2026-01-01T00:00:00.000Z'
    note: created
reviews: []
`;
  writeFileSync(join(dir, '2026-01-01-001.yaml'), legacy);

  const show = run(root, ['show', '2026-01-01-001', '--format', 'json']);
  assert.equal(show.status, 0, `show on legacy failed: ${show.stderr}`);
  const j = JSON.parse(show.stdout) as Record<string, unknown>;
  assert.equal(j['claimed_by'], undefined);
  assert.equal(j['claimed_at'], undefined);

  // And it can still be claimed afterwards (proves the legacy path
  // doesn't corrupt the record on the next save).
  registerAll(root, ['leysia']);
  const c = run(root, ['claim', '2026-01-01-001', '--by', 'leysia']);
  assert.equal(c.status, 0, `claim on legacy failed: ${c.stderr}`);
  // YAML on disk now carries the new fields.
  const yaml = readFileSync(join(dir, '2026-01-01-001.yaml'), 'utf8');
  assert.match(yaml, /claimed_by: leysia/);
  assert.match(yaml, /claimed_at:/);
});

test('byte-stable: unclaimed YAML omits the field (round-trip clean)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice']);
  const id = newRequest(root, 'alice');
  // Locate the file and verify it has neither claimed_by nor claimed_at.
  const dir = join(root, 'requests', 'pending');
  const yaml = readFileSync(join(dir, `${id}.yaml`), 'utf8');
  assert.doesNotMatch(yaml, /claimed_by/);
  assert.doesNotMatch(yaml, /claimed_at/);
});
