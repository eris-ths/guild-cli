import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GuildConfig } from '../../src/infrastructure/config/GuildConfig.js';

/**
 * GuildConfig.load() / findConfig() must discover both supported
 * placements:
 *
 *   <repo>/guild.config.yaml                   — legacy / THS-style
 *   <repo>/.gate-sessions/guild.config.yaml    — in-repo convention
 *                                                 (projector, yori-code)
 *
 * `.gate-sessions/` takes precedence when both exist (in-repo
 * convention is the more recent and the more containment-friendly).
 */

function setupRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'guild-cli-cfg-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('GuildConfig.load: discovers <repo>/guild.config.yaml at top level', () => {
  const { dir, cleanup } = setupRepo();
  try {
    writeFileSync(
      join(dir, 'guild.config.yaml'),
      'content_root: .\nhost_names: [nao]\n',
    );
    const cfg = GuildConfig.load(dir);
    assert.equal(cfg.configFile, join(dir, 'guild.config.yaml'));
    assert.equal(cfg.contentRoot, dir);
  } finally {
    cleanup();
  }
});

test('GuildConfig.load: discovers <repo>/.gate-sessions/guild.config.yaml', () => {
  const { dir, cleanup } = setupRepo();
  try {
    const sub = join(dir, '.gate-sessions');
    mkdirSync(sub);
    writeFileSync(
      join(sub, 'guild.config.yaml'),
      'content_root: .\nhost_names: [nao]\n',
    );
    const cfg = GuildConfig.load(dir);
    assert.equal(cfg.configFile, join(sub, 'guild.config.yaml'));
    // content_root: . resolves relative to the config file's directory,
    // so it points at .gate-sessions/ — that's where projector and
    // yori-code put members/requests/issues/inbox.
    assert.equal(cfg.contentRoot, sub);
  } finally {
    cleanup();
  }
});

test('GuildConfig.load: .gate-sessions/ takes precedence over top-level when both exist', () => {
  const { dir, cleanup } = setupRepo();
  try {
    writeFileSync(
      join(dir, 'guild.config.yaml'),
      'content_root: .\nhost_names: [legacy]\n',
    );
    const sub = join(dir, '.gate-sessions');
    mkdirSync(sub);
    writeFileSync(
      join(sub, 'guild.config.yaml'),
      'content_root: .\nhost_names: [in_repo]\n',
    );
    const cfg = GuildConfig.load(dir);
    assert.equal(cfg.configFile, join(sub, 'guild.config.yaml'));
    assert.deepEqual(cfg.hostNames, ['in_repo']);
  } finally {
    cleanup();
  }
});

test('GuildConfig.load: walks up parents to find .gate-sessions/ from a nested cwd', () => {
  const { dir, cleanup } = setupRepo();
  try {
    const sub = join(dir, '.gate-sessions');
    mkdirSync(sub);
    writeFileSync(
      join(sub, 'guild.config.yaml'),
      'content_root: .\nhost_names: [nao]\n',
    );
    const nested = join(dir, 'packages', 'engine', 'src');
    mkdirSync(nested, { recursive: true });
    const cfg = GuildConfig.load(nested);
    assert.equal(cfg.configFile, join(sub, 'guild.config.yaml'));
  } finally {
    cleanup();
  }
});
