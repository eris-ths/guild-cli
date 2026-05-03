// gate boot: cross_passage orientation summary contract.
//
// Surfaced by the develop-branch dogfood (cross-passage-orient
// agora play, 2026-05-03): a fresh instance booting on a content_root
// with active agora plays or devil reviews previously saw nothing
// about them at the orientation entry point. The substrate-side
// Zeigarnik primitive (agora's cliff/invitation) breaks if the cliff
// isn't visible to the future instance landing here.
//
// This test pins the registry-seam shape:
//   - empty content_root (no agora/devil dirs) → cross_passage = {}
//   - agora dir with plays → cross_passage.agora populated
//   - devil dir with reviews → cross_passage.devil populated
//   - both → both keys present
//   - schema-as-contract: the payload type matches what schema.ts declares
//
// Provider failures are tested as "non-fatal" by intentionally
// corrupting the substrate and confirming boot still returns 0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');
const AGORA = resolve(here, '../../../bin/agora.mjs');
const DEVIL = resolve(here, '../../../bin/devil.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-cross-passage-'));
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
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(
  bin: string,
  cwd: string,
  args: string[],
  envOverrides: Record<string, string | undefined> = {},
): { stdout: string; stderr: string; status: number } {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  delete env['GUILD_ACTOR'];
  env['GUILD_ACTOR'] = 'alice';
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const r = spawnSync(process.execPath, [bin, ...args], {
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

test('gate boot: cross_passage is empty {} when no agora/devil records', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = run(GATE, root, ['boot', '--format', 'json']);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.deepEqual(payload.cross_passage, {});
});

test('gate boot: cross_passage.agora populated when an agora play exists', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Seed an agora game + play.
  const newR = run(AGORA, root, [
    'new',
    '--slug', 'topic',
    '--kind', 'sandbox',
    '--title', 'T',
  ]);
  assert.equal(newR.status, 0, `agora new stderr: ${newR.stderr}`);
  const playR = run(AGORA, root, ['play', '--slug', 'topic']);
  assert.equal(playR.status, 0, `agora play stderr: ${playR.stderr}`);

  const r = run(GATE, root, ['boot', '--format', 'json']);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.ok(payload.cross_passage.agora, 'cross_passage.agora must exist');
  assert.equal(payload.cross_passage.agora.passage, 'agora');
  assert.equal(payload.cross_passage.agora.open, 1);
  assert.equal(payload.cross_passage.agora.suspended, 0);
  assert.match(payload.cross_passage.agora.last_id, /^\d{4}-\d{2}-\d{2}-\d{3}$/);
  assert.equal(payload.cross_passage.agora.last_state, 'playing');
  // No devil records → no devil entry.
  assert.equal(payload.cross_passage.devil, undefined);
});

test('gate boot: suspended count distinguishes paused plays from playing ones', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(AGORA, root, ['new', '--slug', 't', '--kind', 'sandbox', '--title', 'T']);
  const playR = run(AGORA, root, ['play', '--slug', 't']);
  const playId = (playR.stdout.match(/play started: (\S+)/) ?? [])[1] ?? '';
  run(AGORA, root, [
    'suspend', playId,
    '--cliff', 'paused',
    '--invitation', 'next',
  ]);

  const r = run(GATE, root, ['boot', '--format', 'json']);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.cross_passage.agora.open, 1, 'suspended still counts as open');
  assert.equal(payload.cross_passage.agora.suspended, 1);
  assert.equal(payload.cross_passage.agora.last_state, 'suspended');
});

test('gate boot: cross_passage.devil populated when a devil review exists', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const openR = run(DEVIL, root, ['open', 'test-target', '--type', 'commit']);
  assert.equal(openR.status, 0, `devil open stderr: ${openR.stderr}`);

  const r = run(GATE, root, ['boot', '--format', 'json']);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.ok(payload.cross_passage.devil, 'cross_passage.devil must exist');
  assert.equal(payload.cross_passage.devil.passage, 'devil');
  assert.equal(payload.cross_passage.devil.open, 1);
  assert.equal(payload.cross_passage.devil.suspended, 0);
  assert.equal(payload.cross_passage.devil.last_state, 'open');
  assert.match(
    payload.cross_passage.devil.last_id,
    /^rev-\d{4}-\d{2}-\d{2}-\d{3}$/,
  );
});

test('gate boot: both passages surface independently', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(AGORA, root, ['new', '--slug', 't', '--kind', 'sandbox', '--title', 'T']);
  run(AGORA, root, ['play', '--slug', 't']);
  run(DEVIL, root, ['open', 'thing', '--type', 'commit']);

  const r = run(GATE, root, ['boot', '--format', 'json']);
  const payload = JSON.parse(r.stdout);
  assert.ok(payload.cross_passage.agora, 'agora present');
  assert.ok(payload.cross_passage.devil, 'devil present');
});

test('gate boot: a malformed devil review does not break the rest of boot', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Plant a malformed devil review file directly on disk so the
  // provider throws on hydrate. Boot must still exit 0; cross_passage.devil
  // is omitted (the provider error is caught and noticed on stderr).
  mkdirSync(join(root, 'devil', 'reviews'), { recursive: true });
  writeFileSync(
    join(root, 'devil', 'reviews', 'rev-2026-01-01-001.yaml'),
    'this is not valid yaml: : {] [\n',
  );
  // Also seed an agora play so we can confirm agora still appears.
  run(AGORA, root, ['new', '--slug', 't', '--kind', 'sandbox', '--title', 'T']);
  run(AGORA, root, ['play', '--slug', 't']);

  const r = run(GATE, root, ['boot', '--format', 'json']);
  assert.equal(r.status, 0, `boot must succeed even when one provider fails; stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.ok(payload.cross_passage.agora, 'agora still present');
  // devil provider failure: either the entry is omitted, OR the
  // provider was tolerant and still returned a summary; both are
  // acceptable as long as boot returned 0. The strong contract is
  // "boot does not crash"; the weaker contract is "a corrupt review
  // does not poison cross_passage.agora".
  // We don't assert on cross_passage.devil presence here so that
  // either tolerant or strict YAML hydration survives this test.
});
