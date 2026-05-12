// gate lore — package-shipped doctrine reader.
//
// Surfaces this test pins:
//   - `lore list` returns every principle + trap as a flat list
//   - `--type principle|trap` narrows the listing
//   - `--applies-to <scope>` filters principles; universal entries
//     (no explicit applies_to) surface regardless of the filter
//   - `--relevant-until current|expired|indefinite` filters traps
//   - `--format json` emits structured array + per-entry frontmatter
//   - `lore show <name>` returns the markdown body (or full json)
//   - bare `gate lore` prints a usage hint and exits 1
//   - unknown subcommand prints a hint and exits 1
//   - non-existent name returns 'not found' + a discovery hint
//
// The repo ships real lore/principles/*.md and lore/traps/*.md, so
// these tests run against the actual doctrine — no fixture seeding.
// They assert on stable structural properties (entry counts >= 1,
// known filenames present, principle 11 body has its H1) rather
// than on counts that would drift each time a principle ships.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  // lore is package-shipped (not per-content_root), but the gate CLI
  // still needs a content_root + actor to boot. Use a tmpdir.
  const root = mkdtempSync(join(tmpdir(), 'guild-lore-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, d));
  }
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    `name: alice\ncategory: professional\nactive: true\n`,
  );
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

test('gate lore (no subcommand) emits a usage hint + exit 1', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['lore'], { GUILD_ACTOR: 'alice' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /needs a subcommand/);
  assert.match(r.stderr, /gate lore list/);
  assert.match(r.stderr, /gate lore show/);
});

test('gate lore list returns every principle and trap as a flat list', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['lore', 'list'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0);
  // Stable anchor: principle 04 (records-outlive-writers) is one of
  // the oldest and will not be removed.
  assert.match(r.stdout, /04-records-outlive-writers\s+\[principle\]/);
  // Trap section: doc-coverage trap was added in 2026-05 and is
  // marked indefinite, so it's a stable anchor too.
  assert.match(r.stdout, /trap_doc_coverage_drift_post_ship\s+\[trap\/indefinite\]/);
});

test('gate lore list --type principle narrows to principles', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['lore', 'list', '--type', 'principle'], {
    GUILD_ACTOR: 'alice',
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\[principle\]/);
  assert.doesNotMatch(r.stdout, /\[trap\//);
});

test('gate lore list --type trap narrows to traps', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['lore', 'list', '--type', 'trap'], {
    GUILD_ACTOR: 'alice',
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\[trap\//);
  assert.doesNotMatch(r.stdout, /\[principle\]/);
});

test('gate lore list --applies-to swarm shows principle 14 plus universal entries', (t) => {
  // applies_to: swarm is explicit on principle 14; principles without
  // an explicit applies_to are universal (`all`) and surface here too.
  // Matches the tools/lore-scope.sh semantics.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['lore', 'list', '--applies-to', 'swarm'], {
    GUILD_ACTOR: 'alice',
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /14-substrate-engagement.*\[principle\/swarm\]/);
  // Universal principle still surfaces.
  assert.match(r.stdout, /04-records-outlive-writers\s+\[principle\]/);
});

test('gate lore list --relevant-until current keeps indefinite + future traps', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['lore', 'list', '--type', 'trap', '--relevant-until', 'current'], {
    GUILD_ACTOR: 'alice',
  });
  assert.equal(r.status, 0);
  // Indefinite traps are by definition current.
  assert.match(r.stdout, /\[trap\/indefinite\]/);
});

test('gate lore list --format json emits an array with frontmatter', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['lore', 'list', '--format', 'json'], {
    GUILD_ACTOR: 'alice',
  });
  assert.equal(r.status, 0);
  const items = JSON.parse(r.stdout);
  assert.ok(Array.isArray(items));
  assert.ok(items.length > 0);
  // Sample item shape: name + type + title + frontmatter all present.
  const sample = items[0];
  assert.equal(typeof sample.name, 'string');
  assert.ok(sample.type === 'principle' || sample.type === 'trap');
  assert.ok('title' in sample);
  assert.equal(typeof sample.frontmatter, 'object');
  // Principle 14's applies_to surfaces here.
  const p14 = items.find(
    (i: { name: string }) => i.name === '14-substrate-engagement-reduces-coordination-context-cost',
  );
  assert.ok(p14, 'principle 14 should be in the list');
  assert.equal(p14.frontmatter.applies_to, 'swarm');
});

test('gate lore show <name> returns the markdown body', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(
    root,
    ['lore', 'show', '11-ai-first-human-as-projection'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  // The body starts with the H1 of the principle.
  assert.match(r.stdout, /# AI-first, human as projection/);
  // And contains body anchors stable enough to survive editing. The
  // markdown is hard-wrapped, so use single-line substrings that
  // span no line break.
  assert.match(r.stdout, /direction of derivation/);
  assert.match(r.stdout, /AI-natural check first/);
});

test('gate lore show <name> --format json returns structured entry', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(
    root,
    ['lore', 'show', '11-ai-first-human-as-projection', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  const entry = JSON.parse(r.stdout);
  assert.equal(entry.name, '11-ai-first-human-as-projection');
  assert.equal(entry.type, 'principle');
  assert.match(entry.title ?? '', /AI-first, human as projection/);
  // Body anchor on a single line (markdown is hard-wrapped).
  assert.match(entry.body, /direction of derivation/);
});

test('gate lore show <missing> returns not-found + discovery hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['lore', 'show', 'no-such-thing'], {
    GUILD_ACTOR: 'alice',
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /lore entry not found/);
  assert.match(r.stderr, /gate lore list/);
});

test('gate lore <unknown-sub> emits a hint listing valid subs', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['lore', 'xyzzy'], { GUILD_ACTOR: 'alice' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown subcommand: gate lore xyzzy/);
  assert.match(r.stderr, /list \| show/);
});

test('gate lore list --type bogus rejects with a typed error', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['lore', 'list', '--type', 'bogus'], {
    GUILD_ACTOR: 'alice',
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--type must be 'principle' or 'trap'/);
});

test('gate lore list --relevant-until invalid rejects with a typed error', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['lore', 'list', '--type', 'trap', '--relevant-until', 'whenever'], {
    GUILD_ACTOR: 'alice',
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--relevant-until must be/);
});
