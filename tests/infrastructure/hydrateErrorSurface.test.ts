import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GuildConfig } from '../../src/infrastructure/config/GuildConfig.js';
import { YamlRequestRepository } from '../../src/infrastructure/persistence/YamlRequestRepository.js';
import { YamlIssueRepository } from '../../src/infrastructure/persistence/YamlIssueRepository.js';
import { YamlMemberRepository } from '../../src/infrastructure/persistence/YamlMemberRepository.js';
import { MemberName } from '../../src/domain/member/MemberName.js';

function makeRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-cli-hydrate-'));
  mkdirSync(join(root, 'members'));
  mkdirSync(join(root, 'requests', 'pending'), { recursive: true });
  mkdirSync(join(root, 'issues'));
  mkdirSync(join(root, 'inbox'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [alice]\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('YamlRequestRepository: malformed request YAML surfaces via onMalformed', async () => {
  const { root, cleanup } = makeRoot();
  try {
    // write a request YAML missing required fields so hydrate will throw
    const badPath = join(root, 'requests', 'pending', '2026-04-15-001.yaml');
    writeFileSync(badPath, 'id: 2026-04-15-001\n# missing from/action/reason\n');

    const warnings: string[] = [];
    const config = GuildConfig.load(root, (source, msg) => warnings.push(`${source}: ${msg}`));
    const repo = new YamlRequestRepository(config);

    const items = await repo.listByState('pending');
    assert.equal(items.length, 0, 'malformed record should be dropped');
    assert.equal(warnings.length, 1, 'exactly one warning should surface');
    assert.match(warnings[0]!, /requests\/pending\/2026-04-15-001\.yaml/);
    assert.match(warnings[0]!, /id=2026-04-15-001/);
    assert.match(warnings[0]!, /hydrate failed/);
  } finally {
    cleanup();
  }
});

test('YamlRequestRepository: malformed status_log entry surfaces per-entry', async () => {
  const { root, cleanup } = makeRoot();
  try {
    // valid top-level but status_log[1] has an invalid state value
    const path = join(root, 'requests', 'pending', '2026-04-15-002.yaml');
    writeFileSync(
      path,
      [
        'id: 2026-04-15-002',
        'from: alice',
        'action: test',
        'reason: test',
        'state: pending',
        'created_at: 2026-04-15T00:00:00Z',
        'status_log:',
        '  - state: pending',
        '    by: alice',
        '    at: 2026-04-15T00:00:00Z',
        '  - state: not-a-real-state',
        '    by: alice',
        '    at: 2026-04-15T00:01:00Z',
        'reviews: []',
        '',
      ].join('\n'),
    );

    const warnings: string[] = [];
    const config = GuildConfig.load(root, (source, msg) => warnings.push(`${source}: ${msg}`));
    const repo = new YamlRequestRepository(config);

    const items = await repo.listByState('pending');
    assert.equal(items.length, 1, 'request itself should still load');
    assert.equal(items[0]!.statusLog.length, 1, 'bad entry should be dropped');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /status_log\[1\]/);
    assert.match(warnings[0]!, /not-a-real-state/);
  } finally {
    cleanup();
  }
});

test('YamlIssueRepository: malformed issue surfaces via onMalformed', async () => {
  const { root, cleanup } = makeRoot();
  try {
    const badPath = join(root, 'issues', 'i-2026-04-15-001.yaml');
    writeFileSync(badPath, 'id: i-2026-04-15-001\n# missing required fields\n');

    const warnings: string[] = [];
    const config = GuildConfig.load(root, (source, msg) => warnings.push(`${source}: ${msg}`));
    const repo = new YamlIssueRepository(config);

    const items = await repo.listAll();
    assert.equal(items.length, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /issues\/i-2026-04-15-001\.yaml/);
    assert.match(warnings[0]!, /i-2026-04-15-001/);
  } finally {
    cleanup();
  }
});

test('YamlMemberRepository: malformed member surfaces via onMalformed', async () => {
  const { root, cleanup } = makeRoot();
  try {
    const badPath = join(root, 'members', 'broken.yaml');
    // category is not a valid MemberCategory
    writeFileSync(badPath, 'name: broken\ncategory: not-a-category\n');

    const warnings: string[] = [];
    const config = GuildConfig.load(root, (source, msg) => warnings.push(`${source}: ${msg}`));
    const repo = new YamlMemberRepository(config);

    const items = await repo.listAll();
    assert.equal(items.length, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /members\/broken\.yaml/);
    assert.match(warnings[0]!, /name=broken/);
  } finally {
    cleanup();
  }
});

test('findByName also routes through onMalformed on malformed YAML', async () => {
  const { root, cleanup } = makeRoot();
  try {
    writeFileSync(
      join(root, 'members', 'broken.yaml'),
      'name: broken\ncategory: invalid\n',
    );

    const warnings: string[] = [];
    const config = GuildConfig.load(root, (source, msg) => warnings.push(`${source}: ${msg}`));
    const repo = new YamlMemberRepository(config);

    const result = await repo.findByName(MemberName.of('broken'));
    assert.equal(result, null);
    assert.equal(warnings.length, 1);
  } finally {
    cleanup();
  }
});
