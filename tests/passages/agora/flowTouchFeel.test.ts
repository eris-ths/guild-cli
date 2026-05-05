// Two touch-feel finishes from the post-#174 dogfood reviewer pass:
//
// (A) `agora new` defaults --kind to sandbox and --title to slug.
//     Pre-fix, four flags were required at the entry verb — friction
//     for a fresh agent in playful "ちょっと遊んでみるか" mode. Defaults
//     reduce the entry shape to one flag (`agora new --slug today`)
//     while preserving the full-spec form for callers who want it.
//
// (B) `agora move` text mode no longer prints the `next:` hint.
//     Reviewer observation: "move 003 で書いたら、その応答にもまさに
//     そのhintが出てきて、再帰的に証明された." The hint that helps
//     gate's lifecycle verbs (each step is a deliberation point)
//     hurts agora's flow-shaped move (the hint re-asserts itself
//     every move and breaks immersion). suggested_next stays in the
//     JSON envelope so orchestrators don't lose the contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../../bin/gate.mjs');
const AGORA = resolve(here, '../../../../bin/agora.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-agora-flow-touchfeel-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: []\n',
  );
  mkdirSync(join(root, 'members'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(
  bin: string,
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [bin, ...args], {
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

function setup(root: string): void {
  run(GATE, root, ['register', '--name', 'alice']);
}

// --- (A) agora new defaults ---

test('agora new: --slug only succeeds, kind defaults to sandbox, title defaults to slug', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  setup(root);
  const r = run(AGORA, root, ['new', '--slug', 'today'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
  assert.match(r.stdout, /✓ created game: today \[sandbox\] — today/);
});

test('agora new: explicit --kind quest still works', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  setup(root);
  const r = run(
    AGORA,
    root,
    ['new', '--slug', 'campaign', '--kind', 'quest'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\[quest\]/);
  // Title still defaults to slug when omitted.
  assert.match(r.stdout, /— campaign/);
});

test('agora new: explicit --title overrides the slug-as-title default', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  setup(root);
  const r = run(
    AGORA,
    root,
    ['new', '--slug', 'today', '--title', 'an explicit title'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.match(r.stdout, /— an explicit title/);
});

test('agora new: invalid --kind still rejected (defaults do not bypass validation)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  setup(root);
  const r = run(
    AGORA,
    root,
    ['new', '--slug', 't', '--kind', 'invalid'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /kind must be one of/);
});

// --- (B) agora move text mode drops the next: hint ---

test('agora move (text): success line only, no next: hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  setup(root);
  run(AGORA, root, ['new', '--slug', 'flow'], { GUILD_ACTOR: 'alice' });
  run(AGORA, root, ['play', '--slug', 'flow'], { GUILD_ACTOR: 'alice' });
  // Find the play id (single play under games/flow/).
  const playId = readdirSync(join(root, 'agora', 'plays', 'flow'))[0]!.replace(/\.yaml$/, '');

  const r = run(
    AGORA,
    root,
    ['move', playId, '--text', 'first move'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.match(r.stdout, /✓ move 001 appended to/);
  // The pre-fix hint lines are gone — pin both branches that used to
  // appear so a reintroduction would surface immediately.
  assert.equal(/next: agora move/.test(r.stdout), false, 'no next: move hint');
  assert.equal(
    /or agora suspend/.test(r.stdout),
    false,
    'no or-suspend hint',
  );
});

test('agora move (json): suggested_next stays for orchestrators', (t) => {
  // The text-mode hint is gone; the JSON envelope is unchanged so any
  // tool layer dispatching on `suggested_next` keeps working.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  setup(root);
  run(AGORA, root, ['new', '--slug', 'flow2'], { GUILD_ACTOR: 'alice' });
  run(AGORA, root, ['play', '--slug', 'flow2'], { GUILD_ACTOR: 'alice' });
  const playId = readdirSync(join(root, 'agora', 'plays', 'flow2'))[0]!.replace(/\.yaml$/, '');

  const r = run(
    AGORA,
    root,
    ['move', playId, '--text', 'first move', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout) as {
    suggested_next: { verb: string; args: { play_id: string } };
  };
  assert.equal(payload.suggested_next.verb, 'move');
  assert.equal(payload.suggested_next.args.play_id, playId);
});
