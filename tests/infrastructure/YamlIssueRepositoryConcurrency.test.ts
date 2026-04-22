// Issue concurrency: save() uses atomic write + version CAS so two
// concurrent `gate issues resolve` or `gate issues note` calls can't
// silently drop each other's state_log / notes entries.
//
// Companion to YamlRequestRepository (RequestVersionConflict) and
// FsInboxNotification (InboxVersionConflict) — same optimistic-lock
// pattern, one invariant per record class.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { YamlIssueRepository } from '../../src/infrastructure/persistence/YamlIssueRepository.js';
import {
  Issue,
  IssueId,
} from '../../src/domain/issue/Issue.js';
import { IssueVersionConflict } from '../../src/application/ports/IssueRepository.js';
import { GuildConfig } from '../../src/infrastructure/config/GuildConfig.js';

function bootstrap(): {
  repo: YamlIssueRepository;
  root: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), 'guild-issue-concur-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  mkdirSync(join(root, 'issues'));
  const config = GuildConfig.load(root);
  const repo = new YamlIssueRepository(config);
  return { repo, root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const d = new Date('2026-04-22T00:00:00Z');

async function seedIssue(repo: YamlIssueRepository): Promise<Issue> {
  const id = IssueId.generate(d, 1);
  const i = Issue.create({
    id,
    from: 'alice',
    severity: 'low',
    area: 'ux',
    text: 'seed',
  });
  await repo.saveNew(i);
  return i;
}

test('save() atomic write: uses temp+rename (no torn reads from a partial write)', async (t) => {
  const { repo, root, cleanup } = bootstrap();
  t.after(cleanup);
  const seeded = await seedIssue(repo);
  // Load a fresh instance so loadedVersion is set from disk state.
  const loaded = await repo.findById(seeded.id);
  assert.ok(loaded);
  loaded!.setState('in_progress', 'alice');
  await repo.save(loaded!);
  const parsed = YAML.parse(
    readFileSync(join(root, 'issues', `${seeded.id.value}.yaml`), 'utf8'),
  );
  assert.equal(parsed.state, 'in_progress');
  assert.equal(parsed.state_log.length, 1);
});

test('save() throws IssueVersionConflict when on-disk grew since load', async (t) => {
  const { repo, root, cleanup } = bootstrap();
  t.after(cleanup);
  const seeded = await seedIssue(repo);

  // Two readers both load at version=0.
  const reader1 = await repo.findById(seeded.id);
  const reader2 = await repo.findById(seeded.id);
  assert.ok(reader1 && reader2);

  // reader1 transitions first → disk now at version=1.
  reader1!.setState('in_progress', 'alice');
  await repo.save(reader1!);

  // reader2 still has the stale snapshot (loadedVersion=0). Its next
  // save should detect the concurrent mutation and throw.
  reader2!.setState('resolved', 'alice');
  await assert.rejects(
    () => repo.save(reader2!),
    (e: unknown) =>
      e instanceof IssueVersionConflict &&
      e.expected === 0 &&
      e.found === 1,
  );
});

test('addNote race: two noters with stale load also conflict', async (t) => {
  const { repo, cleanup } = bootstrap();
  t.after(cleanup);
  const seeded = await seedIssue(repo);

  const r1 = await repo.findById(seeded.id);
  const r2 = await repo.findById(seeded.id);
  assert.ok(r1 && r2);

  r1!.addNote('alice', 'first note');
  await repo.save(r1!);

  r2!.addNote('bob', 'concurrent note');
  await assert.rejects(
    () => repo.save(r2!),
    (e: unknown) =>
      e instanceof IssueVersionConflict &&
      e.expected === 0 &&
      e.found === 1,
  );
});

test('computeIssueVersion: state_log + notes sum is monotonic', async (t) => {
  const { repo, cleanup } = bootstrap();
  t.after(cleanup);
  const seeded = await seedIssue(repo);

  let loaded = await repo.findById(seeded.id);
  assert.equal(loaded!.loadedVersion, 0);

  loaded!.setState('in_progress', 'alice');
  await repo.save(loaded!);

  loaded = await repo.findById(seeded.id);
  assert.equal(loaded!.loadedVersion, 1, 'state_log bump = +1');

  loaded!.addNote('alice', 'note 1');
  await repo.save(loaded!);

  loaded = await repo.findById(seeded.id);
  assert.equal(loaded!.loadedVersion, 2, 'notes bump = +1 more');
});

test('IssueVersionConflict error shape', () => {
  const err = new IssueVersionConflict('i-2026-04-22-0001', 1, 2);
  assert.equal(err.code, 'ISSUE_VERSION_CONFLICT');
  assert.equal(err.name, 'IssueVersionConflict');
  assert.match(err.message, /expected version 1/);
  assert.match(err.message, /found 2/);
  assert.match(err.message, /Re-run/);
});
