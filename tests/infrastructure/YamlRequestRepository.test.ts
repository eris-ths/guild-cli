// YamlRequestRepository — optimistic lock, findById dedupe, save() guards.
//
// Focused on the invariants added in the "fix: address 4-lense review"
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
        e.expected === 1 &&
        e.found === 2,
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
        e.expected === 4 &&
        e.found === 5,
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

test('listByState passes config.lenses to hydrate (custom lense YAML round-trips)', async () => {
  // Regression: listByState used to drop config.lenses when calling
  // hydrate, so a request whose reviews used a custom lense (declared
  // in guild.config.yaml `lenses:`) became unreadable on any
  // listAll-backed verb (chain / voices / tail). findById worked;
  // listByState did not. Silent breakage — the warn-and-skip
  // swallowed the error and callers saw an empty result.
  const root = mkdtempSync(join(tmpdir(), 'guild-cli-repo-lense-'));
  try {
    writeFileSync(
      join(root, 'guild.config.yaml'),
      'content_root: .\nhost_names: [human]\nlenses:\n  - rational\n  - skeptic\n',
    );
    const cfg = GuildConfig.load(root, () => {});
    const repo = new YamlRequestRepository(cfg);

    const req = Request.create({
      id: RequestId.generate(new Date('2026-04-18T00:00:00Z'), 1),
      from: 'alice',
      action: 'try a custom lense',
      reason: 'r',
    });
    await repo.saveNew(req);

    // Hand-author a review with a custom lense by writing YAML directly,
    // bypassing Review.create (which also needs `allowedLenses`).
    // This mirrors the wire contract on disk.
    const path = join(root, 'requests', 'pending', `${req.id.value}.yaml`);
    const doc = YAML.parse(readFileSync(path, 'utf8')) as Record<
      string,
      unknown
    >;
    doc['reviews'] = [
      {
        by: 'alice',
        lense: 'rational',
        verdict: 'concern',
        comment: 'custom lense on disk',
        at: '2026-04-18T00:00:01Z',
      },
    ];
    writeFileSync(path, YAML.stringify(doc));

    // findById already works (test above, implicitly). listByState
    // is the one that used to fail.
    const list = await repo.listByState('pending');
    assert.equal(list.length, 1);
    assert.equal(list[0]!.reviews[0]!.lense, 'rational');

    // Same via listAll (chain/tail/voices entry point).
    const all = await repo.listAll();
    assert.equal(all.length, 1);
    assert.equal(all[0]!.reviews[0]!.lense, 'rational');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('save() does not throw spurious VersionConflict on records with legacy stateless status_log entries', async () => {
  // Regression guard: hydrate() skips status_log entries whose
  // `state` field is missing (e.g., a review-note row written by an
  // older format). readVersion() used to count those entries from
  // the raw YAML, so loadedVersion (from the hydrated aggregate)
  // and maxOnDisk (from raw count) drifted by exactly the number
  // of skipped entries — every save() on such a record then threw
  // RequestVersionConflict even though no concurrent writer existed.
  // Surfaced by `gate thank` against any reviews>=1 request whose
  // status_log carried a legacy review-note entry.
  const { root, cfg, repo, cleanup } = makeRoot();
  try {
    const req = await createSaved(repo, 1);
    const path = join(
      root,
      'requests',
      'pending',
      `${req.id.value}.yaml`,
    );
    const doc = YAML.parse(readFileSync(path, 'utf8')) as Record<
      string,
      unknown
    >;
    // Inject the legacy shape: a review row in status_log without
    // a `state` field (review-note flavor).
    (doc['status_log'] as unknown[]).push({
      by: 'human',
      at: '2026-04-16T00:00:01Z',
      note: 'review (concern, lense: devil): legacy review-note row',
    });
    // Plus a real review entry so reviews.length=1.
    doc['reviews'] = [
      {
        by: 'human',
        lense: 'devil',
        verdict: 'concern',
        comment: 'legacy companion review',
        at: '2026-04-16T00:00:01Z',
      },
    ];
    writeFileSync(path, YAML.stringify(doc));

    const reloaded = await repo.findById(RequestId.of(req.id.value));
    assert.ok(reloaded);
    // Hydrated aggregate drops the stateless row → statusLog.length=1,
    // reviews.length=1, loadedVersion=2.
    assert.equal(reloaded!.statusLog.length, 1);
    assert.equal(reloaded!.reviews.length, 1);
    assert.equal(reloaded!.loadedVersion, 2);

    // Touch a non-status_log/reviews field path: addThank.
    // Pre-fix, this threw RequestVersionConflict (expected 2, found 3).
    const thank = (await import(
      '../../src/domain/request/Thank.js'
    )).Thank.create({
      by: 'alice',
      to: 'human',
      at: '2026-04-16T00:00:02Z',
      reason: 'legacy-version regression',
    });
    reloaded!.addThank(thank);
    await repo.save(reloaded!); // must not throw
    cfg; // keep makeRoot's cfg referenced
  } finally {
    cleanup();
  }
});

test('save() does not throw spurious VersionConflict when reviews carries non-object entries', async () => {
  // Class-closure regression guard for the same shape as the
  // legacy-stateless-status_log case above. hydrate() drops review
  // entries that are not objects (loose-shape YAML, legacy import,
  // hand-edited file), but readVersion() used to count the raw
  // length. This created an identical loadedVersion vs maxOnDisk
  // drift on a different field. Surfaced by a noir-lense devil
  // review on the status_log fix that asked whether "any hydrate
  // skip rule ↔ counter mismatch" was closed as a class, not just
  // the one instance.
  const { root, cfg, repo, cleanup } = makeRoot();
  try {
    const req = await createSaved(repo, 1);
    const path = join(
      root,
      'requests',
      'pending',
      `${req.id.value}.yaml`,
    );
    const doc = YAML.parse(readFileSync(path, 'utf8')) as Record<
      string,
      unknown
    >;
    // Inject a non-object review entry alongside a real one. hydrate
    // skips the string; raw count would include it.
    doc['reviews'] = [
      'malformed-non-object-entry',
      {
        by: 'human',
        lense: 'devil',
        verdict: 'concern',
        comment: 'real review next to a malformed sibling',
        at: '2026-04-16T00:00:01Z',
      },
    ];
    writeFileSync(path, YAML.stringify(doc));

    const reloaded = await repo.findById(RequestId.of(req.id.value));
    assert.ok(reloaded);
    // hydrate drops the string, keeps the object → reviews.length=1.
    assert.equal(reloaded!.reviews.length, 1);
    // statusLog=1 (created entry), reviews=1, version=2.
    assert.equal(reloaded!.loadedVersion, 2);

    // Pre-fix, addThank+save would raise VersionConflict (expected 2,
    // found 3) because raw count saw the malformed string.
    const thank = (await import(
      '../../src/domain/request/Thank.js'
    )).Thank.create({
      by: 'alice',
      to: 'human',
      at: '2026-04-16T00:00:02Z',
      reason: 'reviews-non-object class-closure regression',
    });
    reloaded!.addThank(thank);
    await repo.save(reloaded!); // must not throw
    cfg;
  } finally {
    cleanup();
  }
});
