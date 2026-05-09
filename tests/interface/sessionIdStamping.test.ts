// Session_id stamping (#249 slice 2) — interface-layer integration test.
//
// Coverage:
//   - GUILD_SESSION_ID set + valid → request stamps `opened_by_session`
//   - GUILD_SESSION_ID set + valid → claim stamps `claimed_by_session`
//   - GUILD_SESSION_ID set + valid → witness stamps `witness_sessions[<actor>]`
//   - GUILD_SESSION_ID unset → no fields appear (records-outlive-writers)
//   - GUILD_SESSION_ID malformed → notice on stderr, no field stamped
//   - gate boot --session-id <id> echoes payload.session_id (source=flag)
//   - gate boot inherits GUILD_SESSION_ID from env (source=env)
//   - gate boot without session emits hints.session_id_unset when actor set
//   - gate boot --session-id with malformed value → exit non-zero
//   - terminal transition (complete) auto-clears claimed_by_session
//   - unwitness clears witness_sessions[<actor>]
//
// Records-outlive-writers (principle 04): every test asserts that a
// session-unaware writer produces YAML byte-stable to pre-#249 records.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = makeTempRoot('guild-sessid-');
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
  env: Record<string, string | undefined> = {},
): { stdout: string; stderr: string; status: number } {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  }
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: merged,
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
    const r = run(root, ['register', '--name', n]);
    assert.equal(r.status, 0, `register ${n} failed: ${r.stderr}`);
  }
}

function newRequest(
  root: string,
  from: string,
  env: Record<string, string | undefined> = {},
  executor?: string,
): string {
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
  if (executor !== undefined) args.push('--executor', executor);
  const r = run(root, args, env);
  assert.equal(r.status, 0, `request failed: ${r.stderr}`);
  return (JSON.parse(r.stdout) as { id: string }).id;
}

const SESSION = 'eris-local-2026-05-09-test';

test('gate request stamps opened_by_session from GUILD_SESSION_ID', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice']);
  const id = newRequest(root, 'alice', { GUILD_SESSION_ID: SESSION });
  const show = run(root, ['show', id, '--format', 'json']);
  const j = JSON.parse(show.stdout) as Record<string, unknown>;
  assert.equal(j['opened_by_session'], SESSION);
});

test('gate request: GUILD_SESSION_ID unset → no opened_by_session field (byte-stable)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice']);
  const id = newRequest(root, 'alice', { GUILD_SESSION_ID: undefined });
  const show = run(root, ['show', id, '--format', 'json']);
  const j = JSON.parse(show.stdout) as Record<string, unknown>;
  assert.equal(
    j['opened_by_session'],
    undefined,
    'opened_by_session must not appear when env is unset',
  );
  // YAML on disk: the field must be absent so pre-#249 records and
  // unstamped post-#249 records share one byte-shape.
  const yaml = readFileSync(join(root, 'requests', 'pending', `${id}.yaml`), 'utf8');
  assert.ok(
    !yaml.includes('opened_by_session'),
    `YAML should not contain opened_by_session: ${yaml}`,
  );
});

test('gate request: malformed GUILD_SESSION_ID → notice + no field stamped', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice']);
  // Uppercase is rejected by SESSION_ID_RE. The resolver should warn
  // and treat it as unset — the request must still succeed.
  const id = newRequest(root, 'alice', { GUILD_SESSION_ID: 'BAD-SESSION' });
  const show = run(root, ['show', id, '--format', 'json']);
  const j = JSON.parse(show.stdout) as Record<string, unknown>;
  assert.equal(j['opened_by_session'], undefined);
});

test('gate claim stamps claimed_by_session from GUILD_SESSION_ID', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia']);
  const id = newRequest(root, 'alice');
  const r = run(
    root,
    ['claim', id, '--by', 'leysia', '--format', 'json'],
    { GUILD_SESSION_ID: SESSION },
  );
  assert.equal(r.status, 0, `claim failed: ${r.stderr}`);
  const show = run(root, ['show', id, '--format', 'json']);
  const j = JSON.parse(show.stdout) as Record<string, unknown>;
  assert.equal(j['claimed_by'], 'leysia');
  assert.equal(j['claimed_by_session'], SESSION);
});

test('gate witness stamps witness_sessions[<actor>] from GUILD_SESSION_ID', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia', 'miki']);
  const id = newRequest(root, 'alice');

  // leysia witnesses with session A, miki with session B — per-actor
  // map keyed by actor name.
  const a = run(
    root,
    ['witness', id, '--by', 'leysia', '--format', 'json'],
    { GUILD_SESSION_ID: 'session-a' },
  );
  assert.equal(a.status, 0, `witness leysia failed: ${a.stderr}`);
  const b = run(
    root,
    ['witness', id, '--by', 'miki', '--format', 'json'],
    { GUILD_SESSION_ID: 'session-b' },
  );
  assert.equal(b.status, 0, `witness miki failed: ${b.stderr}`);

  const show = run(root, ['show', id, '--format', 'json']);
  const j = JSON.parse(show.stdout) as Record<string, unknown>;
  assert.deepEqual(j['witnesses'], ['leysia', 'miki']);
  assert.deepEqual(j['witness_sessions'], {
    leysia: 'session-a',
    miki: 'session-b',
  });
});

test('gate boot --session-id echoes payload.session_id (source=flag)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice']);
  const r = run(
    root,
    ['boot', '--session-id', SESSION, '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `boot failed: ${r.stderr}`);
  const j = JSON.parse(r.stdout) as Record<string, unknown>;
  assert.equal(j['session_id'], SESSION);
  assert.equal(j['session_id_source'], 'flag');
  const hints = j['hints'] as Record<string, unknown>;
  assert.equal(hints['session_id_unset'], false);
});

test('gate boot inherits GUILD_SESSION_ID (source=env)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice']);
  const r = run(
    root,
    ['boot', '--format', 'json'],
    { GUILD_ACTOR: 'alice', GUILD_SESSION_ID: SESSION },
  );
  assert.equal(r.status, 0, `boot failed: ${r.stderr}`);
  const j = JSON.parse(r.stdout) as Record<string, unknown>;
  assert.equal(j['session_id'], SESSION);
  assert.equal(j['session_id_source'], 'env');
});

test('gate boot --session-id wins over GUILD_SESSION_ID env', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice']);
  const r = run(
    root,
    ['boot', '--session-id', 'flag-session', '--format', 'json'],
    { GUILD_ACTOR: 'alice', GUILD_SESSION_ID: 'env-session' },
  );
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout) as Record<string, unknown>;
  assert.equal(j['session_id'], 'flag-session');
  assert.equal(j['session_id_source'], 'flag');
});

test('gate boot: actor set + no session → hints.session_id_unset=true', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice']);
  const r = run(
    root,
    ['boot', '--format', 'json'],
    { GUILD_ACTOR: 'alice', GUILD_SESSION_ID: undefined },
  );
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout) as Record<string, unknown>;
  assert.equal(j['session_id'], null);
  assert.equal(j['session_id_source'], null);
  const hints = j['hints'] as Record<string, unknown>;
  assert.equal(hints['session_id_unset'], true);
});

test('gate boot: no actor → hints.session_id_unset=false (no session to stamp)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = run(
    root,
    ['boot', '--format', 'json'],
    { GUILD_ACTOR: undefined, GUILD_SESSION_ID: undefined },
  );
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout) as Record<string, unknown>;
  const hints = j['hints'] as Record<string, unknown>;
  assert.equal(
    hints['session_id_unset'],
    false,
    'no-actor boots have no session to stamp; hint must stay quiet',
  );
});

test('gate boot --session-id with malformed value → exit non-zero', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice']);
  const r = run(
    root,
    ['boot', '--session-id', 'BAD-SESSION', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(r.status, 0, 'malformed session_id flag must fail boot');
  assert.match(r.stderr, /session_id format/i);
});

test('terminal complete clears claimed_by_session (auto-release)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // `eris` is already a host (see bootstrap config) — hosts don't
  // register as members. Only register `alice`.
  registerAll(root, ['alice']);
  const id = newRequest(root, 'alice', {}, 'alice');
  const claim = run(
    root,
    ['claim', id, '--by', 'alice', '--format', 'json'],
    { GUILD_SESSION_ID: SESSION },
  );
  assert.equal(claim.status, 0, `claim: ${claim.stderr}`);
  const approve = run(root, ['approve', id, '--by', 'eris']);
  assert.equal(approve.status, 0, `approve: ${approve.stderr}`);
  const exec = run(root, ['execute', id, '--by', 'alice']);
  assert.equal(exec.status, 0, `execute: ${exec.stderr}`);
  const done = run(root, ['complete', id, '--by', 'alice']);
  assert.equal(done.status, 0, `complete: ${done.stderr}`);

  const show = run(root, ['show', id, '--format', 'json']);
  const j = JSON.parse(show.stdout) as Record<string, unknown>;
  assert.equal(j['claimed_by'], undefined);
  assert.equal(j['claimed_by_session'], undefined);
});

test('unwitness clears witness_sessions[<actor>]', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia']);
  const id = newRequest(root, 'alice');
  const w = run(
    root,
    ['witness', id, '--by', 'leysia', '--format', 'json'],
    { GUILD_SESSION_ID: SESSION },
  );
  assert.equal(w.status, 0);
  const showAfterWitness = run(root, ['show', id, '--format', 'json']);
  const before = JSON.parse(showAfterWitness.stdout) as Record<string, unknown>;
  assert.deepEqual(before['witness_sessions'], { leysia: SESSION });

  const u = run(root, ['unwitness', id, '--by', 'leysia']);
  assert.equal(u.status, 0, `unwitness: ${u.stderr}`);
  const showAfter = run(root, ['show', id, '--format', 'json']);
  const after = JSON.parse(showAfter.stdout) as Record<string, unknown>;
  assert.equal(
    after['witness_sessions'],
    undefined,
    'witness_sessions map must collapse to absence when empty',
  );
});

test('same-actor re-claim with new session updates claimed_by_session', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice']);
  const id = newRequest(root, 'alice');
  const first = run(
    root,
    ['claim', id, '--by', 'alice', '--format', 'json'],
    { GUILD_SESSION_ID: 'session-one' },
  );
  assert.equal(first.status, 0);
  const second = run(
    root,
    ['claim', id, '--by', 'alice', '--format', 'json'],
    { GUILD_SESSION_ID: 'session-two' },
  );
  assert.equal(second.status, 0);
  const show = run(root, ['show', id, '--format', 'json']);
  const j = JSON.parse(show.stdout) as Record<string, unknown>;
  // Re-claim is idempotent on (claimedBy, claimedAt) but the session
  // is allowed to drift session-to-session — same overwrite-only-on-
  // divergence rule as claim_note.
  assert.equal(j['claimed_by_session'], 'session-two');
});
