// delta markdown adapter — a ledger a human edits by hand.
//
// The invariants worth pinning are the ones that protect an operator who
// deposits with `>>` and reads with the CLI. Two of them are silent
// failures if they break: an inverted ledger swallows every new deposit
// into history, and an id that moves when a line moves makes `deliver`
// hit the wrong deposit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MarkdownDeltaRepository,
  DeltaLedgerShapeError,
} from '../../../../src/passages/delta/infrastructure/MarkdownDeltaRepository.js';
import { GuildConfig } from '../../../../src/infrastructure/config/GuildConfig.js';
import { Delta } from '../../../../src/passages/delta/domain/Delta.js';

const NOW = () => new Date('2026-08-12T12:00:00');

function ledger(body: string): MarkdownDeltaRepository {
  const dir = mkdtempSync(join(tmpdir(), 'delta-md-'));
  const file = join(dir, 'delta.md');
  writeFileSync(file, body);
  const config = GuildConfig.default(dir, () => {});
  return new MarkdownDeltaRepository(config, file, NOW);
}

function read(repo: MarkdownDeltaRepository): string {
  return readFileSync(repo.path, 'utf8');
}

const LEDGER = `# delta

## Delivered

- [08-08 21:45] landed one ⟵ conversation → reflect ⟹ 08-09 flush: reflect(made a topic)

## Deposit

- [08-09 22:38] first outstanding ⟵ gate:2026-08-09-0004 → dev-flow
- [08-12 13:31] 🧭 operator note ⟵ external review → agora
`;

test('parses fields out of a deposit line', async () => {
  const repo = ledger(LEDGER);
  const all = await repo.listAll();
  assert.equal(all.length, 3);

  const op = all.find((d) => d.text === 'operator note');
  assert.ok(op, 'operator deposit parsed');
  assert.equal(op.source, 'external review');
  assert.equal(op.candidate, 'agora');
  assert.equal(op.state, 'pending');
  // The ledger has no author column; the marker is the only signal.
  assert.equal(op.created_by, 'operator');

  const agent = all.find((d) => d.text === 'first outstanding');
  assert.ok(agent);
  assert.notEqual(agent.created_by, 'operator');
});

test('a line above the last section is delivered, one below is outstanding', async () => {
  const repo = ledger(LEDGER);
  const all = await repo.listAll();
  const landed = all.filter((d) => d.state === 'delivered');
  assert.equal(landed.length, 1);
  assert.equal(landed[0]!.text, 'landed one');
  assert.equal(all.filter((d) => d.state === 'pending').length, 2);
});

test('delivery prose may contain a candidate arrow without splitting the fields', async () => {
  const repo = ledger(`## Delivered

- [08-08 21:45] text ⟵ src → cand ⟹ 08-10 flush: reflect(edge →0807 derives)

## Deposit

- [08-12 09:00] still here
`);
  const [d] = (await repo.listAll()).filter((x) => x.text === 'text');
  assert.ok(d);
  assert.equal(d.source, 'src');
  assert.equal(d.candidate, 'cand');
  assert.match(d.delivered!.note!, /→0807 derives/);
});

test('ids survive a delivery — the annotation and the move change nothing', async () => {
  const repo = ledger(LEDGER);
  const before = await repo.listAllIds();
  const target = (await repo.listAll()).find((d) => d.text === 'first outstanding')!;

  await repo.save(target.markDelivered({ to: 'reflect', by: 'eris', now: NOW }));

  const after = await repo.listAllIds();
  assert.deepEqual([...after].sort(), [...before].sort(), 'no id was renumbered');
  const moved = await repo.findById(target.id);
  assert.ok(moved, 'the delivered deposit is still addressable by its id');
  assert.equal(moved.state, 'delivered');
});

test('a delivered line leaves the deposit section', async () => {
  const repo = ledger(LEDGER);
  const target = (await repo.listAll()).find((d) => d.text === 'first outstanding')!;
  await repo.save(target.markDelivered({ to: 'reflect', by: 'eris', now: NOW }));

  const text = read(repo);
  const depositIdx = text.lastIndexOf('## ');
  assert.ok(
    text.indexOf('first outstanding') < depositIdx,
    'the delivered line moved above the final heading',
  );
  assert.ok(text.includes('⟹'), 'the delivery is recorded, not dropped');
  assert.equal((await repo.listAll()).filter((d) => d.state === 'pending').length, 1);
});

test('a new deposit lands at end of file — the same place `>>` writes to', async () => {
  const repo = ledger(LEDGER);
  const d = Delta.create({
    id: 'delta-2026-08-12-009',
    text: 'appended',
    created_by: 'eris',
    now: NOW,
  });
  await repo.saveNew(d);

  const lines = read(repo).trimEnd().split('\n');
  assert.match(lines[lines.length - 1]!, /appended$/);
  assert.equal((await repo.listAll()).filter((x) => x.state === 'pending').length, 3);
});

test('a round-trip through the ledger preserves every field', async () => {
  const repo = ledger(LEDGER);
  await repo.saveNew(
    Delta.create({
      id: 'delta-2026-08-12-009',
      text: 'round trip',
      created_by: 'eris',
      source: 'gate:2026-08-12-0002',
      candidate: 'cultivate',
      now: NOW,
    }),
  );
  const back = (await repo.listAll()).find((d) => d.text === 'round trip');
  assert.ok(back);
  assert.equal(back.source, 'gate:2026-08-12-0002');
  assert.equal(back.candidate, 'cultivate');
});

test('an inverted ledger fails closed instead of swallowing deposits', async () => {
  // The failure this guards: `>>` appends to the end, so if the section
  // holding history is last, every future deposit lands there unread.
  const repo = ledger(`## Deposit

- [08-12 09:00] outstanding

## Delivered

- [08-08 21:45] landed ⟹ 08-09 flush: reflect(done)
`);
  await assert.rejects(
    () => repo.listAll(),
    (e: unknown) => {
      assert.ok(e instanceof DeltaLedgerShapeError);
      assert.match((e as Error).message, /inverted/);
      assert.match((e as Error).message, /next:/, 'names a recovery path');
      return true;
    },
  );
});

test('a ledger with no section fails closed', async () => {
  const repo = ledger(`- [08-12 09:00] orphan\n`);
  await assert.rejects(() => repo.listAll(), DeltaLedgerShapeError);
});

test('a mixed final section is not read as inverted', async () => {
  // Real ledgers carry delivered lines that have not been swept yet;
  // only an *entirely* delivered final section is the inversion signal.
  const repo = ledger(`## Delivered

- [08-01 09:00] old ⟹ 08-02 flush: reflect(x)

## Deposit

- [08-12 09:00] outstanding
- [08-12 09:01] swept late ⟹ 08-12 flush: ctx(y)
`);
  assert.equal((await repo.listAll()).length, 3);
});

test('a date later than today reads as last year', async () => {
  const repo = ledger(`## Delivered

## Deposit

- [12-31 09:00] from december
`);
  const [d] = await repo.listAll();
  assert.match(d!.id, /^delta-2025-12-31-/);
});

test('a missing ledger names how to make one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'delta-md-'));
  const repo = new MarkdownDeltaRepository(
    GuildConfig.default(dir, () => {}),
    join(dir, 'absent.md'),
    NOW,
  );
  await assert.rejects(
    () => repo.listAll(),
    (e: unknown) => {
      assert.match((e as Error).message, /next:/);
      return true;
    },
  );
});
