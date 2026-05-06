// agora — handler-internal envelope parity (issue #205).
//
// #194 closed the entry-point outer-catch swallow. #205 closes the
// remaining handler-internal `process.stderr.write('error: ...')`
// sites that bypassed `--format json` envelope emission. This file
// pins the 25-site migration's agora-side surface — Game.create
// failures, GameSlugCollision, play-id ambiguity through the
// purified resolver, --game on slug-shape, schema unknown verb.
//
// Each test exercises the envelope shape emitted on stderr line 1:
//   {"ok":false,"error":{"message":"...","code":"...","field":"..."}}
// followed by the text-mode `error:` prologue on subsequent lines.
// The text-mode counterpart is asserted by the existing surface
// tests (agora/new.test.ts etc) — those keep the byte-shape
// regression net for human-CLI consumers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// dist/tests/passages/agora/ → ../../../../bin
const AGORA = resolve(here, '../../../../bin/agora.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'agora-h205-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runAgora(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [AGORA, ...args], {
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

/** Find the JSON envelope on stderr (first parseable {ok:false,...} line). */
function parseEnvelope(stderr: string): {
  ok: boolean;
  error: { message: string; code?: string; field?: string };
} {
  const lines = stderr.split('\n');
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && obj.ok === false) return obj;
    } catch {
      // Not the envelope line; keep scanning.
    }
  }
  throw new Error(`no envelope in stderr: ${stderr}`);
}

// --- (1) GameSlugCollision rebased to DomainError -------------------

test('agora new: dup slug --format json emits field=slug envelope (rebased GSC)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // First create succeeds.
  const first = runAgora(
    root,
    ['new', '--slug', 'dup', '--kind', 'sandbox', '--title', 'first', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(first.status, 0);
  // Second triggers GameSlugCollision (now a DomainError subclass).
  const second = runAgora(
    root,
    ['new', '--slug', 'dup', '--kind', 'sandbox', '--title', 'second', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(second.status, 1);
  const env = parseEnvelope(second.stderr);
  assert.equal(env.error.field, 'slug');
  // "is already taken" hits the `\bis already \w+` regex in
  // deriveErrorCode, mapping to the more-specific 'already_in_state'.
  assert.equal(env.error.code, 'already_in_state');
  assert.match(env.error.message, /is already taken/);
});

// --- (3) game not found (show.ts:84) -------------------------------

test('agora show <unknown-slug> --format json emits field=slug envelope', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(
    root,
    ['show', 'no-such-game', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  const env = parseEnvelope(r.stderr);
  assert.equal(env.error.field, 'slug');
  assert.equal(env.error.code, 'not_found');
  assert.match(env.error.message, /game "no-such-game" not found/);
  // text-mode hint should NOT appear in JSON-mode stderr (gated on format).
  assert.ok(
    !r.stderr.includes('agora list'),
    'JSON-mode stderr leaked text-only hint',
  );
});

// --- (4) play not found via resolver (show.ts:131) -----------------

test('agora show <unknown-play-id> --format json emits field=play_id envelope', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(
    root,
    ['show', '2099-01-01-001', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  const env = parseEnvelope(r.stderr);
  assert.equal(env.error.field, 'play_id');
  assert.match(env.error.message, /play "2099-01-01-001" not found/);
});

// --- (5) PlayIdAmbiguous through purified resolver -----------------

test('agora move <ambiguous> --format json emits field=play_id with candidates', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Create two games on the same day, both producing YYYY-MM-DD-001.
  for (const slug of ['game-alpha', 'game-beta']) {
    const create = runAgora(
      root,
      ['new', '--slug', slug, '--kind', 'sandbox', '--title', slug],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(create.status, 0, `setup: new --slug ${slug} failed`);
    const play = runAgora(
      root,
      ['play', '--slug', slug],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(play.status, 0, `setup: play --slug ${slug} failed`);
  }
  // Both have play 2026-...-001 on the same day. Without --game,
  // resolvePlayForVerb throws PlayIdAmbiguous (purified per Arch fix 2).
  const today = new Date().toISOString().slice(0, 10);
  const r = runAgora(
    root,
    ['move', `${today}-001`, '--text', 'irrelevant', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  const env = parseEnvelope(r.stderr);
  assert.equal(env.error.field, 'play_id');
  assert.equal(env.error.code, 'validation_error');
  assert.match(env.error.message, /multiple games have a play/);
  assert.match(env.error.message, /game-alpha/);
  assert.match(env.error.message, /game-beta/);
});

// --- (8) resolver unit-ish: writes nothing on its own --------------

test('agora cliff <ambiguous> --format json emits envelope (resolver pure)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  for (const slug of ['c-alpha', 'c-beta']) {
    runAgora(root, ['new', '--slug', slug, '--kind', 'sandbox', '--title', slug], { GUILD_ACTOR: 'alice' });
    runAgora(root, ['play', '--slug', slug], { GUILD_ACTOR: 'alice' });
  }
  const today = new Date().toISOString().slice(0, 10);
  // cliff is a resolvePlayForVerb caller — Arch fix 2 caller list (6 paths).
  const r = runAgora(
    root,
    ['cliff', `${today}-001`, '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  const env = parseEnvelope(r.stderr);
  assert.equal(env.error.field, 'play_id');
  // Pre-#205 the resolver wrote `error: multiple games...` directly
  // and bypassed --format json. Pin that the envelope is present.
});

// --- (11) cliff play-not-found (post-format @ line 65) -------------

test('agora cliff <unknown-id> --format json emits field=play_id', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(
    root,
    ['cliff', '2099-01-01-001', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  const env = parseEnvelope(r.stderr);
  assert.equal(env.error.field, 'play_id');
  assert.match(env.error.message, /not found/);
});

// --- (12) show --game on slug-shape (show.ts:69) -------------------

test('agora show <slug> --game x --format json emits field=game', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(
    root,
    ['show', 'looks-like-slug', '--game', 'whatever', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  const env = parseEnvelope(r.stderr);
  assert.equal(env.error.field, 'game');
  assert.match(env.error.message, /--game is for disambiguating play ids/);
});

// --- agora schema unknown verb (synthetic site, throws DomainError) ---

test('agora schema --verb <unknown> --format json emits field=verb', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(
    root,
    ['schema', '--verb', 'no-such-verb', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  const env = parseEnvelope(r.stderr);
  assert.equal(env.error.field, 'verb');
  assert.match(env.error.message, /no agora verb named "no-such-verb"/);
});

// --- text-mode preservation (no JSON envelope leaks) ----------------

test('agora show <unknown-slug> text mode: no JSON envelope, hint preserved', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(root, ['show', 'no-such-game'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 1);
  // No JSON envelope line.
  for (const line of r.stderr.split('\n')) {
    assert.ok(!line.startsWith('{'), `text-mode leaked JSON envelope: ${line}`);
  }
  // Text hint preserved.
  assert.match(r.stderr, /agora list/);
  assert.match(r.stderr, /agora new --slug/);
});
