// Multi-executor read-side coverage (issue #230 — Devil review blocker 1).
//
// The first-pass implementation kept a `r.executor` scalar getter that
// returned executors[0]. Seven read sites consumed it as if "the"
// executor were a singleton, silently dropping every later-listed
// executor. That regenerated substrate-experiment 6's attribution
// race at the agent-loop layer: `--executors miki,leysia` would
// surface to miki and never to leysia.
//
// Each test in this file exercises ONE of those sites with a wave
// where the SECOND-LISTED executor (leysia) is the actor. If the read
// path is still scalar-shaped, leysia gets nothing back — the test
// fails. Bound to leysia rather than miki on purpose: a regression
// to first-of-list reads would still pass for miki and silently
// reintroduce the bug.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-multi-read-'));
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

function setupApprovedRequest(root: string): string {
  // Authors: alice files; eris (host) approves; executors: miki, leysia.
  for (const n of ['alice', 'miki', 'leysia']) {
    run(root, ['register', '--name', n]);
  }
  const r = run(
    root,
    [
      'request',
      '--from',
      'alice',
      '--action',
      'parallel impl',
      '--reason',
      'wave',
      '--executors',
      'miki,leysia',
      '--format',
      'json',
    ],
    'alice',
  );
  assert.equal(r.status, 0, `request failed: ${r.stderr}`);
  const id = (JSON.parse(r.stdout) as { id: string }).id;
  const approve = run(root, ['approve', id], 'eris');
  assert.equal(approve.status, 0, `approve failed: ${approve.stderr}`);
  return id;
}

// ── boot / suggest (boot.ts:actionableTransitions) ───────────────

test('gate boot: leysia (second-listed executor) sees the approved request as actionable', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = setupApprovedRequest(root);

  const r = run(root, ['boot', '--format', 'json'], 'leysia');
  assert.equal(r.status, 0, `boot failed: ${r.stderr}`);
  const payload = JSON.parse(r.stdout) as Record<string, unknown>;
  // `actionable.execute` (or equivalent) should mention the request
  // for leysia. We don't pin the exact key shape — just that the id
  // surfaces somewhere in the leysia-actor view.
  const serialized = JSON.stringify(payload);
  assert.ok(
    serialized.includes(id),
    `leysia's boot payload should reference ${id} but did not: ${serialized}`,
  );
});

test('gate boot: miki (first-listed executor) also sees the approved request — symmetry', (t) => {
  // Sanity peer to the leysia test above. If first-of-list reads
  // crept back into the codebase miki would still see the request
  // and ONLY leysia would lose it; pinning miki here documents the
  // expected symmetry so a reader knows the leysia case isn't a
  // weird artefact of "second" being special.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = setupApprovedRequest(root);

  const r = run(root, ['boot', '--format', 'json'], 'miki');
  assert.equal(r.status, 0, `boot failed: ${r.stderr}`);
  assert.ok(JSON.stringify(JSON.parse(r.stdout)).includes(id));
});

// ── resume (resume.ts: awaiting_execution / executing) ───────────

test('gate resume: leysia sees awaiting_execution loop', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = setupApprovedRequest(root);

  const r = run(root, ['resume', '--format', 'json'], 'leysia');
  assert.equal(r.status, 0, `resume failed: ${r.stderr}`);
  const text = JSON.stringify(JSON.parse(r.stdout));
  assert.ok(text.includes(id));
  assert.match(text, /awaiting_execution/);
});

// ── status (status.ts: as_executor / awaiting_execution / by_actor) ─

test('gate status: leysia counts +1 in approved.awaiting_execution', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  setupApprovedRequest(root);

  const r = run(root, ['status', '--format', 'json'], 'leysia');
  assert.equal(r.status, 0, `status failed: ${r.stderr}`);
  const payload = JSON.parse(r.stdout) as {
    approved?: { awaiting_execution?: number };
  };
  assert.equal(
    payload.approved?.awaiting_execution,
    1,
    'leysia should count the request as awaiting her execution; ' +
      'first-of-list reads would have reported 0 here',
  );
});

// ── writeFormat (writeFormat.ts: suggested_next.by) ──────────────

test('gate approve --format json: suggested_next omits `by` for multi-executor (option b)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Re-create to keep test independent of approval state.
  for (const n of ['alice', 'miki', 'leysia']) {
    run(root, ['register', '--name', n]);
  }
  const created = run(
    root,
    [
      'request',
      '--from',
      'alice',
      '--action',
      'wave',
      '--reason',
      'r',
      '--executors',
      'miki,leysia',
      '--format',
      'json',
    ],
    'alice',
  );
  assert.equal(created.status, 0);
  const id = (JSON.parse(created.stdout) as { id: string }).id;

  const approve = run(root, ['approve', id, '--format', 'json'], 'eris');
  assert.equal(approve.status, 0);
  const payload = JSON.parse(approve.stdout) as {
    suggested_next?: { args?: { by?: string }; reason?: string };
  };
  // suggested_next must NOT pre-fill `by` — naming first-of-list
  // (miki) would silently nominate one of the two assigned
  // executors and let the other inadvertently chain-call under the
  // wrong attribution. The reason string surfaces both names so the
  // reader chooses explicitly.
  assert.equal(payload.suggested_next?.args?.by, undefined);
  assert.match(
    String(payload.suggested_next?.reason ?? ''),
    /miki.*leysia|leysia.*miki/,
  );
});

test('gate approve --format json: suggested_next pre-fills `by` when only one executor (single-executor unchanged)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  for (const n of ['alice', 'bob']) run(root, ['register', '--name', n]);
  const created = run(
    root,
    [
      'request',
      '--from',
      'alice',
      '--action',
      'a',
      '--reason',
      'r',
      '--executors',
      'bob',
      '--format',
      'json',
    ],
    'alice',
  );
  assert.equal(created.status, 0);
  const id = (JSON.parse(created.stdout) as { id: string }).id;
  const approve = run(root, ['approve', id, '--format', 'json'], 'eris');
  assert.equal(approve.status, 0);
  const payload = JSON.parse(approve.stdout) as {
    suggested_next?: { args?: { by?: string } };
  };
  assert.equal(payload.suggested_next?.args?.by, 'bob');
});

// ── execute notice (request.ts:reqExecute mismatch hint) ─────────

test('gate execute: notice silent when leysia (second-listed executor) runs the work', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = setupApprovedRequest(root);

  const r = run(root, ['execute', id], 'leysia');
  assert.equal(r.status, 0, `execute failed: ${r.stderr}`);
  // No mismatch notice: leysia IS in the assigned set. The earlier
  // shape (scalar `assignedExecutor !== by`) would have printed
  // "assigned to miki" — a false-positive misdirection that
  // contradicts the actual record.
  assert.equal(
    /assigned to/.test(r.stderr),
    false,
    `unexpected mismatch notice for leysia (in assigned list): ${r.stderr}`,
  );
});

test('gate execute: mismatch notice DOES fire when an unrelated actor runs the work', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  for (const n of ['alice', 'miki', 'leysia', 'bob']) {
    run(root, ['register', '--name', n]);
  }
  const created = run(
    root,
    [
      'request',
      '--from',
      'alice',
      '--action',
      'a',
      '--reason',
      'r',
      '--executors',
      'miki,leysia',
      '--format',
      'json',
    ],
    'alice',
  );
  assert.equal(created.status, 0);
  const id = (JSON.parse(created.stdout) as { id: string }).id;
  run(root, ['approve', id], 'eris');

  // bob is NOT in the assigned list; the notice must fire and name
  // the full assigned set so the reader sees who the substrate
  // expected.
  const r = run(root, ['execute', id], 'bob');
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.stderr,
    /notice: bob executed request .*\(assigned to one of miki, leysia\)/,
  );
});

// ── JSON shape (v0.6 #239: deprecated `executor` alias removed) ─

test('gate show --format json: emits only `executors`; deprecated `executor` alias removed in v0.6 (#239)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  for (const n of ['alice', 'miki', 'leysia']) {
    run(root, ['register', '--name', n]);
  }
  const r = run(
    root,
    [
      'request',
      '--from',
      'alice',
      '--action',
      'a',
      '--reason',
      'r',
      '--executors',
      'miki,leysia',
      '--format',
      'json',
    ],
    'alice',
  );
  const id = (JSON.parse(r.stdout) as { id: string }).id;

  const show = run(root, ['show', id, '--format', 'json']);
  const j = JSON.parse(show.stdout) as Record<string, unknown>;
  assert.deepEqual(j['executors'], [
    { name: 'miki', status: 'pending' },
    { name: 'leysia', status: 'pending' },
  ]);
  // The deprecated `executor` alias was removed in v0.6 (#239 cut).
  // Consumers must read `executors`.
  assert.equal(j['executor'], undefined);
});

test('YAML on disk does NOT carry the deprecated `executor` alias (persistence stays clean)', async (t) => {
  // Companion to the JSON back-compat test above. Even though the
  // render side emits both keys, the raw file must contain only
  // `executors:` — re-emitting both keys to YAML would pollute on-
  // disk records (the spec line "旧形式は read のみ tolerance" we
  // opened the issue on).
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  for (const n of ['alice', 'miki', 'leysia']) {
    run(root, ['register', '--name', n]);
  }
  const created = run(
    root,
    [
      'request',
      '--from',
      'alice',
      '--action',
      'a',
      '--reason',
      'r',
      '--executors',
      'miki,leysia',
      '--format',
      'json',
    ],
    'alice',
  );
  const id = (JSON.parse(created.stdout) as { id: string }).id;
  const yamlPath = join(root, 'requests', 'pending', `${id}.yaml`);
  // Read raw bytes; YAML.parse-ing would lose any "key present but
  // undefined" distinction we care about.
  const raw = (
    await import('node:fs')
  ).readFileSync(yamlPath, 'utf8');
  assert.match(raw, /executors:/, 'new wire form should be present');
  // The deprecated alias must not surface as a top-level YAML key.
  // Match `\nexecutor:` (with leading newline) so we don't
  // false-match on substrings like `executors:` or names containing
  // the word "executor".
  assert.equal(
    /\nexecutor:\s/.test(raw),
    false,
    `legacy executor: key should not appear in persisted YAML; got:\n${raw}`,
  );
});
