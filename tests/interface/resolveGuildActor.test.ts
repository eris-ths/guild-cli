// Cover the env → .guild-actor file → undefined resolution chain.
//
// Surfaced by issue i-2026-05-03-0001 (develop-branch dogfood):
// .envrc relies on a configured shell, but Claude Code's Bash tool
// spawns fresh subprocesses, so env never propagates. The
// .guild-actor file fallback closes the gap without breaking
// existing env-based shells (env still wins).
//
// Resolution order tested here:
//   1. process.env.GUILD_ACTOR (legacy contract)
//   2. .guild-actor file in cwd or any ancestor (NEW)
//   3. undefined

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveGuildActor } from '../../src/interface/shared/resolveGuildActor.js';

function withEnv(actor: string | undefined, fn: () => void): void {
  const prev = process.env['GUILD_ACTOR'];
  if (actor === undefined) delete process.env['GUILD_ACTOR'];
  else process.env['GUILD_ACTOR'] = actor;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env['GUILD_ACTOR'];
    else process.env['GUILD_ACTOR'] = prev;
  }
}

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-actor-resolve-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('env wins when set and non-empty', () => {
  const { root, cleanup } = bootstrap();
  try {
    writeFileSync(join(root, '.guild-actor'), 'from-file');
    withEnv('from-env', () => {
      assert.equal(resolveGuildActor(root), 'from-env');
    });
  } finally {
    cleanup();
  }
});

test('file fallback fires when env is unset', () => {
  const { root, cleanup } = bootstrap();
  try {
    writeFileSync(join(root, '.guild-actor'), 'from-file');
    withEnv(undefined, () => {
      assert.equal(resolveGuildActor(root), 'from-file');
    });
  } finally {
    cleanup();
  }
});

test('file fallback fires when env is empty string', () => {
  // process.env stores values as strings; empty string is treated
  // the same as unset (legacy `envVal && envVal.length > 0` guard).
  const { root, cleanup } = bootstrap();
  try {
    writeFileSync(join(root, '.guild-actor'), 'from-file');
    withEnv('', () => {
      assert.equal(resolveGuildActor(root), 'from-file');
    });
  } finally {
    cleanup();
  }
});

test('file content is trimmed (newlines, surrounding whitespace)', () => {
  const { root, cleanup } = bootstrap();
  try {
    writeFileSync(join(root, '.guild-actor'), '  alice\n');
    withEnv(undefined, () => {
      assert.equal(resolveGuildActor(root), 'alice');
    });
  } finally {
    cleanup();
  }
});

test('empty file falls through (treated as not set)', () => {
  const { root, cleanup } = bootstrap();
  try {
    writeFileSync(join(root, '.guild-actor'), '');
    withEnv(undefined, () => {
      assert.equal(resolveGuildActor(root), undefined);
    });
  } finally {
    cleanup();
  }
});

test('whitespace-only file falls through', () => {
  const { root, cleanup } = bootstrap();
  try {
    writeFileSync(join(root, '.guild-actor'), '   \n  \t  ');
    withEnv(undefined, () => {
      assert.equal(resolveGuildActor(root), undefined);
    });
  } finally {
    cleanup();
  }
});

test('ancestor walking — file in parent dir is found from child cwd', () => {
  const { root, cleanup } = bootstrap();
  try {
    const child = join(root, 'a', 'b', 'c');
    mkdirSync(child, { recursive: true });
    writeFileSync(join(root, '.guild-actor'), 'ancestral');
    withEnv(undefined, () => {
      assert.equal(resolveGuildActor(child), 'ancestral');
    });
  } finally {
    cleanup();
  }
});

test('nearest ancestor wins when multiple .guild-actor files in path', () => {
  const { root, cleanup } = bootstrap();
  try {
    const child = join(root, 'a', 'b');
    mkdirSync(child, { recursive: true });
    writeFileSync(join(root, '.guild-actor'), 'far');
    writeFileSync(join(root, 'a', '.guild-actor'), 'near');
    withEnv(undefined, () => {
      assert.equal(resolveGuildActor(child), 'near');
    });
  } finally {
    cleanup();
  }
});

test('returns undefined when neither env nor any ancestor file exists', () => {
  const { root, cleanup } = bootstrap();
  try {
    withEnv(undefined, () => {
      // No .guild-actor written, no env set.
      // Walk-up will hit root (filesystem root) and stop. tmpdir's
      // parent chain has no .guild-actor (we hope; if a system-wide
      // file exists this test would surface it as a real environmental
      // contamination — which is a feature, not a bug).
      const result = resolveGuildActor(root);
      assert.equal(result, undefined);
    });
  } finally {
    cleanup();
  }
});

test('default start defaults to process.cwd() when no arg passed', () => {
  // Smoke: just check the call doesn't throw and returns string|undefined.
  withEnv('cwd-test', () => {
    const result = resolveGuildActor();
    assert.equal(result, 'cwd-test');
  });
});
