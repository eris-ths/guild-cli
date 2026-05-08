// gate boot — JSON shape stability snapshot.
//
// The boot payload is the contract agents depend on for orientation.
// This test pins the top-level keys; field additions are allowed
// (they're forward-compatible), but renames/removals must bump the
// version per POLICY.md's strict 0.x.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

// At runtime this file lives under dist/tests/interface/, so we walk
// three levels up (interface → tests → dist → repo root) to reach bin/.
const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = makeTempRoot('guild-boot-');
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
        'active_overlapping_targets',
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
  const root = makeTempRoot('guild-boot-nocfg-');
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

// Default tail size pin. Bumped 10→5 with principle 13 in mind:
// boot is bootstrap-shape, called every session start, so the
// orientation payload sits on the hot path. Smaller default keeps
// JSON lean (~200 vs ~250 lines pretty-printed); callers that want
// deeper history pass `--tail <N>` explicitly. If this test fails
// because the default moved again, update both this assertion AND
// the rationale comment in src/interface/gate/handlers/boot.ts.
test('gate boot: default tail returns 5 entries (lean default)', () => {
  const { root, cleanup } = bootstrap();
  try {
    // Seed 8 requests so a default of 5 (or 10) is observable.
    for (let i = 0; i < 8; i++) {
      const { status } = runGate(
        root,
        ['request', '--action', `seed ${i}`, '--reason', 'tail-default pin'],
        { GUILD_ACTOR: 'alice' },
      );
      assert.equal(status, 0, `seed ${i} failed`);
    }
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    assert.equal(
      payload.tail.length,
      5,
      'gate boot default tail size — change requires updating boot.ts rationale comment',
    );
  } finally {
    cleanup();
  }
});

test('gate boot: --tail <N> overrides the default', () => {
  const { root, cleanup } = bootstrap();
  try {
    for (let i = 0; i < 8; i++) {
      runGate(
        root,
        ['request', '--action', `seed ${i}`, '--reason', 'override pin'],
        { GUILD_ACTOR: 'alice' },
      );
    }
    const { stdout } = runGate(root, ['boot', '--tail', '8'], {
      GUILD_ACTOR: 'alice',
    });
    const payload = JSON.parse(stdout);
    assert.equal(payload.tail.length, 8, '--tail <N> override broken');
  } finally {
    cleanup();
  }
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------
// reviewed-authored surface (designed in 2026-05-06-0001).
//
// When peers land reviews on a request the actor authored, boot
// lifts them via verbs_available_now.actionable[] (verb=show) and
// suggested_next (when no higher-priority transition is open).
// Boundary scope is the Request aggregate: status_log / reviews /
// thanks all advance it. Message/issue writes do NOT advance it.
//
// Tests below pin the gap-1 (thanks integration), gap-2 (cap), and
// the higher-priority-suppression invariant Devil v3 ratify named.
// ---------------------------------------------------------------

function bootstrapWithMembers(): { root: string; cleanup: () => void } {
  // Two-member fixture so reviewer != author. alice authors, bob
  // reviews — the minimal shape the reviewed-authored predicate
  // needs.
  const root = mkdtempSync(join(tmpdir(), 'guild-boot-rev-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  writeFileSync(
    join(root, 'members', 'bob.yaml'),
    'name: bob\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('gate boot: reviewed-authored surfaces when peer reviews land on authored request', () => {
  const { root, cleanup } = bootstrapWithMembers();
  try {
    // alice authors a fast-track (reaches completed in one shot).
    const filed = runGate(
      root,
      [
        'fast-track',
        '--action',
        'demo work',
        '--reason',
        'reviewed-authored pin',
        '--format',
        'json',
      ],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(filed.status, 0);
    const id = JSON.parse(filed.stdout).id;
    // bob reviews. bob's review is the boundary-crossing event.
    const reviewed = runGate(
      root,
      [
        'review',
        id,
        '--lense',
        'devil',
        '--verdict',
        'ok',
        '--comment',
        'lgtm',
      ],
      { GUILD_ACTOR: 'bob' },
    );
    assert.equal(reviewed.status, 0);

    // alice boots — should see reviewed-authored.
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.suggested_next?.verb, 'show');
    assert.equal(payload.suggested_next?.args?.id, id);
    assert.match(payload.suggested_next?.reason ?? '', /you authored/);
    assert.match(payload.suggested_next?.reason ?? '', /1 review/);
    assert.equal(payload.status.reviews_unseen, 1);

    // actionable[] mirrors it.
    const actionable = payload.verbs_available_now.actionable;
    assert.ok(
      actionable.some(
        (a: { verb: string; id: string }) => a.verb === 'show' && a.id === id,
      ),
      'reviewed-authored entry must appear in actionable[]',
    );
  } finally {
    cleanup();
  }
});

test('gate boot: reviewed-authored boundary advances when author writes a thank (gap-1)', () => {
  // Devil v3 concern: addThank does not touch status_log, so a
  // thanks-only response from the author would not advance the
  // boundary in v2. Pin that v3's thanks integration prevents the
  // surface from sticking after the author thanks the reviewer.
  const { root, cleanup } = bootstrapWithMembers();
  try {
    const filed = runGate(
      root,
      [
        'fast-track',
        '--action',
        'thanks-advances-boundary',
        '--reason',
        'gap-1 regression pin',
        '--format',
        'json',
      ],
      { GUILD_ACTOR: 'alice' },
    );
    const id = JSON.parse(filed.stdout).id;
    runGate(
      root,
      [
        'review',
        id,
        '--lense',
        'devil',
        '--verdict',
        'ok',
        '--comment',
        'lgtm',
      ],
      { GUILD_ACTOR: 'bob' },
    );
    // Confirm surface is up before the thank.
    const before = JSON.parse(
      runGate(root, ['boot'], { GUILD_ACTOR: 'alice' }).stdout,
    );
    assert.equal(before.suggested_next?.verb, 'show');
    assert.equal(before.status.reviews_unseen, 1);

    // alice thanks bob. addThank pushes onto thanks[] (no status_log
    // touch). v3 boundary computes lastAuthoredWriteAt over thanks[]
    // too, so the surface must clear.
    const thanked = runGate(
      root,
      ['thank', 'bob', '--for', id, '--reason', 'thanks for the review'],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(thanked.status, 0);

    const after = JSON.parse(
      runGate(root, ['boot'], { GUILD_ACTOR: 'alice' }).stdout,
    );
    // suggested_next must no longer point at this id (no other open
    // loops in this fixture, so it should be null).
    assert.equal(
      after.suggested_next,
      null,
      'thank by author must advance boundary so reviewed-authored clears',
    );
    assert.ok(
      !('reviews_unseen' in after.status) || after.status.reviews_unseen === 0,
      'reviews_unseen must be cleared (or absent) after thank',
    );
    const actionable = after.verbs_available_now.actionable as Array<{
      verb: string;
      id: string;
    }>;
    assert.ok(
      !actionable.some((a) => a.verb === 'show' && a.id === id),
      'actionable[] must drop the reviewed-authored entry after thank',
    );
  } finally {
    cleanup();
  }
});

test('gate boot: reviewed-authored actionable[] is capped at 5 entries', () => {
  // Voice budget: an actor with N authored × M reviews could balloon
  // the boot payload — boot is on the hot path. Cap actionable[] to
  // 5; the running total still surfaces via status.reviews_unseen.
  const { root, cleanup } = bootstrapWithMembers();
  try {
    const ids: string[] = [];
    // 7 authored requests by alice — file ALL of them first, THEN
    // bob reviews each. If we interleaved (fast-track then review,
    // repeat), each subsequent fast-track would advance alice's
    // boundary (status_log write) past the prior review, and only
    // the most recent review would remain "unseen". Batching keeps
    // every review strictly after alice's last write, which is the
    // shape the cap is protecting against.
    for (let i = 0; i < 7; i++) {
      const filed = runGate(
        root,
        [
          'fast-track',
          '--action',
          `cap probe ${i}`,
          '--reason',
          'cap-5 pin',
          '--format',
          'json',
        ],
        { GUILD_ACTOR: 'alice' },
      );
      assert.equal(filed.status, 0);
      ids.push(JSON.parse(filed.stdout).id);
    }
    for (const id of ids) {
      const reviewed = runGate(
        root,
        [
          'review',
          id,
          '--lense',
          'devil',
          '--verdict',
          'ok',
          '--comment',
          'lgtm',
        ],
        { GUILD_ACTOR: 'bob' },
      );
      assert.equal(reviewed.status, 0);
    }

    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    const showEntries = (
      payload.verbs_available_now.actionable as Array<{ verb: string }>
    ).filter((a) => a.verb === 'show');
    assert.equal(
      showEntries.length,
      5,
      'reviewed-authored entries in actionable[] must be capped at 5',
    );
    // Running total must reflect the full 7, not the capped view.
    assert.equal(payload.status.reviews_unseen, 7);
  } finally {
    cleanup();
  }
});

test('gate boot: reviewed-authored is suppressed when a higher-priority transition is open', () => {
  // Devil v3 ratify invariant: reviewed-authored sits at PRIORITY=4,
  // appended only when the four state-transition kinds are empty.
  // If alice has an executing-mine alongside a reviewed authored
  // request, suggested_next must point at complete, not show.
  const { root, cleanup } = bootstrapWithMembers();
  try {
    // Path A: authored request that gets a peer review (no exec to alice).
    const filedA = runGate(
      root,
      [
        'fast-track',
        '--action',
        'reviewed (low priority)',
        '--reason',
        'priority pin',
        '--format',
        'json',
      ],
      { GUILD_ACTOR: 'alice' },
    );
    const idA = JSON.parse(filedA.stdout).id;
    runGate(
      root,
      [
        'review',
        idA,
        '--lense',
        'devil',
        '--verdict',
        'ok',
        '--comment',
        'lgtm',
      ],
      { GUILD_ACTOR: 'bob' },
    );

    // Path B: a request that ends up executing-by-alice. Use the
    // four-step lifecycle so we can stop at executing.
    const filedB = runGate(
      root,
      [
        'request',
        '--action',
        'executing (high priority)',
        '--reason',
        'priority pin',
        '--executor',
        'alice',
        '--format',
        'json',
      ],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(filedB.status, 0);
    const idB = JSON.parse(filedB.stdout).id;
    // Approve as host, then execute as alice.
    const approved = runGate(root, ['approve', idB], { GUILD_ACTOR: 'human' });
    assert.equal(approved.status, 0);
    const executed = runGate(root, ['execute', idB], { GUILD_ACTOR: 'alice' });
    assert.equal(executed.status, 0);

    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    // Highest-priority transition wins suggested_next.
    assert.equal(payload.suggested_next?.verb, 'complete');
    assert.equal(payload.suggested_next?.args?.id, idB);
    // reviewed-authored must NOT contaminate actionable[] when
    // transitions are present (the if-guard is `out.length === 0`).
    const actionable = payload.verbs_available_now.actionable as Array<{
      verb: string;
      id: string;
    }>;
    assert.ok(
      !actionable.some((a) => a.verb === 'show' && a.id === idA),
      'reviewed-authored must be suppressed when state-transition work is pending',
    );
  } finally {
    cleanup();
  }
});

test('computeLastAuthoredWriteAt aggregates across status_log, reviews, and thanks', async () => {
  // Direct unit test — bypass the CLI to assert the aggregation
  // independently of the boot wiring. status_log (transitions),
  // reviews[] (judgements), and thanks[] (appreciation) all
  // contribute to the boundary. Latest of the three wins.
  const { computeLastAuthoredWriteAt } = await import(
    // Sibling-test pattern: source-relative spec, resolves to
    // dist/src after tsc emit (matches schema.test.ts, voices.test.ts).
    '../../src/interface/gate/handlers/boot.js'
  );

  // Stub `Request`-shaped objects with just the getters
  // computeLastAuthoredWriteAt reads. Plain objects suffice — the
  // function uses no Request methods, only the three array getters.
  // Mirror the in-memory shape: status_log carries `by: string` (raw
  // shape on entries), while reviews[]/thanks[] expose `by: MemberName`
  // via getters — so the stub uses `{ value }` for those.
  type MemberNameStub = { value: string };
  type Stub = {
    statusLog: ReadonlyArray<{ by: string; at: string }>;
    reviews: ReadonlyArray<{ by: MemberNameStub; at: string }>;
    thanks: ReadonlyArray<{ by: MemberNameStub; at: string }>;
  };
  const stubs: Stub[] = [
    {
      statusLog: [{ by: 'alice', at: '2026-05-01T10:00:00.000Z' }],
      reviews: [{ by: { value: 'alice' }, at: '2026-05-02T10:00:00.000Z' }],
      thanks: [{ by: { value: 'alice' }, at: '2026-05-03T10:00:00.000Z' }],
    },
    {
      statusLog: [{ by: 'bob', at: '2026-05-04T10:00:00.000Z' }],
      reviews: [],
      thanks: [],
    },
  ];

  const lastAlice = computeLastAuthoredWriteAt(
    'alice',
    stubs as unknown as Parameters<typeof computeLastAuthoredWriteAt>[1],
  );
  // Latest of the three alice writes is the thank at 2026-05-03.
  assert.equal(lastAlice, '2026-05-03T10:00:00.000Z');

  // bob has no thanks/reviews; only status_log contributes.
  const lastBob = computeLastAuthoredWriteAt(
    'bob',
    stubs as unknown as Parameters<typeof computeLastAuthoredWriteAt>[1],
  );
  assert.equal(lastBob, '2026-05-04T10:00:00.000Z');

  // Actor with no writes anywhere yields null.
  const lastNobody = computeLastAuthoredWriteAt(
    'nobody',
    stubs as unknown as Parameters<typeof computeLastAuthoredWriteAt>[1],
  );
  assert.equal(lastNobody, null);
});

// active_overlapping_targets — cross-session race surface (#234).
//
// Surfaces active (pending|approved|executing) requests that share
// the same `target` so a booting agent sees "someone else is on
// it" before pre-empting. Phase 1: detection + warning, no refuse.
// Refuse-on-create lives with #227 (swarm profile epic).

function registerMember(root: string, name: string): void {
  runGate(root, ['register', '--name', name]);
}

function makeRequestWithTarget(
  root: string,
  from: string,
  action: string,
  target: string,
): string {
  const r = spawnSync(
    process.execPath,
    [
      GATE,
      'request',
      '--from', from,
      '--action', action,
      '--reason', 'overlap test',
      '--target', target,
      '--format', 'json',
    ],
    { cwd: root, env: { ...process.env }, encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(`gate request failed: ${r.stderr}`);
  }
  const j = JSON.parse(r.stdout);
  return j.id ?? j.request_id;
}

test('gate boot: active_overlapping_targets surfaces two pending requests on the same target', () => {
  const { root, cleanup } = bootstrap();
  try {
    registerMember(root, 'leysia');
    const id1 = makeRequestWithTarget(root, 'alice', 'work A', 'data/guild/templates');
    const id2 = makeRequestWithTarget(root, 'leysia', 'work B', 'data/guild/templates');

    const { stdout } = runGate(root, ['boot']);
    const payload = JSON.parse(stdout);
    assert.equal(Array.isArray(payload.active_overlapping_targets), true);
    assert.equal(payload.active_overlapping_targets.length, 1);
    const entry = payload.active_overlapping_targets[0];
    assert.equal(entry.target, 'data/guild/templates');
    assert.equal(entry.requests.length, 2);
    // Sorted by id ascending — deterministic across boots.
    assert.deepEqual(
      entry.requests.map((r: { id: string }) => r.id),
      [id1, id2].sort(),
    );
    // Each entry carries state + executors[]. claimed_by is omitted
    // for unclaimed waves (omit-when-undefined convention).
    for (const r of entry.requests) {
      assert.ok(['pending', 'approved', 'executing'].includes(r.state));
      assert.ok(Array.isArray(r.executors));
      assert.equal('claimed_by' in r, false);
    }
  } finally {
    cleanup();
  }
});

test('gate boot: active_overlapping_targets is empty when targets differ', () => {
  const { root, cleanup } = bootstrap();
  try {
    registerMember(root, 'leysia');
    makeRequestWithTarget(root, 'alice', 'work A', 'src/foo');
    makeRequestWithTarget(root, 'leysia', 'work B', 'src/bar');

    const { stdout } = runGate(root, ['boot']);
    const payload = JSON.parse(stdout);
    assert.deepEqual(payload.active_overlapping_targets, []);
  } finally {
    cleanup();
  }
});

test('gate boot: active_overlapping_targets ignores requests with no target', () => {
  // Two requests, both untargeted → no group key → no overlap.
  // Untargeted overlap is not a coordination signal (the freeform
  // target is the only handle for "same wave").
  const { root, cleanup } = bootstrap();
  try {
    registerMember(root, 'leysia');
    const r1 = spawnSync(
      process.execPath,
      [GATE, 'request', '--from', 'alice', '--action', 'a', '--reason', 'r', '--format', 'json'],
      { cwd: root, env: { ...process.env }, encoding: 'utf8' },
    );
    assert.equal(r1.status, 0, r1.stderr);
    const r2 = spawnSync(
      process.execPath,
      [GATE, 'request', '--from', 'leysia', '--action', 'b', '--reason', 'r', '--format', 'json'],
      { cwd: root, env: { ...process.env }, encoding: 'utf8' },
    );
    assert.equal(r2.status, 0, r2.stderr);

    const { stdout } = runGate(root, ['boot']);
    const payload = JSON.parse(stdout);
    assert.deepEqual(payload.active_overlapping_targets, []);
  } finally {
    cleanup();
  }
});

test('gate boot: active_overlapping_targets carries claim_held marker for claimed wave', () => {
  const { root, cleanup } = bootstrap();
  try {
    registerMember(root, 'leysia');
    // Use --executor to populate the executors[] slot the surface
    // renders (matching the issue's example output shape, which
    // names the executor next to the id).
    const r1 = spawnSync(
      process.execPath,
      [
        GATE, 'request',
        '--from', 'alice',
        '--executor', 'alice',
        '--action', 'work A',
        '--reason', 'overlap test',
        '--target', 'shared/path',
        '--format', 'json',
      ],
      { cwd: root, env: { ...process.env }, encoding: 'utf8' },
    );
    assert.equal(r1.status, 0, r1.stderr);
    const id1 = JSON.parse(r1.stdout).id;
    const r2 = spawnSync(
      process.execPath,
      [
        GATE, 'request',
        '--from', 'leysia',
        '--executor', 'leysia',
        '--action', 'work B',
        '--reason', 'overlap test',
        '--target', 'shared/path',
        '--format', 'json',
      ],
      { cwd: root, env: { ...process.env }, encoding: 'utf8' },
    );
    assert.equal(r2.status, 0, r2.stderr);

    // Stake an exclusive claim on the first request.
    const claim = runGate(root, ['claim', id1, '--by', 'alice']);
    assert.equal(claim.status, 0);

    const { stdout } = runGate(root, ['boot']);
    const payload = JSON.parse(stdout);
    const entry = payload.active_overlapping_targets[0];
    const claimed = entry.requests.find((r: { id: string }) => r.id === id1);
    assert.equal(claimed.claimed_by, 'alice');
    // Text mode renders the marker too (`claim_held` flag).
    const t = runGate(root, ['boot', '--format', 'text']);
    assert.match(t.stdout, /active waves with overlapping target:/);
    assert.match(t.stdout, new RegExp(`${id1} \\(alice, pending, claim_held\\)`));
    assert.match(t.stdout, /target: shared\/path/);
    assert.match(t.stdout, /coordinate via .gate witness/);
  } finally {
    cleanup();
  }
});

test('gate boot: active_overlapping_targets text section is omitted when no overlap', () => {
  // Voice budget — fresh roots / single-wave roots should not see
  // the warning header line. Empty array is a JSON contract; text
  // mode silences entirely.
  const { root, cleanup } = bootstrap();
  try {
    const t = runGate(root, ['boot', '--format', 'text']);
    assert.equal(t.status, 0);
    assert.doesNotMatch(t.stdout, /active waves with overlapping target/);
  } finally {
    cleanup();
  }
});
