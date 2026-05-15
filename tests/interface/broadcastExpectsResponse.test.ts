// Phase 1 of issue #220: surface broadcast/issue implicit-response
// expectations via boot.
//
// Pins the contract for the `--expects-response` opt-in:
//   * broadcast with --expects-response stamps each recipient inbox
//     entry with `expects_response: true` and gate boot surfaces the
//     unread entry under suggested_next as
//     `broadcast-pending-response`.
//   * mark-read drains the surface (read = ack proxy in Phase 1).
//   * legacy / opt-out broadcasts (no field, or field absent) never
//     surface — the bit is opt-in only and pre-existing records are
//     not rewritten with a default false (principle 04:
//     records-outlive-writers).
//   * any state-transition kind in actionableTransitions
//     (executing-mine ... reviewed-authored) wins over the broadcast
//     surface — broadcast-pending-response is the tail of the ladder.

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
  const root = mkdtempSync(join(tmpdir(), 'guild-bcer-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, d));
  }
  for (const s of ['pending', 'approved', 'executing', 'completed', 'failed', 'denied']) {
    mkdirSync(join(root, 'requests', s));
  }
  for (const name of ['alice', 'bob']) {
    writeFileSync(
      join(root, 'members', `${name}.yaml`),
      `name: ${name}\ncategory: professional\nactive: true\n`,
    );
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

test('broadcast --expects-response: opt-in stamps expects_response on inbox YAML', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(
    root,
    ['broadcast', '--from', 'alice', '--text', 'all hands?', '--expects-response'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `broadcast failed: ${r.stderr}`);
  const yaml = readFileSync(join(root, 'inbox', 'bob.yaml'), 'utf8');
  assert.match(
    yaml,
    /expects_response:\s*true/,
    'expected on-disk expects_response: true marker',
  );
});

test('broadcast WITHOUT --expects-response: no expects_response field on disk', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(
    root,
    ['broadcast', '--from', 'alice', '--text', 'fyi'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  const yaml = readFileSync(join(root, 'inbox', 'bob.yaml'), 'utf8');
  // Default-false is encoded as field-absence (opt-in semantics + no
  // legacy rewrite). The string must not appear.
  assert.ok(
    !yaml.includes('expects_response'),
    `expects_response should be absent for opt-out broadcasts; saw:\n${yaml}`,
  );
});

test('boot suggested_next surfaces broadcast-pending-response for unread opt-in broadcasts', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(
    root,
    ['broadcast', '--from', 'alice', '--text', 'please reply', '--expects-response'],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.ok(payload.suggested_next, 'expected non-null suggested_next');
  assert.equal(payload.suggested_next.kind, 'broadcast-pending-response');
  assert.equal(payload.suggested_next.broadcast_from, 'alice');
  assert.equal(typeof payload.suggested_next.broadcast_at, 'string');
  assert.ok(typeof payload.suggested_next.hint === 'string' && payload.suggested_next.hint.length > 0);
  // inbox_unread also exposes the bit on the entry itself.
  assert.ok(Array.isArray(payload.inbox_unread));
  assert.equal(payload.inbox_unread.length, 1);
  assert.equal(payload.inbox_unread[0].expects_response, true);
});

test('mark-read drains the broadcast-pending-response surface (read = ack proxy)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(
    root,
    ['broadcast', '--from', 'alice', '--text', 'please reply', '--expects-response'],
    { GUILD_ACTOR: 'alice' },
  );
  runGate(
    root,
    ['inbox', 'mark-read', '--for', 'bob'],
    { GUILD_ACTOR: 'bob' },
  );
  const r = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
  const payload = JSON.parse(r.stdout);
  // No transition exists; pre-onboarding hint shouldn't fire either
  // (bob is registered and has no actor-resolution issue). With the
  // entry now read, broadcast-pending-response also doesn't fire
  // → suggested_next is null.
  assert.equal(payload.suggested_next, null);
});

test('opt-out broadcasts do NOT surface (default false; opt-in semantics)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(
    root,
    ['broadcast', '--from', 'alice', '--text', 'fyi'],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.suggested_next, null);
  // The entry is still in inbox_unread (it was a real broadcast),
  // just without the expects_response marker. Phase 1 boundary.
  assert.equal(payload.inbox_unread.length, 1);
  assert.equal(payload.inbox_unread[0].expects_response, undefined);
});

test('legacy inbox YAML without expects_response field hydrates as false (no surface)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Hand-write a pre-Phase-1 shape: an unread broadcast with no
  // expects_response key at all. Mirrors records-outlive-writers
  // (principle 04): boot must read what's there without rewriting.
  writeFileSync(
    join(root, 'inbox', 'bob.yaml'),
    [
      'version: 1',
      'messages:',
      '  - from: alice',
      '    to: bob',
      '    type: broadcast',
      '    text: legacy entry',
      '    at: 2026-01-01T00:00:00.000Z',
      '    read: false',
      '',
    ].join('\n'),
  );
  const r = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.suggested_next, null);
  assert.equal(payload.inbox_unread.length, 1);
  assert.equal(payload.inbox_unread[0].expects_response, undefined);
});

test('state-transition kinds win over broadcast-pending-response (priority-tail)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Plant an opt-in broadcast → would surface as
  // broadcast-pending-response in isolation.
  runGate(
    root,
    ['broadcast', '--from', 'alice', '--text', 'please reply', '--expects-response'],
    { GUILD_ACTOR: 'alice' },
  );
  // Now plant a higher-priority transition for bob: a pending
  // request that names bob as executor (pending-as-executor).
  runGate(
    root,
    [
      'request',
      '--from', 'alice',
      '--action', 'do-thing',
      '--reason', 'because',
      '--executors', 'bob',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
  const payload = JSON.parse(r.stdout);
  assert.ok(payload.suggested_next, 'expected non-null suggested_next');
  // suggested_next is the canonical verb/args triple, NOT the
  // broadcast variant.
  assert.equal(typeof payload.suggested_next.verb, 'string');
  assert.notEqual(payload.suggested_next.kind, 'broadcast-pending-response');
  assert.equal(payload.suggested_next.verb, 'approve');
});

test('edge: same sender, expects_response=true then false to same recipient — only flagged surfaces, no +N inflation, no disk rewrite', (t) => {
  // Leysia's room-tidying eye: a broadcaster reverses themselves
  // mid-stream. Two unread entries from alice land in bob's inbox; the
  // first declared expects_response=true, the second did NOT. Boot must
  // pick up the flagged one only — not double-count, not get confused
  // by the later FYI re-issue, and the unflagged twin must NOT inflate
  // any "+N more pending" suffix on the hint. Marking the flagged one
  // read clears the surface even though the unflagged twin remains
  // unread (it never was a candidate). Disk rewrite is forbidden:
  // unflagged record must keep field-absence (records-outlive-writers).
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  runGate(
    root,
    ['broadcast', '--from', 'alice', '--text', 'reply please', '--expects-response'],
    { GUILD_ACTOR: 'alice' },
  );
  runGate(
    root,
    ['broadcast', '--from', 'alice', '--text', 'nm — sorted'],
    { GUILD_ACTOR: 'alice' },
  );

  // Bob has two unread broadcasts from alice. Only the first carries
  // the flag — surface must show exactly one pending-response, no
  // "+N more pending" suffix (only one was flagged).
  const boot = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
  const payload = JSON.parse(boot.stdout);
  assert.equal(payload.suggested_next?.kind, 'broadcast-pending-response');
  assert.equal(payload.suggested_next.broadcast_from, 'alice');
  assert.equal(payload.suggested_next.actor_resolved, true);
  assert.ok(
    !/\+\d+ more pending/.test(payload.suggested_next.hint),
    `expected no "+N more pending" suffix; got hint: ${payload.suggested_next.hint}`,
  );

  // Bob marks the flagged entry (it was posted first → idx 1).
  const m = runGate(
    root,
    ['inbox', 'mark-read', '1', '--for', 'bob'],
    { GUILD_ACTOR: 'bob' },
  );
  assert.equal(m.status, 0, m.stderr);

  // Surface clears even though the unflagged second broadcast is
  // still unread — it never was a candidate.
  const boot2 = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
  const payload2 = JSON.parse(boot2.stdout);
  assert.equal(
    payload2.suggested_next,
    null,
    'mark-read on flagged entry should clear the surface — unflagged twin must not back-fill the slot',
  );

  // Sanity on disk: unflagged record carries no expects_response key
  // (omit-when-false), and the inbox listing shows one read + one
  // unread without any rewrite of the unflagged entry.
  const inbox = runGate(
    root,
    ['inbox', '--for', 'bob', '--format', 'json'],
    { GUILD_ACTOR: 'bob' },
  );
  const msgs = JSON.parse(inbox.stdout) as Array<Record<string, unknown>>;
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0]!.read, true, 'first (flagged) marked read');
  assert.equal(msgs[1]!.read, false, 'second (unflagged) still unread');
  assert.equal(
    msgs[0]!.expects_response,
    true,
    'flagged record carries expects_response: true',
  );
  assert.ok(
    !('expects_response' in (msgs[1] as object)),
    'unflagged record must not have expects_response key (omit-when-false; no rewrite)',
  );
});

test('schema declares broadcast-pending-response shape on boot.suggested_next', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['schema', '--verb', 'boot']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  const verb = payload.verbs[0];
  const sn = verb.output.properties.suggested_next;
  assert.ok(sn, 'boot.output.suggested_next missing');
  assert.ok(sn.properties.kind, 'kind discriminator missing on suggested_next');
  assert.deepEqual(sn.properties.kind.enum, ['broadcast-pending-response']);
  assert.ok(sn.properties.broadcast_from);
  assert.ok(sn.properties.broadcast_at);
  assert.ok(sn.properties.hint);
});

test('schema declares --expects-response on broadcast input properties', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['schema', '--verb', 'broadcast']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  const verb = payload.verbs[0];
  assert.ok(verb.input.properties['expects-response']);
  assert.equal(verb.input.properties['expects-response'].type, 'boolean');
});

// ---- inbox text-mode visibility (v0.5 dogfood follow-up) ----

test('inbox text mode: unread expects_response broadcast renders "(unread, expects response)"', (t) => {
  // Pre-fix (PR #222): JSON inbox carried the expects_response stamp
  // but the text rendering only said "(unread)". A human scanning
  // the inbox text couldn't tell a normal broadcast apart from one
  // that wanted a substantive response — they'd have to re-run with
  // --format json to see the stamp. Surface the signal inline on
  // the text path so the principle-09 disclosure shape (visible at
  // the surface that emits it) holds for both formats.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(
    root,
    [
      'broadcast',
      '--from', 'alice',
      '--text', 'audit needed',
      '--expects-response',
    ],
  );
  const r = runGate(root, ['inbox'], { GUILD_ACTOR: 'bob' });
  assert.equal(r.status, 0);
  assert.match(
    r.stdout,
    /broadcast from alice .*\(unread, expects response\)/,
    `expected expects-response marker on unread; got:\n${r.stdout}`,
  );
});

test('inbox text mode: unread without expects_response stays "(unread)" (no over-broadcasting)', (t) => {
  // Sibling negative: the marker only appears when the sender
  // opted in. A FYI broadcast must not be retro-flagged as
  // expecting a response — that would defeat the opt-in design.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(
    root,
    ['broadcast', '--from', 'alice', '--text', 'FYI only'],
  );
  const r = runGate(root, ['inbox'], { GUILD_ACTOR: 'bob' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /broadcast from alice .*\(unread\)/);
  assert.doesNotMatch(r.stdout, /expects response/);
});

test('inbox text mode: read state suppresses the marker (Phase 1 ack proxy)', (t) => {
  // Phase 1 contract: read = ack proxy. Once mark-read fires the
  // expectation surface drains in boot too (see "mark-read drains
  // the broadcast-pending-response surface" above). Mirror that on
  // the inbox text — past read time the marker would just nag the
  // reader instead of orienting them.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(
    root,
    [
      'broadcast', '--from', 'alice',
      '--text', 'audit needed',
      '--expects-response',
    ],
  );
  runGate(root, ['inbox', 'mark-read'], { GUILD_ACTOR: 'bob' });
  const r = runGate(root, ['inbox'], { GUILD_ACTOR: 'bob' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /broadcast from alice .*\(read/);
  assert.doesNotMatch(r.stdout, /expects response/);
});
