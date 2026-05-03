// gate boot — JSON shape stability snapshot.
//
// The boot payload is the contract agents depend on for orientation.
// This test pins the top-level keys; field additions are allowed
// (they're forward-compatible), but renames/removals must bump the
// version per POLICY.md's strict 0.x.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// At runtime this file lives under dist/tests/interface/, so we walk
// three levels up (interface → tests → dist → repo root) to reach bin/.
const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-boot-'));
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

function runGate(cwd: string, args: string[], env: Record<string, string> = {}): { stdout: string; status: number } {
  const result = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { stdout: result.stdout, status: result.status ?? -1 };
}

test('gate boot: JSON top-level keys are stable', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout, status } = runGate(root, ['boot']);
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);
    // Sorted so the failure diff is stable when a key is added/removed.
    const keys = Object.keys(payload).sort();
    assert.deepEqual(
      keys,
      [
        'actor',
        'cross_passage',
        'hints',
        'inbox_unread',
        'last_activity',
        'role',
        'status',
        'suggested_next',
        'tail',
        'verbs_available_now',
        'your_recent',
      ],
      'boot payload top-level keys changed — agents depend on this contract',
    );
  } finally {
    cleanup();
  }
});

test('gate boot: actor=null when GUILD_ACTOR is not set', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: '' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.actor, null);
    assert.equal(payload.role, null);
    assert.equal(payload.your_recent, null);
  } finally {
    cleanup();
  }
});

test('gate boot: actor identity resolved when GUILD_ACTOR is a member', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.actor, 'alice');
    assert.equal(payload.role, 'member');
    assert.ok(Array.isArray(payload.your_recent));
  } finally {
    cleanup();
  }
});

test('gate boot: role=host when GUILD_ACTOR is in host_names', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'human' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.actor, 'human');
    assert.equal(payload.role, 'host');
  } finally {
    cleanup();
  }
});

test('gate boot: --format text renders a human-readable summary', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout, status } = runGate(root, ['boot', '--format', 'text']);
    assert.equal(status, 0);
    assert.match(stdout, /boot|queues:/);
  } finally {
    cleanup();
  }
});

test('gate boot: misconfigured_cwd is false when config + members exist', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['boot']);
    const payload = JSON.parse(stdout);
    assert.equal(payload.hints.misconfigured_cwd, false);
    assert.equal(typeof payload.hints.config_file, 'string');
    assert.match(payload.hints.config_file, /guild\.config\.yaml$/);
    assert.equal(typeof payload.hints.resolved_content_root, 'string');
  } finally {
    cleanup();
  }
});

test('gate boot: misconfigured_cwd IS true when no config found AND no data', () => {
  // No guild.config.yaml written — cwd falls back to itself, and
  // there is no members/ nor requests/ either.
  const empty = mkdtempSync(join(tmpdir(), 'guild-empty-'));
  try {
    const { stdout, status } = runGate(empty, ['boot']);
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);
    assert.equal(payload.hints.misconfigured_cwd, true);
    assert.equal(payload.hints.config_file, null);
    // text format surfaces the warning so interactive users see it too.
    const { stdout: textOut } = runGate(empty, ['boot', '--format', 'text']);
    assert.match(textOut, /no guild\.config\.yaml found/);
    assert.match(textOut, /likely wrong cwd/);
    assert.match(textOut, /cd into/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('gate boot: content_root_health reports clean when everything hydrates', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['boot']);
    const payload = JSON.parse(stdout);
    const h = payload.hints.content_root_health;
    assert.equal(h.malformed_count, 0);
    assert.equal(h.fix_hint, null);
    assert.ok(Array.isArray(h.areas));
    // text output must NOT print the malformed-record warning block
    const { stdout: textOut } = runGate(root, ['boot', '--format', 'text']);
    assert.doesNotMatch(textOut, /malformed record/);
  } finally {
    cleanup();
  }
});

test('gate boot: content_root_health surfaces malformed records with a fix hint', () => {
  // Seed a request with an invalid lense so hydration fails;
  // the ID pattern must match YamlRequestRepository's listAll filter
  // (YYYY-MM-DD-NNN[N]), otherwise the file is filtered out before
  // hydration even attempts it — a subtlety worth asserting against.
  const { root, cleanup } = bootstrap();
  try {
    mkdirSync(join(root, 'requests', 'completed'), { recursive: true });
    writeFileSync(
      join(root, 'requests', 'completed', '2099-04-17-9999.yaml'),
      [
        'id: 2099-04-17-9999',
        'created: 2099-04-17T10:00:00.000Z',
        'from: alice',
        'action: test',
        'reason: malformed probe',
        'executor_preferred: null',
        'executor_actual: alice',
        'contract: null',
        'target: null',
        'auto_review: null',
        'status_log:',
        '  - state: pending',
        '    at: 2099-04-17T10:00:00.000Z',
        '    by: alice',
        '    note: probe',
        'reviews:',
        '  - by: alice',
        '    at: 2099-04-17T10:00:01.000Z',
        '    lense: not_a_real_lense',
        '    verdict: ok',
        '    comment: test',
        '',
      ].join('\n'),
    );
    const { stdout } = runGate(root, ['boot']);
    const payload = JSON.parse(stdout);
    const h = payload.hints.content_root_health;
    assert.ok(h.malformed_count >= 1);
    assert.ok(typeof h.fix_hint === 'string');
    assert.match(h.fix_hint, /gate doctor/);
    assert.match(h.fix_hint, /gate repair --apply/);
    // text output surfaces the warning and the concrete fix commands
    const { stdout: textOut } = runGate(root, ['boot', '--format', 'text']);
    assert.match(textOut, /malformed record/);
    assert.match(textOut, /gate doctor/);
    assert.match(textOut, /gate repair --apply/);
  } finally {
    cleanup();
  }
});

test('gate boot: fresh-start (config present, 0 members/requests) is NOT flagged', () => {
  // Bootstrap a content_root with config and an empty members dir.
  // This is a legitimate fresh start — warning would scare new users.
  const fresh = mkdtempSync(join(tmpdir(), 'guild-fresh-'));
  try {
    writeFileSync(
      join(fresh, 'guild.config.yaml'),
      'content_root: .\nhost_names: [human]\n',
    );
    mkdirSync(join(fresh, 'members'));
    const { stdout } = runGate(fresh, ['boot']);
    const payload = JSON.parse(stdout);
    assert.equal(payload.hints.misconfigured_cwd, false);
    assert.equal(typeof payload.hints.config_file, 'string');
    // Text output must NOT contain the misconfig warning.
    const { stdout: textOut } = runGate(fresh, ['boot', '--format', 'text']);
    assert.doesNotMatch(textOut, /no guild\.config\.yaml found/);
  } finally {
    rmSync(fresh, { recursive: true, force: true });
  }
});

test('gate boot: suggested_next=register when no actor and no members', () => {
  const root = mkdtempSync(join(tmpdir(), 'guild-boot-fresh-'));
  writeFileSync(join(root, 'guild.config.yaml'), 'content_root: .\n');
  mkdirSync(join(root, 'members'));
  try {
    const { stdout } = runGate(root, ['boot']);
    const payload = JSON.parse(stdout);
    assert.equal(payload.actor, null);
    assert.equal(payload.suggested_next?.verb, 'register');
    const { stdout: textOut } = runGate(root, ['boot', '--format', 'text']);
    assert.match(textOut, /gate register --name/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('gate boot: suggested_next=export when no actor but members exist', () => {
  // Returning-user case: members exist, but GUILD_ACTOR isn't set.
  // The hint names existing members and the export path.
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['boot']);
    const payload = JSON.parse(stdout);
    assert.equal(payload.suggested_next?.verb, 'export');
    assert.match(payload.suggested_next?.reason ?? '', /alice/);
  } finally {
    cleanup();
  }
});

test('gate boot: suggested_next=register when GUILD_ACTOR set but unregistered', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'newbie' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.role, 'unknown');
    assert.equal(payload.suggested_next?.verb, 'register');
    assert.equal(payload.suggested_next?.args?.name, 'newbie');
  } finally {
    cleanup();
  }
});

test('gate boot: suggested_next=null for registered member', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.role, 'member');
    assert.equal(payload.suggested_next, null);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------
// content_root disclosure (designed in 2026-05-01-0001/0002).
//
// Pre-fix, `gate boot --format text` showed neither config_file
// nor resolved_content_root, so an agent who ran gate from a
// subdir of an active guild — the silent parent-config-pickup
// gap PR #108 closed on the WRITE side — got no signal on the
// READ side either. The fix surfaces the orientation line ONLY
// when the situation is surprising (subdir / no-config), keeping
// the 99% normal run quiet (voice budget). JSON payload now
// carries the boolean `cwd_outside_content_root` for
// orchestrators.
// ---------------------------------------------------------------

test('gate boot text: aligned cwd (cwd === content_root) emits NO content-root disclosure', () => {
  // Voice budget: the 99% case (operator at the guild root) stays
  // exactly as it was. Pin the absence so a future "always
  // disclose" refactor can't regress the noise level.
  const { root, cleanup } = bootstrap();
  try {
    const { stdout, status } = runGate(
      root,
      ['boot', '--format', 'text'],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(status, 0);
    assert.doesNotMatch(stdout, /^content root:/m);
  } finally {
    cleanup();
  }
});

test('gate boot text: subdir of active guild discloses content_root + parent config', () => {
  // The case PR #108 closed on the write side. boot is the
  // orientation surface — agents running boot to "see where I am"
  // need the same disclosure.
  const { root, cleanup } = bootstrap();
  try {
    const sub = join(root, 'sub');
    mkdirSync(sub);
    const { stdout, status } = runGate(
      sub,
      ['boot', '--format', 'text'],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(status, 0);
    assert.match(
      stdout,
      // Line shape matches PR #108's `(config: ...)` segment for
      // cross-verb recognition.
      new RegExp(
        `^content root: ${escapeRegex(root)} \\(config: ${escapeRegex(join(root, 'guild.config.yaml'))}\\)$`,
        'm',
      ),
    );
  } finally {
    cleanup();
  }
});

test('gate boot text: no-config-found case discloses cwd-as-fallback', () => {
  // The other half of the gap: an agent in /tmp/foo with no
  // parent guild gets cwd silently used as content_root. Pre-fix
  // they had no signal that the implicit default was in play.
  // Post-fix the line names it: `(config: none — cwd used as
  // fallback root)`. The misconfigured_cwd block (no-config + no-
  // data) keeps its bigger warning; this fires for the no-config
  // + has-data case (someone deliberately using cwd as root).
  const root = mkdtempSync(join(tmpdir(), 'guild-boot-nocfg-'));
  try {
    // Plant a member so we're past the misconfigured_cwd trigger.
    mkdirSync(join(root, 'members'));
    writeFileSync(
      join(root, 'members', 'solo.yaml'),
      'name: solo\ncategory: professional\nactive: true\n',
    );
    const { stdout, status } = runGate(
      root,
      ['boot', '--format', 'text'],
      { GUILD_ACTOR: 'solo' },
    );
    assert.equal(status, 0);
    assert.match(
      stdout,
      new RegExp(
        `^content root: ${escapeRegex(root)} \\(config: none — cwd used as fallback root\\)$`,
        'm',
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('gate boot JSON: cwd_outside_content_root flag distinguishes aligned from subdir', () => {
  // Orchestrator contract: the disclosure also reaches MCP via a
  // structured boolean, not just the text rendering. Pin both
  // truth values so a future refactor can't drop the field.
  const { root, cleanup } = bootstrap();
  try {
    // aligned: cwd === root → false
    const aligned = JSON.parse(
      runGate(root, ['boot'], { GUILD_ACTOR: 'alice' }).stdout,
    );
    assert.equal(aligned.hints.cwd_outside_content_root, false);

    // subdir: cwd is one level deeper → true
    const sub = join(root, 'sub');
    mkdirSync(sub);
    const subdir = JSON.parse(
      runGate(sub, ['boot'], { GUILD_ACTOR: 'alice' }).stdout,
    );
    assert.equal(subdir.hints.cwd_outside_content_root, true);
  } finally {
    cleanup();
  }
});

test('gate boot text: misconfigured_cwd block suppresses content_root disclosure (no double-up)', () => {
  // When misconfigured_cwd fires (no config + no data), the bigger
  // warning block already discloses the resolved path. The new
  // disclosure must NOT also fire — voice budget says one
  // surface owns the disclosure at a time.
  const root = mkdtempSync(join(tmpdir(), 'guild-boot-misconf-'));
  try {
    const { stdout } = runGate(
      root,
      ['boot', '--format', 'text'],
      { GUILD_ACTOR: '' },
    );
    assert.match(stdout, /no guild.config.yaml found/);
    // The new line must NOT fire alongside the bigger warning.
    assert.doesNotMatch(stdout, /^content root:/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
