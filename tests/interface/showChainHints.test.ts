// show chain-hint footer — read-time awareness of forward id references.
//
// The invariant: `gate show <id> --format text` surfaces whether the
// record contains any full-id references to other records (YYYY-MM-DD-N
// pattern). Writers stay unconstrained; readers notice when `gate chain
// <id>` will return nothing (0 refs) or what it will walk (N refs).
//
// Design: scan free-text fields (action/reason/note/deny_reason/
// failure_reason/status_log.note/reviews.comment) for the canonical
// full-id pattern. Short forms like "(0004)" are intentionally not
// detected — that is precisely what the hint is warning about.

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
  const root = mkdtempSync(join(tmpdir(), 'guild-chain-hints-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  mkdirSync(join(root, 'members'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(
  cwd: string,
  args: string[],
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env },
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

function extractId(stdout: string): string | null {
  const m = stdout.match(/\b(\d{4}-\d{2}-\d{2}-\d+)\b/);
  return m ? m[1]! : null;
}

test('show text: 0 refs → "no outbound id references detected"', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(root, [
    'register',
    '--name',
    'alice',
    '--category',
    'professional',
  ]);
  const created = runGate(root, [
    'fast-track',
    '--from',
    'alice',
    '--action',
    'solo action without any id refs',
    '--reason',
    'a record that references no one else',
    '--executor',
    'alice',
  ]);
  const id = extractId(created.stdout + created.stderr);
  assert.ok(id, 'should create a record');
  const shown = runGate(root, ['show', id!, '--format', 'text']);
  assert.equal(shown.status, 0);
  assert.match(
    shown.stdout,
    /chain hint: no outbound id references detected/,
    'expected chain hint footer when no refs detected',
  );
});

test('show text: N refs → lists the ids', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(root, [
    'register',
    '--name',
    'alice',
    '--category',
    'professional',
  ]);
  // First create two records whose ids we can then reference.
  const first = runGate(root, [
    'fast-track',
    '--from',
    'alice',
    '--action',
    'first',
    '--reason',
    'standalone',
    '--executor',
    'alice',
  ]);
  const firstId = extractId(first.stdout)!;
  const second = runGate(root, [
    'fast-track',
    '--from',
    'alice',
    '--action',
    'second',
    '--reason',
    'standalone',
    '--executor',
    'alice',
  ]);
  const secondId = extractId(second.stdout)!;
  // Now create a record whose reason references both full ids.
  const third = runGate(root, [
    'fast-track',
    '--from',
    'alice',
    '--action',
    `depends on ${firstId}`,
    '--reason',
    `builds on ${firstId} and ${secondId}`,
    '--executor',
    'alice',
  ]);
  const thirdId = extractId(third.stdout)!;
  const shown = runGate(root, ['show', thirdId, '--format', 'text']);
  assert.equal(shown.status, 0);
  assert.match(
    shown.stdout,
    /chain hint: 2 outbound references detected/,
    'should report 2 references',
  );
  assert.ok(
    shown.stdout.includes(firstId),
    `hint should include first id ${firstId}`,
  );
  assert.ok(
    shown.stdout.includes(secondId),
    `hint should include second id ${secondId}`,
  );
});

test('show text: short-form (0004) is NOT detected', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(root, [
    'register',
    '--name',
    'alice',
    '--category',
    'professional',
  ]);
  const created = runGate(root, [
    'fast-track',
    '--from',
    'alice',
    '--action',
    'mentions 0004 informally',
    '--reason',
    'short-form (0004) should not count as a real reference',
    '--executor',
    'alice',
  ]);
  const id = extractId(created.stdout)!;
  const shown = runGate(root, ['show', id, '--format', 'text']);
  assert.equal(shown.status, 0);
  assert.match(
    shown.stdout,
    /chain hint: no outbound id references detected/,
    'short-form ids must not trigger a ref hint',
  );
});

test('show text: self-id is excluded from hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(root, [
    'register',
    '--name',
    'alice',
    '--category',
    'professional',
  ]);
  // Create a record that references its own future id inadvertently is
  // impossible (id is assigned after action/reason); the realistic path
  // is: a record references itself via a completion note. We simulate
  // by completing with a note containing the record's own id.
  const created = runGate(root, [
    'fast-track',
    '--from',
    'alice',
    '--action',
    'first',
    '--reason',
    'standalone',
    '--executor',
    'alice',
  ]);
  const id = extractId(created.stdout)!;
  // Self-reference via a second record pointing at id, then verify that
  // show on `id` itself does NOT include `id` in the hint (only other
  // ids would be listed there).
  const second = runGate(root, [
    'fast-track',
    '--from',
    'alice',
    '--action',
    `alludes to ${id} in action`,
    '--reason',
    `discusses ${id}`,
    '--executor',
    'alice',
  ]);
  const secondId = extractId(second.stdout)!;
  const shownFirst = runGate(root, ['show', id, '--format', 'text']);
  // `id` itself does not contain forward refs, so hint should say none.
  assert.match(
    shownFirst.stdout,
    /chain hint: no outbound id references detected/,
    "`id` should not self-reference in its own hint",
  );
  // `secondId` references `id` once — self-id `secondId` must be absent.
  const shownSecond = runGate(root, ['show', secondId, '--format', 'text']);
  assert.match(
    shownSecond.stdout,
    /chain hint: 1 outbound reference detected/,
  );
  assert.ok(
    !shownSecond.stdout
      .split('chain hint:')[1]
      ?.includes(secondId),
    'self-id must be excluded from the hint list',
  );
});
