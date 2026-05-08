// `gate witness` / `gate unwitness` — non-exclusive cross-session
// observer (issue #244 / #226 phase 2). Sibling verb to claim
// (phase 1): claim is exclusive, witness is plural.
//
// Coverage:
//   - first-time witness appends actor; multiple sequential witnesses
//     preserve registration order (true-concurrency in
//     witnessConcurrency.test.ts)
//   - re-witness by same actor is a no-op (idempotent, no duplicate)
//   - witness coexists with a claim (same actor or different actor)
//   - claim coexists with witnesses by other actors (witness doesn't
//     conflict)
//   - unwitness removes the caller's own witness (and only theirs)
//   - unwitness for an actor not in the list → refuse
//   - witness on terminal states (completed / failed / denied) → refuse;
//     existing witnesses auto-reset on the terminal transition
//   - hydrate tolerance: a record without `witnesses` field loads as
//     unwitnessed
//   - gate show text mode shows `witnesses: a, b, c` line
//   - gate show json includes structured witnesses array
//   - byte-stable: empty witnesses YAML omits the field

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
  const root = mkdtempSync(join(tmpdir(), 'guild-witness-'));
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
    args.push('--executor', executor);
  }
  const r = run(root, args);
  assert.equal(r.status, 0, `request failed: ${r.stderr}`);
  return (JSON.parse(r.stdout) as { id: string }).id;
}

function readShowJson(
  root: string,
  id: string,
): Record<string, unknown> {
  const r = run(root, ['show', id, '--format', 'json']);
  assert.equal(r.status, 0, `show failed: ${r.stderr}`);
  return JSON.parse(r.stdout) as Record<string, unknown>;
}

test('gate witness: first-time stamps witnesses array', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia']);
  const id = newRequest(root, 'alice');

  const r = run(root, ['witness', id, '--by', 'leysia', '--format', 'json']);
  assert.equal(r.status, 0, `witness failed: ${r.stderr}`);
  const payload = JSON.parse(r.stdout) as Record<string, unknown>;
  assert.equal(payload['ok'], true);
  assert.equal(payload['id'], id);

  const j = readShowJson(root, id);
  assert.deepEqual(j['witnesses'], ['leysia']);
});

// NOTE: this test was previously titled "in parallel" but the calls
// are sequential (spawnSync is blocking). The misleading name was
// flagged in the #244 Devil REJECT — true-concurrency coverage now
// lives in `witnessConcurrency.test.ts`. This test stays as the
// "registration order is preserved across multiple sequential
// witnesses" canary.
test('gate witness: multiple sequential witnesses preserve registration order', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia', 'miki', 'yuki']);
  const id = newRequest(root, 'alice');

  // Register in a deliberate order; the array must preserve it.
  assert.equal(run(root, ['witness', id, '--by', 'leysia']).status, 0);
  assert.equal(run(root, ['witness', id, '--by', 'miki']).status, 0);
  assert.equal(run(root, ['witness', id, '--by', 'yuki']).status, 0);

  const j = readShowJson(root, id);
  assert.deepEqual(j['witnesses'], ['leysia', 'miki', 'yuki']);
});

test('gate witness: re-witness by same actor is a no-op (no duplicate)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia', 'miki']);
  const id = newRequest(root, 'alice');

  assert.equal(run(root, ['witness', id, '--by', 'leysia']).status, 0);
  assert.equal(run(root, ['witness', id, '--by', 'miki']).status, 0);

  const second = run(root, ['witness', id, '--by', 'leysia', '--format', 'text']);
  assert.equal(second.status, 0);
  assert.match(second.stdout, /already witnessing/);

  const j = readShowJson(root, id);
  assert.deepEqual(
    j['witnesses'],
    ['leysia', 'miki'],
    'order preserved, no duplicate',
  );
});

test('gate witness: coexists with a claim by the same actor', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia']);
  const id = newRequest(root, 'alice');

  assert.equal(run(root, ['claim', id, '--by', 'leysia']).status, 0);
  assert.equal(
    run(root, ['witness', id, '--by', 'leysia']).status,
    0,
    'witnessing your own claim should be allowed',
  );

  const j = readShowJson(root, id);
  assert.equal(j['claimed_by'], 'leysia');
  assert.deepEqual(j['witnesses'], ['leysia']);
});

test('gate witness: coexists with a claim by a different actor (no conflict)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia', 'miki']);
  const id = newRequest(root, 'alice');

  assert.equal(run(root, ['claim', id, '--by', 'leysia']).status, 0);
  // miki witnesses while leysia holds the claim — must NOT refuse.
  const r = run(root, ['witness', id, '--by', 'miki']);
  assert.equal(r.status, 0, `witness on claimed-by-other should succeed: ${r.stderr}`);

  const j = readShowJson(root, id);
  assert.equal(j['claimed_by'], 'leysia');
  assert.deepEqual(j['witnesses'], ['miki']);
});

test('gate witness: allowed on executing state (live race window)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia', 'miki']);
  const id = newRequest(root, 'alice', 'leysia');
  assert.equal(run(root, ['approve', id, '--by', 'eris']).status, 0);
  assert.equal(run(root, ['execute', id, '--by', 'leysia']).status, 0);

  // Witness while executing — claim refuses here, witness must accept.
  const r = run(root, ['witness', id, '--by', 'miki']);
  assert.equal(r.status, 0, `witness on executing should succeed: ${r.stderr}`);
  const j = readShowJson(root, id);
  assert.deepEqual(j['witnesses'], ['miki']);
});

test('gate witness: refuses on terminal state (completed) and auto-resets', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia', 'miki']);
  const id = newRequest(root, 'alice', 'leysia');

  // Witness while pending, then walk to completed. Witnesses should
  // auto-reset; a fresh witness on the terminal record should refuse.
  assert.equal(run(root, ['witness', id, '--by', 'miki']).status, 0);
  assert.equal(run(root, ['approve', id, '--by', 'eris']).status, 0);
  // Mid-flow: witness survives approve.
  let j = readShowJson(root, id);
  assert.deepEqual(j['witnesses'], ['miki']);

  assert.equal(run(root, ['execute', id, '--by', 'leysia']).status, 0);
  assert.equal(run(root, ['complete', id, '--by', 'leysia']).status, 0);

  j = readShowJson(root, id);
  assert.equal(j['witnesses'], undefined, 'witnesses should auto-reset on complete');

  const refuse = run(root, ['witness', id, '--by', 'leysia']);
  assert.equal(refuse.status, 1, 'witness on completed should refuse');
  assert.match(refuse.stderr, /Cannot witness a request in state "completed"/);
});

test('gate witness: deny / fail also auto-reset witnesses', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia', 'miki']);

  // deny path
  const idDeny = newRequest(root, 'alice');
  assert.equal(run(root, ['witness', idDeny, '--by', 'miki']).status, 0);
  assert.equal(run(root, ['deny', idDeny, '--by', 'eris', '--reason', 'no']).status, 0);
  assert.equal(readShowJson(root, idDeny)['witnesses'], undefined);

  // fail path
  const idFail = newRequest(root, 'alice', 'leysia');
  assert.equal(run(root, ['witness', idFail, '--by', 'miki']).status, 0);
  assert.equal(run(root, ['approve', idFail, '--by', 'eris']).status, 0);
  assert.equal(run(root, ['execute', idFail, '--by', 'leysia']).status, 0);
  assert.equal(run(root, ['fail', idFail, '--by', 'leysia', '--reason', 'oops']).status, 0);
  assert.equal(readShowJson(root, idFail)['witnesses'], undefined);
});

test('gate unwitness: caller removes their own witness', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia', 'miki', 'yuki']);
  const id = newRequest(root, 'alice');

  assert.equal(run(root, ['witness', id, '--by', 'leysia']).status, 0);
  assert.equal(run(root, ['witness', id, '--by', 'miki']).status, 0);
  assert.equal(run(root, ['witness', id, '--by', 'yuki']).status, 0);

  const r = run(root, ['unwitness', id, '--by', 'miki', '--format', 'text']);
  assert.equal(r.status, 0, `unwitness failed: ${r.stderr}`);
  assert.match(r.stdout, /unwitnessed/);

  const j = readShowJson(root, id);
  assert.deepEqual(
    j['witnesses'],
    ['leysia', 'yuki'],
    'only miki is removed, order preserved',
  );
});

test("gate unwitness: refuses to remove another actor's witness", (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia', 'miki']);
  const id = newRequest(root, 'alice');
  assert.equal(run(root, ['witness', id, '--by', 'leysia']).status, 0);

  // miki tries to unwitness leysia — but the verb only takes --by
  // (the caller). unwitness with --by leysia would only succeed if
  // miki *is* leysia. The semantics are: --by names the witness to
  // remove, which by design is the caller. Foreign-actor removal is
  // refused because miki is not in the witnesses list.
  const r = run(root, ['unwitness', id, '--by', 'miki']);
  assert.equal(r.status, 1, 'unwitness for non-witness should refuse');
  assert.match(r.stderr, /miki is not a witness/);

  // leysia is still witnessing
  const j = readShowJson(root, id);
  assert.deepEqual(j['witnesses'], ['leysia']);
});

test('gate unwitness: removing the last witness omits the field on disk', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia']);
  const id = newRequest(root, 'alice');

  assert.equal(run(root, ['witness', id, '--by', 'leysia']).status, 0);
  assert.equal(run(root, ['unwitness', id, '--by', 'leysia']).status, 0);

  const dir = join(root, 'requests', 'pending');
  const yaml = readFileSync(join(dir, `${id}.yaml`), 'utf8');
  assert.doesNotMatch(
    yaml,
    /witnesses/,
    'empty witnesses must not surface in YAML (byte-stable round-trip)',
  );
});

test('gate show text: witnesses line surfaces below the claim line', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia', 'miki']);
  const id = newRequest(root, 'alice');
  assert.equal(run(root, ['claim', id, '--by', 'leysia']).status, 0);
  assert.equal(run(root, ['witness', id, '--by', 'miki']).status, 0);

  const r = run(root, ['show', id, '--format', 'text']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /witnesses: miki/);

  const idxClaim = r.stdout.indexOf('claimed by:');
  const idxWit = r.stdout.indexOf('witnesses:');
  assert.ok(
    idxClaim >= 0 && idxWit > idxClaim,
    'witnesses line should appear after the claim line',
  );
});

test('gate show text: claim + witnesses render under a stake: sub-section, not inside status_log (#245)', (t) => {
  // Before #245 the lines were emitted at status_log's 4-space
  // entry indent, directly under `status_log (1):`. Read scans
  // saw "witnesses: ..." as a transition entry. The fix lifts
  // them into their own `stake:` subsection between status_log
  // and reviews. This test pins the new structural contract.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia', 'miki']);
  const id = newRequest(root, 'alice');
  assert.equal(run(root, ['claim', id, '--by', 'leysia']).status, 0);
  assert.equal(run(root, ['witness', id, '--by', 'miki']).status, 0);

  const r = run(root, ['show', id, '--format', 'text']);
  assert.equal(r.status, 0);

  // The `stake:` header exists, sits at section indent, and
  // appears after status_log but before its own line items.
  const idxLog = r.stdout.indexOf('status_log');
  const idxStake = r.stdout.indexOf('\n  stake:\n');
  const idxClaim = r.stdout.indexOf('claimed by:');
  const idxWit = r.stdout.indexOf('witnesses:');
  assert.ok(idxLog >= 0, 'status_log section is rendered');
  assert.ok(idxStake > idxLog, 'stake: header appears after status_log');
  assert.ok(idxClaim > idxStake, 'claimed by: line is inside stake: section');
  assert.ok(idxWit > idxClaim, 'witnesses: line follows claimed by: inside stake:');

  // The stake lines are at the section-item 4-space indent.
  assert.match(r.stdout, /\n {4}claimed by: leysia at /);
  assert.match(r.stdout, /\n {4}witnesses: miki\n/);
});

test('gate show text: unwitnessed record omits the witnesses line', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice']);
  const id = newRequest(root, 'alice');

  const r = run(root, ['show', id, '--format', 'text']);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /witnesses:/);
  // An unstaked record (no claim, no witnesses) emits no
  // `stake:` block at all. This is the (#245) fix's empty-case
  // contract — don't clutter every show with an empty header.
  assert.doesNotMatch(r.stdout, /\n  stake:\n/);
});

test('hydrate tolerance: legacy record (no witnesses field) loads as unwitnessed', (t) => {
  // Forge a YAML record with no witnesses field — the shape every
  // pre-#244 record carries. The repo must hydrate without error and
  // gate show JSON must report the field as absent.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice']);
  const dir = join(root, 'requests', 'pending');
  mkdirSync(dir, { recursive: true });
  const legacy = `id: 2026-01-01-001
from: alice
action: legacy
reason: pre-witness record
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

  const j = readShowJson(root, '2026-01-01-001');
  assert.equal(j['witnesses'], undefined);

  // And it can still be witnessed afterwards (proves the legacy path
  // doesn't corrupt the record on the next save).
  registerAll(root, ['leysia']);
  const w = run(root, ['witness', '2026-01-01-001', '--by', 'leysia']);
  assert.equal(w.status, 0, `witness on legacy failed: ${w.stderr}`);

  const yaml = readFileSync(join(dir, '2026-01-01-001.yaml'), 'utf8');
  assert.match(yaml, /witnesses:/);
  assert.match(yaml, /- leysia/);
});

test('byte-stable: unwitnessed YAML omits the field (round-trip clean)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice']);
  const id = newRequest(root, 'alice');
  const dir = join(root, 'requests', 'pending');
  const yaml = readFileSync(join(dir, `${id}.yaml`), 'utf8');
  assert.doesNotMatch(yaml, /witnesses/);
});

// Asteria finding A (#244 follow-up): hand-edited YAML with duplicate
// witnesses entries must be deduped on hydrate (the domain treats the
// array as a set ordered by first registration), and the migration
// must surface via onMalformed so it isn't silent. Without this fix,
// `unwitness` would have to be invoked twice to clear a duplicated
// entry, with the actor's name still visible on `show` between calls.
test('hydrate dedup: duplicate witnesses in YAML are collapsed and warned', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'asteria']);
  const dir = join(root, 'requests', 'pending');
  mkdirSync(dir, { recursive: true });
  const forged = `id: 2026-01-02-001
from: alice
action: dup test
reason: forged duplicates
state: pending
created_at: '2026-01-02T00:00:00.000Z'
status_log:
  - state: pending
    by: alice
    at: '2026-01-02T00:00:00.000Z'
    note: created
reviews: []
witnesses:
  - asteria
  - asteria
`;
  writeFileSync(join(dir, '2026-01-02-001.yaml'), forged);

  const r = run(root, ['show', '2026-01-02-001', '--format', 'json']);
  assert.equal(r.status, 0, `show failed: ${r.stderr}`);
  const j = JSON.parse(r.stdout) as Record<string, unknown>;
  assert.deepEqual(
    j['witnesses'],
    ['asteria'],
    'duplicate witnesses must be collapsed to first occurrence',
  );
  assert.match(
    r.stderr,
    /witnesses array contained 1 duplicate/,
    'dedup migration must surface via onMalformed (warn: ...)',
  );

  // And one unwitness call (not two) suffices to clear it.
  const u = run(root, ['unwitness', '2026-01-02-001', '--by', 'asteria']);
  assert.equal(u.status, 0, `unwitness failed: ${u.stderr}`);
  const j2 = readShowJson(root, '2026-01-02-001');
  assert.equal(j2['witnesses'], undefined, 'single unwitness should clear');
});

// Asteria finding B (#244 follow-up): a former witness running a
// defensive cleanup pass on a terminal record (where auto-reset has
// already cleared the list) needs a distinguishable error from the
// real typo case. The `is not a witness` text is reserved for the
// live-window states; terminal records get a "no action needed"
// explanation that names the auto-reset behavior.
test('unwitness on terminal: error message is auto-reset-aware', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia', 'miki']);
  const id = newRequest(root, 'alice', 'leysia');

  assert.equal(run(root, ['witness', id, '--by', 'miki']).status, 0);
  assert.equal(run(root, ['approve', id, '--by', 'eris']).status, 0);
  assert.equal(run(root, ['execute', id, '--by', 'leysia']).status, 0);
  assert.equal(run(root, ['complete', id, '--by', 'leysia']).status, 0);

  // miki, formerly a witness, runs cleanup on the (now completed)
  // record. Auto-reset has already cleared the list, so this is the
  // benign "nothing to do" path — message must say so.
  const r = run(root, ['unwitness', id, '--by', 'miki']);
  assert.equal(r.status, 1, 'unwitness on cleared list still throws');
  assert.match(
    r.stderr,
    /state=completed/,
    'terminal-aware error must name the state',
  );
  assert.match(
    r.stderr,
    /auto-released on terminal transitions/,
    'terminal-aware error must explain why nothing remains',
  );
  assert.match(
    r.stderr,
    /No action needed/,
    'terminal-aware error must signal the no-op intent',
  );
  // And it must NOT use the live-window typo phrasing.
  assert.doesNotMatch(
    r.stderr,
    /unwitness only removes the caller's own witness/,
    'live-window typo phrasing is reserved for non-terminal states',
  );
});

// Companion to finding B: the live-window states (pending/approved/
// executing) must still emit the original typo-oriented message — the
// terminal branch is additive, not a rewrite.
test('unwitness on live-window: error message is the typo-oriented form', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'leysia', 'miki']);

  // pending
  const idPending = newRequest(root, 'alice');
  let r = run(root, ['unwitness', idPending, '--by', 'miki']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unwitness only removes the caller's own witness/);
  assert.doesNotMatch(r.stderr, /auto-released on terminal/);

  // approved
  const idApproved = newRequest(root, 'alice', 'leysia');
  assert.equal(run(root, ['approve', idApproved, '--by', 'eris']).status, 0);
  r = run(root, ['unwitness', idApproved, '--by', 'miki']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unwitness only removes the caller's own witness/);
  assert.doesNotMatch(r.stderr, /auto-released on terminal/);

  // executing
  const idExecuting = newRequest(root, 'alice', 'leysia');
  assert.equal(run(root, ['approve', idExecuting, '--by', 'eris']).status, 0);
  assert.equal(run(root, ['execute', idExecuting, '--by', 'leysia']).status, 0);
  r = run(root, ['unwitness', idExecuting, '--by', 'miki']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unwitness only removes the caller's own witness/);
  assert.doesNotMatch(r.stderr, /auto-released on terminal/);
});
