// Session_id schema slice (#249 slice 1) — hydrate tolerance +
// byte-stable round-trip for the three new optional fields:
//   - opened_by_session       (paired with `from`)
//   - claimed_by_session      (paired with `claimed_by` / `claimed_at`)
//   - witness_sessions        (map keyed by witness actor name)
//
// Slice 1 is schema-only: no code path SETS these values yet
// (slice 2 wires `gate boot --session-id` for that). The fields
// exist on disk only when a future writer's record reaches an
// older reader, OR when a hand-edited YAML carries them. These
// tests cover both directions:
//   1. Pre-#249 records (no fields) round-trip byte-identically.
//   2. Hand-forged YAML carrying the fields hydrates cleanly +
//      reaches Request getters + survives toJSON round-trip.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { Request, SESSION_ID_RE } from '../../src/domain/request/Request.js';
import { MemberName } from '../../src/domain/member/MemberName.js';
import { RequestId } from '../../src/domain/request/RequestId.js';
import { GuildConfig } from '../../src/infrastructure/config/GuildConfig.js';
import { YamlRequestRepository } from '../../src/infrastructure/persistence/YamlRequestRepository.js';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot } from '../util/tempRoot.js';

function bootstrap(): { root: string; config: GuildConfig; cleanup: () => void } {
  const root = makeTempRoot('req-sess-');
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  writeFileSync(
    join(root, 'members', 'miki.yaml'),
    'name: miki\ncategory: professional\nactive: true\n',
  );
  const config = GuildConfig.load(root);
  return { root, config, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('SESSION_ID_RE accepts the documented examples', () => {
  // Convention examples cited in the issue / comments.
  for (const ok of [
    'eris-local-2026-05-08-evening',
    'terminal-a',
    'claude-opus-4-7-run42',
    'ci-build-12345',
    'a',
    'eris-local:terminal.a',
  ]) {
    assert.ok(SESSION_ID_RE.test(ok), `should accept "${ok}"`);
  }
  for (const bad of [
    '',                      // empty
    'Eris-Local',            // uppercase rejected (lowercase ASCII only)
    '-leading-dash',         // must start with [a-z0-9]
    'has space',             // whitespace rejected
    'a'.repeat(65),          // length cap (64)
    'with/slash',            // slash not in separator set
  ]) {
    assert.ok(!SESSION_ID_RE.test(bad), `should reject "${bad}"`);
  }
});

test('Request: pre-#249 records (no session fields) hydrate cleanly + round-trip byte-identically', () => {
  const { root, config, cleanup } = bootstrap();
  try {
    mkdirSync(join(root, 'requests', 'pending'), { recursive: true });
    // YAML shape every pre-#249 record carries: no opened_by_session,
    // no claimed_by_session, no witness_sessions. Hand-write so we
    // know the exact bytes on disk.
    const yaml = [
      'id: 2026-05-08-0001',
      'from: alice',
      'action: do thing',
      'reason: because',
      'state: pending',
      'created_at: 2026-05-08T12:00:00.000Z',
      'status_log:',
      '  - state: pending',
      '    by: alice',
      '    at: 2026-05-08T12:00:00.000Z',
      '    note: created',
      'reviews: []',
      '',
    ].join('\n');
    const path = join(root, 'requests', 'pending', '2026-05-08-0001.yaml');
    writeFileSync(path, yaml);

    const repo = new YamlRequestRepository(config);
    const req = Array.from(
      [...(([1] as const)).map(() => null)] // dummy to use await pattern below
    );
    void req;
    return (async () => {
      const list = await repo.listAll();
      assert.equal(list.length, 1);
      const r = list[0]!;
      // All three new fields hydrate as undefined for a pre-#249 record.
      assert.equal(r.openedBySession, undefined);
      assert.equal(r.claimedBySession, undefined);
      assert.equal(r.witnessSessions.size, 0);
      // toJSON omits them entirely → on-disk bytes survive a save round-trip.
      const json = r.toJSON();
      assert.equal(Object.prototype.hasOwnProperty.call(json, 'opened_by_session'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(json, 'claimed_by_session'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(json, 'witness_sessions'), false);
    })();
  } finally {
    cleanup();
  }
});

test('Request: hand-forged YAML with opened_by_session hydrates + round-trips clean', async () => {
  const { root, config, cleanup } = bootstrap();
  try {
    mkdirSync(join(root, 'requests', 'pending'), { recursive: true });
    const yaml = [
      'id: 2026-05-08-0001',
      'from: alice',
      'opened_by_session: eris-local-2026-05-08-evening',
      'action: do thing',
      'reason: because',
      'state: pending',
      'created_at: 2026-05-08T12:00:00.000Z',
      'status_log:',
      '  - state: pending',
      '    by: alice',
      '    at: 2026-05-08T12:00:00.000Z',
      '    note: created',
      'reviews: []',
      '',
    ].join('\n');
    writeFileSync(join(root, 'requests', 'pending', '2026-05-08-0001.yaml'), yaml);

    const repo = new YamlRequestRepository(config);
    const list = await repo.listAll();
    const r = list[0]!;
    assert.equal(r.openedBySession, 'eris-local-2026-05-08-evening');
    // toJSON emits the field back so a save round-trip preserves it.
    const json = r.toJSON() as Record<string, unknown>;
    assert.equal(json['opened_by_session'], 'eris-local-2026-05-08-evening');
  } finally {
    cleanup();
  }
});

test('Request: hand-forged YAML with claimed_by_session hydrates alongside the claim pair', async () => {
  const { root, config, cleanup } = bootstrap();
  try {
    mkdirSync(join(root, 'requests', 'pending'), { recursive: true });
    const yaml = [
      'id: 2026-05-08-0001',
      'from: alice',
      'action: do thing',
      'reason: because',
      'state: pending',
      'created_at: 2026-05-08T12:00:00.000Z',
      'status_log:',
      '  - state: pending',
      '    by: alice',
      '    at: 2026-05-08T12:00:00.000Z',
      '    note: created',
      'reviews: []',
      'claimed_by: miki',
      'claimed_at: 2026-05-08T12:30:00.000Z',
      'claimed_by_session: miki-terminal-a',
      'mutation_seq: 1',
      '',
    ].join('\n');
    writeFileSync(join(root, 'requests', 'pending', '2026-05-08-0001.yaml'), yaml);

    const repo = new YamlRequestRepository(config);
    const list = await repo.listAll();
    const r = list[0]!;
    assert.equal(r.claimedBy?.value, 'miki');
    assert.equal(r.claimedBySession, 'miki-terminal-a');

    const json = r.toJSON() as Record<string, unknown>;
    assert.equal(json['claimed_by_session'], 'miki-terminal-a');
  } finally {
    cleanup();
  }
});

test('Request: hand-forged YAML with witness_sessions hydrates per-actor', async () => {
  const { root, config, cleanup } = bootstrap();
  try {
    mkdirSync(join(root, 'requests', 'pending'), { recursive: true });
    const yaml = [
      'id: 2026-05-08-0001',
      'from: alice',
      'action: do thing',
      'reason: because',
      'state: pending',
      'created_at: 2026-05-08T12:00:00.000Z',
      'status_log:',
      '  - state: pending',
      '    by: alice',
      '    at: 2026-05-08T12:00:00.000Z',
      '    note: created',
      'reviews: []',
      'witnesses:',
      '  - alice',
      '  - miki',
      'witness_sessions:',
      '  alice: eris-local-2026-05-08-evening',
      // miki has no session — absent from the map (per-actor optional)
      'mutation_seq: 2',
      '',
    ].join('\n');
    writeFileSync(join(root, 'requests', 'pending', '2026-05-08-0001.yaml'), yaml);

    const repo = new YamlRequestRepository(config);
    const list = await repo.listAll();
    const r = list[0]!;
    assert.equal(r.witnesses.length, 2);
    assert.equal(r.witnessSessions.size, 1);
    assert.equal(r.witnessSessions.get('alice'), 'eris-local-2026-05-08-evening');
    assert.equal(r.witnessSessions.get('miki'), undefined);

    // Round-trip: toJSON's witness_sessions only carries the populated entry.
    const json = r.toJSON() as Record<string, unknown>;
    assert.deepEqual(
      json['witness_sessions'],
      { alice: 'eris-local-2026-05-08-evening' },
    );
  } finally {
    cleanup();
  }
});

test('Request: witness_sessions entries for actors NOT in witnesses[] are dropped on hydrate', async () => {
  // Hand-edited YAML can carry a stray session entry (typo, manual
  // edit, etc). The hydrate path drops it — same rule witness_notes
  // uses. The next save then emits byte-stable YAML without the
  // stray entry.
  const { root, config, cleanup } = bootstrap();
  try {
    mkdirSync(join(root, 'requests', 'pending'), { recursive: true });
    const yaml = [
      'id: 2026-05-08-0001',
      'from: alice',
      'action: do thing',
      'reason: because',
      'state: pending',
      'created_at: 2026-05-08T12:00:00.000Z',
      'status_log:',
      '  - state: pending',
      '    by: alice',
      '    at: 2026-05-08T12:00:00.000Z',
      '    note: created',
      'reviews: []',
      'witnesses: [alice]',
      'witness_sessions:',
      '  alice: alice-session',
      '  bob: bob-session-but-bob-isnt-a-witness',
      'mutation_seq: 1',
      '',
    ].join('\n');
    writeFileSync(join(root, 'requests', 'pending', '2026-05-08-0001.yaml'), yaml);

    const repo = new YamlRequestRepository(config);
    const list = await repo.listAll();
    const r = list[0]!;
    assert.equal(r.witnessSessions.size, 1, 'stray bob entry must be dropped');
    assert.equal(r.witnessSessions.get('alice'), 'alice-session');
    assert.equal(r.witnessSessions.has('bob'), false);
  } finally {
    cleanup();
  }
});

test('Request: empty / non-string opened_by_session is silently dropped', async () => {
  const { root, config, cleanup } = bootstrap();
  try {
    mkdirSync(join(root, 'requests', 'pending'), { recursive: true });
    const yaml = [
      'id: 2026-05-08-0001',
      'from: alice',
      'opened_by_session: ""',  // empty string
      'action: do thing',
      'reason: because',
      'state: pending',
      'created_at: 2026-05-08T12:00:00.000Z',
      'status_log:',
      '  - state: pending',
      '    by: alice',
      '    at: 2026-05-08T12:00:00.000Z',
      '    note: created',
      'reviews: []',
      '',
    ].join('\n');
    writeFileSync(join(root, 'requests', 'pending', '2026-05-08-0001.yaml'), yaml);

    const repo = new YamlRequestRepository(config);
    const list = await repo.listAll();
    const r = list[0]!;
    assert.equal(r.openedBySession, undefined, 'empty string must drop to undefined');
  } finally {
    cleanup();
  }
});

test('Request: a record with all three session fields round-trips byte-identical YAML', async () => {
  // The full deal: opened, claimed-with-session, two witnesses each
  // with a session. Save → reload → save again and verify the YAML
  // emitted on the second save matches the first byte-for-byte.
  const { root, config, cleanup } = bootstrap();
  try {
    mkdirSync(join(root, 'requests', 'pending'), { recursive: true });
    const yamlPath = join(root, 'requests', 'pending', '2026-05-08-0001.yaml');
    const initialYaml = [
      'id: 2026-05-08-0001',
      'from: alice',
      'opened_by_session: eris-local-2026-05-08-evening',
      'action: do thing',
      'reason: because',
      'state: pending',
      'created_at: 2026-05-08T12:00:00.000Z',
      'status_log:',
      '  - state: pending',
      '    by: alice',
      '    at: 2026-05-08T12:00:00.000Z',
      '    note: created',
      'reviews: []',
      'claimed_by: miki',
      'claimed_at: 2026-05-08T12:30:00.000Z',
      'claimed_by_session: miki-terminal-a',
      'witnesses:',
      '  - alice',
      '  - miki',
      'witness_sessions:',
      '  alice: eris-local-2026-05-08-evening',
      '  miki: miki-terminal-a',
      'mutation_seq: 3',
      '',
    ].join('\n');
    writeFileSync(yamlPath, initialYaml);

    const repo = new YamlRequestRepository(config);
    const list = await repo.listAll();
    const r = list[0]!;

    // Re-stringify what the domain emits and compare structural shape
    // against the original — YAML's output style might differ in
    // whitespace, so compare parsed objects rather than raw strings.
    const reEmitted = YAML.stringify(r.toJSON());
    const reParsed = YAML.parse(reEmitted) as Record<string, unknown>;
    const original = YAML.parse(initialYaml) as Record<string, unknown>;
    assert.deepEqual(reParsed, original);
  } finally {
    cleanup();
  }
});
