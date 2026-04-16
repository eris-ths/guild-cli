// YamlRequestRepository — optimistic lock, findById dedupe, save() guards.
//
// Focused on the invariants added in the "fix: address 4-lens review"
// commit: concurrent writes must conflict, mid-transition state is
// deterministically resolvable, and save() refuses fresh aggregates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { GuildConfig } from '../../src/infrastructure/config/GuildConfig.js';
import { YamlRequestRepository } from '../../src/infrastructure/persistence/YamlRequestRepository.js';
import { Request } from '../../src/domain/request/Request.js';
import { RequestId } from '../../src/domain/request/RequestId.js';
import { MemberName } from '../../src/domain/member/MemberName.js';
import { Review } from '../../src/domain/request/Review.js';
import { RequestVersionConflict } from '../../src/application/ports/RequestRepository.js';

function makeRoot(): { root: string; cfg: GuildConfig; repo: YamlRequestRepository; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-cli-repo-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  const cfg = GuildConfig.load(root, () => {});
  const repo = new YamlRequestRepository(cfg);
  return { root, cfg, repo, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function createSaved(repo: YamlRequestRepository, seq = 1): Promise<Request> {
  const id = RequestId.generate(new Date('2026-04-16T00:00:00Z'), seq);
  const r = Request.create({ id, from: 'alice', action: 'a', reason: 'r' });
  await repo.saveNew(r);
  return r;
}

test('save() rejects a freshly-created Request (loadedVersion=0)', async () => {
  const { repo, cleanup } = makeRoot();
  try {
    const fresh = Request.create({
      id: RequestId.generate(new Date('2026-04-16T00:00:00Z'), 1),
      from: 'alice',
      action: 'a',
      reason: 'r',
    });
    await assert.rejects(
      () => repo.save(fresh),
      /use saveNew/i,
      'save() on a fresh aggregate must refuse to prevent silent overwrites',
    );
  } finally {
    cleanup();
  }
});

test('save() throws RequestVersionConflict when on-disk grew since load', async () => {
  const { repo, cleanup } = makeRoot();
  try {
    await createSaved(repo, 1);
    const idStr = '2026-04-16-0001';

    // Process A loads
    const aCopy = await repo.findById(RequestId.of(idStr));
    assert.ok(aCopy);
    assert.equal(aCopy!.loadedVersion, 1); // one status_log entry, no reviews

    // Process B loads and commits a transition
    const bCopy = await repo.findById(RequestId.of(idStr));
    bCopy!.approve(MemberName.of('human'), 'B');
    await repo.save(bCopy!);

    // A now tries to transition on its stale copy
    aCopy!.approve(MemberName.of('human'), 'A');
    await assert.rejects(
      () => repo.save(aCopy!),
      (e) =>
        e instanceof RequestVersionConflict &&
        e.expectedVersion === 1 &&
        e.actualVersion === 2,
      'expected A.save() to surface a version conflict with concrete version numbers',
    );
  } finally {
    cleanup();
  }
});

test('save() optimistic lock covers review races (not only transitions)', async () => {
  const { repo, cleanup } = makeRoot();
  try {
    // Advance to completed so review is legal
    await createSaved(repo, 1);
    const id = RequestId.of('2026-04-16-0001');
    {
      const r = await repo.findById(id);
      r!.approve(MemberName.of('human'));
      await repo.save(r!);
    }
    {
      const r = await repo.findById(id);
      r!.execute(MemberName.of('alice'));
      await repo.save(r!);
    }
    {
      const r = await repo.findById(id);
      r!.complete(MemberName.of('alice'));
      await repo.save(r!);
    }

    // Two reviewers both load at version=4 (4 status_log entries, 0 reviews)
    const reviewerA = await repo.findById(id);
    const reviewerB = await repo.findById(id);
    assert.equal(reviewerA!.loadedVersion, 4);
    assert.equal(reviewerB!.loadedVersion, 4);

    // B writes first: reviews becomes 1 → version 5 on disk
    reviewerB!.addReview(
      Review.create({ by: 'alice', lense: 'devil', verdict: 'ok', comment: 'lgtm' }),
    );
    await repo.save(reviewerB!);

    // A tries to commit on stale version — must conflict, even
    // though status_log is unchanged. A status_log-only check would
    // miss this and silently drop B's review.
    reviewerA!.addReview(
      Review.create({ by: 'alice', lense: 'layer', verdict: 'ok', comment: 'also lgtm' }),
    );
    await assert.rejects(
      () => repo.save(reviewerA!),
      (e) =>
        e instanceof RequestVersionConflict &&
        e.expectedVersion === 4 &&
        e.actualVersion === 5,
      'review race must trigger version conflict (the status_log-only bug we fixed)',
    );
  } finally {
    cleanup();
  }
});

test('findById dedupes a file that exists under two state dirs', async () => {
  const { root, cfg, repo, cleanup } = makeRoot();
  try {
    await createSaved(repo, 1);
    const idStr = '2026-04-16-0001';
    const r = await repo.findById(RequestId.of(idStr));
    r!.approve(MemberName.of('human'));
    await repo.save(r!);
    // Post-save, only approved/ should exist
    assert.equal(
      existsSync(join(cfg.paths.requests, 'approved', `${idStr}.yaml`)),
      true,
    );
    assert.equal(
      existsSync(join(cfg.paths.requests, 'pending', `${idStr}.yaml`)),
      false,
    );

    // Simulate a crash mid-transition: re-introduce the stale pending
    // file alongside the fresher approved file.
    const staleYaml = YAML.stringify({
      id: idStr,
      from: 'alice',
      action: 'a',
      reason: 'r',
      state: 'pending',
      created_at: '2026-04-16T00:00:00.000Z',
      status_log: [
        { state: 'pending', by: 'alice', at: '2026-04-16T00:00:00.000Z', note: 'created' },
      ],
      reviews: [],
    });
    mkdirSync(join(root, 'requests', 'pending'), { recursive: true });
    writeFileSync(join(root, 'requests', 'pending', `${idStr}.yaml`), staleYaml);

    // findById must return the newer (approved, 2 entries) not the
    // older (pending, 1 entry) — regression guard against the old
    // "first state dir wins" behavior.
    const resolved = await repo.findById(RequestId.of(idStr));
    assert.ok(resolved);
    assert.equal(resolved!.state, 'approved');
    assert.equal(resolved!.statusLog.length, 2);
  } finally {
    cleanup();
  }
});

test('save() cleans up straggler files from old state dirs', async () => {
  const { root, repo, cleanup } = makeRoot();
  try {
    await createSaved(repo, 1);
    const idStr = '2026-04-16-0001';
    const r = await repo.findById(RequestId.of(idStr));
    r!.approve(MemberName.of('human'));
    await repo.save(r!);
    // pending/ entry must be gone after the successful transition
    assert.equal(
      existsSync(join(root, 'requests', 'pending', `${idStr}.yaml`)),
      false,
    );
    assert.equal(
      existsSync(join(root, 'requests', 'approved', `${idStr}.yaml`)),
      true,
    );
  } finally {
    cleanup();
  }
});

test('save() produces no top-level duplicated completion_note in writer path', async () => {
  // Regression guard for layer 1+2: the domain must not re-emit
  // completion_note separately from status_log[-1].note on disk.
  // toJSON() derives it, but re-hydrating then re-saving should not
  // cause the two to drift, and status_log[-1].note is the source.
  const { repo, root, cleanup } = makeRoot();
  try {
    await createSaved(repo, 1);
    const id = RequestId.of('2026-04-16-0001');
    const a = await repo.findById(id);
    a!.approve(MemberName.of('human'));
    await repo.save(a!);
    const b = await repo.findById(id);
    b!.execute(MemberName.of('alice'));
    await repo.save(b!);
    const c = await repo.findById(id);
    c!.complete(MemberName.of('alice'), 'the real note');
    await repo.save(c!);

    const yamlText = readFileSync(
      join(root, 'requests', 'completed', '2026-04-16-0001.yaml'),
      'utf8',
    );
    const doc = YAML.parse(yamlText);
    // Source of truth check: status_log[-1].note carries the note
    assert.equal(
      doc.status_log[doc.status_log.length - 1].note,
      'the real note',
    );
    // External shape contract: completion_note still emitted for
    // backward compat, and must match the status_log entry.
    assert.equal(doc.completion_note, 'the real note');
  } finally {
    cleanup();
  }
});
