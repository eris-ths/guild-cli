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

// -------------------- GUILD_CONFIG env override (#308 Layer A) --------------------

test('GuildConfig.load: GUILD_CONFIG env overrides cwd walk-up', () => {
  const { dir, cleanup } = setupRepo();
  try {
    // Substrate at <dir>/parent — what the orchestrator owns.
    const parent = join(dir, 'parent');
    mkdirSync(parent);
    writeFileSync(
      join(parent, 'guild.config.yaml'),
      'content_root: .\nhost_names: [eris]\n',
    );
    // Worktree at <dir>/elsewhere — no walk-up reaches the parent.
    const worktree = join(dir, 'elsewhere');
    mkdirSync(worktree);
    const prev = process.env['GUILD_CONFIG'];
    process.env['GUILD_CONFIG'] = join(parent, 'guild.config.yaml');
    try {
      const cfg = GuildConfig.load(worktree);
      assert.equal(cfg.configFile, join(parent, 'guild.config.yaml'));
      assert.equal(cfg.contentRoot, parent);
      assert.deepEqual(cfg.hostNames, ['eris']);
    } finally {
      if (prev === undefined) delete process.env['GUILD_CONFIG'];
      else process.env['GUILD_CONFIG'] = prev;
    }
  } finally {
    cleanup();
  }
});

test('GuildConfig.load: GUILD_CONFIG with nonexistent path throws DomainError', () => {
  const prev = process.env['GUILD_CONFIG'];
  process.env['GUILD_CONFIG'] = '/nonexistent/guild.config.yaml';
  try {
    assert.throws(
      () => GuildConfig.load(),
      /GUILD_CONFIG="\/nonexistent\/guild.config.yaml" does not exist/,
    );
  } finally {
    if (prev === undefined) delete process.env['GUILD_CONFIG'];
    else process.env['GUILD_CONFIG'] = prev;
  }
});

test('GuildConfig.load: empty GUILD_CONFIG falls back to walk-up (treated as unset)', () => {
  const { dir, cleanup } = setupRepo();
  try {
    writeFileSync(
      join(dir, 'guild.config.yaml'),
      'content_root: .\nhost_names: [nao]\n',
    );
    const prev = process.env['GUILD_CONFIG'];
    process.env['GUILD_CONFIG'] = '';
    // Capture stderr to verify the footgun-nudge fires.
    const origStderr = process.stderr.write.bind(process.stderr);
    let captured = '';
    process.stderr.write = ((s: string | Uint8Array) => {
      captured += typeof s === 'string' ? s : Buffer.from(s).toString();
      return true;
    }) as typeof process.stderr.write;
    try {
      const cfg = GuildConfig.load(dir);
      // empty string is treated as unset; walk-up finds the local config
      assert.equal(cfg.configFile, join(dir, 'guild.config.yaml'));
      // ...AND a one-line nudge surfaces the footgun (caller likely
      // wanted to clear the override but used `=` instead of `unset`).
      assert.match(captured, /GUILD_CONFIG is set but empty/);
      assert.match(captured, /unset GUILD_CONFIG/);
    } finally {
      process.stderr.write = origStderr;
      if (prev === undefined) delete process.env['GUILD_CONFIG'];
      else process.env['GUILD_CONFIG'] = prev;
    }
  } finally {
    cleanup();
  }
});
