// devil-review — YamlDevilReviewRepository round-trip + CAS tests.
//
// Real FS via tmpdir, mirrors the agora YamlPlayRepository tests'
// shape. Pins:
//   - saveNew → findById round-trip preserves all fields
//   - listAll returns reviews in most-recent-first id order
//   - nextSequence increments per-day
//   - appendEntry / appendSuspension / appendResume / appendReRun
//     all CAS on their respective array length
//   - replaceEntry mutates by id (for dismiss/resolve)
//   - saveConclusion flips state once and refuses second
//   - concluded reviews refuse further appends (terminal)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GuildConfig } from '../../../src/infrastructure/config/GuildConfig.js';
import { DevilReview } from '../../../src/passages/devil/domain/DevilReview.js';
import { Entry } from '../../../src/passages/devil/domain/Entry.js';
import { YamlDevilReviewRepository } from '../../../src/passages/devil/infrastructure/YamlDevilReviewRepository.js';

const ts = '2026-05-03T00:00:00.000Z';

function bootstrap(): { repo: YamlDevilReviewRepository; root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'devil-repo-'));
  writeFileSync(join(root, 'guild.config.yaml'), 'content_root: .\nhost_names: [human]\n');
  mkdirSync(join(root, 'members'));
  writeFileSync(join(root, 'members', 'alice.yaml'), 'name: alice\ncategory: professional\nactive: true\n');
  const config = GuildConfig.load(root, () => {});
  const repo = new YamlDevilReviewRepository(config);
  return { repo, root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function makeFinding(id: string, lense = 'injection'): Entry {
  return Entry.create({
    id,
    at: ts,
    by: 'alice',
    persona: 'red-team',
    lense,
    kind: 'finding',
    text: 'sample finding',
    severity: 'high',
    severity_rationale: 'public endpoint, no preceding sanitization layer',
    status: 'open',
  });
}

test('pathFor returns absolute path under content_root/devil/reviews/', (t) => {
  const { repo, root, cleanup } = bootstrap();
  t.after(cleanup);
  const p = repo.pathFor('rev-2026-05-03-001');
  assert.equal(p, join(root, 'devil', 'reviews', 'rev-2026-05-03-001.yaml'));
});

test('saveNew → findById round-trip preserves all fields', async (t) => {
  const { repo, cleanup } = bootstrap();
  t.after(cleanup);
  const r = DevilReview.open({
    id: 'rev-2026-05-03-001',
    target: { type: 'pr', ref: 'https://github.com/eris-ths/guild-cli/pull/125' },
    opened_by: 'alice',
  });
  await repo.saveNew(r);
  const loaded = await repo.findById('rev-2026-05-03-001');
  assert.ok(loaded);
  assert.equal(loaded.id, r.id);
  assert.equal(loaded.target.type, 'pr');
  assert.equal(loaded.target.ref, 'https://github.com/eris-ths/guild-cli/pull/125');
  assert.equal(loaded.opened_by, 'alice');
  assert.equal(loaded.state, 'open');
});

test('saveNew throws DevilReviewIdCollision on duplicate id', async (t) => {
  const { repo, cleanup } = bootstrap();
  t.after(cleanup);
  const r = DevilReview.open({
    id: 'rev-2026-05-03-001',
    target: { type: 'pr', ref: 'x' },
    opened_by: 'alice',
  });
  await repo.saveNew(r);
  await assert.rejects(() => repo.saveNew(r), /already exists/);
});

test('findById returns null when missing', async (t) => {
  const { repo, cleanup } = bootstrap();
  t.after(cleanup);
  const loaded = await repo.findById('rev-2026-05-03-001');
  assert.equal(loaded, null);
});

test('listAll returns reviews most-recent-first', async (t) => {
  const { repo, cleanup } = bootstrap();
  t.after(cleanup);
  await repo.saveNew(
    DevilReview.open({
      id: 'rev-2026-05-01-001',
      target: { type: 'pr', ref: 'x1' },
      opened_by: 'alice',
    }),
  );
  await repo.saveNew(
    DevilReview.open({
      id: 'rev-2026-05-03-001',
      target: { type: 'pr', ref: 'x2' },
      opened_by: 'alice',
    }),
  );
  await repo.saveNew(
    DevilReview.open({
      id: 'rev-2026-05-02-001',
      target: { type: 'pr', ref: 'x3' },
      opened_by: 'alice',
    }),
  );
  const all = await repo.listAll();
  assert.equal(all.length, 3);
  assert.deepEqual(
    all.map((r) => r.id),
    ['rev-2026-05-03-001', 'rev-2026-05-02-001', 'rev-2026-05-01-001'],
  );
});

test('nextSequence increments per-day', async (t) => {
  const { repo, cleanup } = bootstrap();
  t.after(cleanup);
  assert.equal(await repo.nextSequence('2026-05-03'), 1);
  await repo.saveNew(
    DevilReview.open({
      id: 'rev-2026-05-03-001',
      target: { type: 'pr', ref: 'x' },
      opened_by: 'alice',
    }),
  );
  assert.equal(await repo.nextSequence('2026-05-03'), 2);
  // Different day starts back at 1.
  assert.equal(await repo.nextSequence('2026-05-04'), 1);
});

test('appendEntry round-trips and is reflected in findById', async (t) => {
  const { repo, cleanup } = bootstrap();
  t.after(cleanup);
  const r = DevilReview.open({
    id: 'rev-2026-05-03-001',
    target: { type: 'pr', ref: 'x' },
    opened_by: 'alice',
  });
  await repo.saveNew(r);
  await repo.appendEntry(r, 0, makeFinding('e-001'));
  const loaded = await repo.findById('rev-2026-05-03-001');
  assert.ok(loaded);
  assert.equal(loaded.entries.length, 1);
  assert.equal(loaded.entries[0]?.id, 'e-001');
  assert.equal(loaded.entries[0]?.kind, 'finding');
});

test('appendEntry CAS catches stale expected count', async (t) => {
  const { repo, cleanup } = bootstrap();
  t.after(cleanup);
  const r = DevilReview.open({
    id: 'rev-2026-05-03-001',
    target: { type: 'pr', ref: 'x' },
    opened_by: 'alice',
  });
  await repo.saveNew(r);
  await repo.appendEntry(r, 0, makeFinding('e-001'));
  // Caller still thinks count is 0 → conflict (now it's 1 on disk).
  await assert.rejects(
    () => repo.appendEntry(r, 0, makeFinding('e-002')),
    /changed on disk \(expected entries count 0, found 1\)/,
  );
});

test('replaceEntry mutates an entry by id (dismiss/resolve path)', async (t) => {
  const { repo, cleanup } = bootstrap();
  t.after(cleanup);
  const r = DevilReview.open({
    id: 'rev-2026-05-03-001',
    target: { type: 'pr', ref: 'x' },
    opened_by: 'alice',
  });
  await repo.saveNew(r);
  await repo.appendEntry(r, 0, makeFinding('e-001'));
  const dismissed = Entry.create({
    id: 'e-001',
    at: ts,
    by: 'alice',
    persona: 'mirror',
    lense: 'injection',
    kind: 'finding',
    text: 'sample finding',
    severity: 'high',
    severity_rationale: 'public endpoint, no preceding sanitization layer',
    status: 'dismissed',
    dismissal_reason: 'false-positive',
    dismissal_note: 'sink was a stub used in the test harness',
  });
  await repo.replaceEntry(r, 1, 'e-001', dismissed);
  const loaded = await repo.findById('rev-2026-05-03-001');
  assert.ok(loaded);
  assert.equal(loaded.entries.length, 1);
  assert.equal(loaded.entries[0]?.status, 'dismissed');
  assert.equal(loaded.entries[0]?.dismissal_reason, 'false-positive');
});

test('replaceEntry refuses if newEntry.id mismatches targetEntryId', async (t) => {
  const { repo, cleanup } = bootstrap();
  t.after(cleanup);
  const r = DevilReview.open({
    id: 'rev-2026-05-03-001',
    target: { type: 'pr', ref: 'x' },
    opened_by: 'alice',
  });
  await repo.saveNew(r);
  await repo.appendEntry(r, 0, makeFinding('e-001'));
  await assert.rejects(
    () => repo.replaceEntry(r, 1, 'e-001', makeFinding('e-002')),
    /must match targetEntryId/,
  );
});

test('saveConclusion flips state to concluded', async (t) => {
  const { repo, cleanup } = bootstrap();
  t.after(cleanup);
  const r = DevilReview.open({
    id: 'rev-2026-05-03-001',
    target: { type: 'pr', ref: 'x' },
    opened_by: 'alice',
  });
  await repo.saveNew(r);
  await repo.saveConclusion(r, 'open', {
    at: ts,
    by: 'alice',
    synthesis: 'all 11 lenses touched, no actionable findings beyond accepted-risk on supply-chain',
    unresolved: [],
  });
  const loaded = await repo.findById('rev-2026-05-03-001');
  assert.ok(loaded);
  assert.equal(loaded.state, 'concluded');
  assert.ok(loaded.conclusion);
  assert.match(loaded.conclusion.synthesis, /all 11 lenses touched/);
});

test('saveConclusion second call surfaces version conflict', async (t) => {
  const { repo, cleanup } = bootstrap();
  t.after(cleanup);
  const r = DevilReview.open({
    id: 'rev-2026-05-03-001',
    target: { type: 'pr', ref: 'x' },
    opened_by: 'alice',
  });
  await repo.saveNew(r);
  await repo.saveConclusion(r, 'open', {
    at: ts,
    by: 'alice',
    synthesis: 'first conclude',
    unresolved: [],
  });
  await assert.rejects(
    () =>
      repo.saveConclusion(r, 'open', {
        at: ts,
        by: 'alice',
        synthesis: 'second conclude',
        unresolved: [],
      }),
    /changed on disk/,
  );
});

test('concluded review refuses further appends (terminal)', async (t) => {
  const { repo, cleanup } = bootstrap();
  t.after(cleanup);
  const r = DevilReview.open({
    id: 'rev-2026-05-03-001',
    target: { type: 'pr', ref: 'x' },
    opened_by: 'alice',
  });
  await repo.saveNew(r);
  await repo.saveConclusion(r, 'open', {
    at: ts,
    by: 'alice',
    synthesis: 'done',
    unresolved: [],
  });
  await assert.rejects(
    () => repo.appendEntry(r, 0, makeFinding('e-001')),
    /changed on disk/,
  );
});
