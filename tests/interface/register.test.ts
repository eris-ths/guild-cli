// gate register — onboarding's first verb.
//
// Registration was the first real wall a newcomer hit before
// this verb existed (hand-author YAML, figure out the schema,
// risk a typo). These tests pin the happy path plus every
// friction surface: alias normalization, name collision, host
// refusal, and dry-run parity with the real write.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-register-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  mkdirSync(join(root, 'members'));
  // Seed a pre-existing member so we can exercise the collision path.
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status ?? -1,
  };
}

test('register: happy path writes members/<name>.yaml with canonical fields', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { status, stdout } = runGate(root, [
      'register',
      '--name',
      'klee',
      '--display-name',
      'Klee',
    ]);
    assert.equal(status, 0);
    assert.match(stdout, /✓ registered: klee \[professional\]/);
    const yaml = readFileSync(join(root, 'members', 'klee.yaml'), 'utf8');
    assert.match(yaml, /name: klee/);
    assert.match(yaml, /category: professional/);
    assert.match(yaml, /active: true/);
    // snake_case key on disk — matches the rest of the project's
    // YAML convention. hydrate accepts both forms for back-compat
    // with member YAMLs written by older versions; new writes
    // always use snake_case.
    assert.match(yaml, /display_name: Klee/);
    // Negative: the camelCase key MUST NOT also appear (single-cycle
    // cut, not dual-emit). Pre-fix shape used `displayName`; new
    // writes are snake_case only.
    assert.doesNotMatch(yaml, /displayName:/);
  } finally {
    cleanup();
  }
});

test('register: dry-run preview uses display_name (snake_case), matches save shape', () => {
  // What-you-see-is-what-gets-saved parity. Pre-fix the preview
  // emitted `displayName` to mirror the (then-camelCase) save;
  // the save is now snake_case so the preview matches.
  const { root, cleanup } = bootstrap();
  try {
    const { status, stdout } = runGate(root, [
      'register',
      '--name', 'previewone',
      '--display-name', 'Preview One',
      '--dry-run',
    ]);
    assert.equal(status, 0);
    assert.match(stdout, /display_name: "Preview One"/);
    assert.doesNotMatch(stdout, /displayName:/);
    // Side effect: dry-run does NOT actually write the file.
    assert.equal(
      existsSync(join(root, 'members', 'previewone.yaml')),
      false,
    );
  } finally {
    cleanup();
  }
});

test('register: hydrate still accepts legacy camelCase displayName on read', () => {
  // Backwards compatibility: member YAMLs written by older versions
  // carry `displayName` (camelCase). The save path is now snake_case
  // only, but hydrate must keep reading both — otherwise upgrading
  // would orphan existing display names.
  const { root, cleanup } = bootstrap();
  try {
    writeFileSync(
      join(root, 'members', 'legacy.yaml'),
      'name: legacy\ncategory: professional\nactive: true\ndisplayName: Legacy Display\n',
    );
    const { status, stdout } = runGate(
      root,
      ['whoami'],
      { GUILD_ACTOR: 'legacy' },
    );
    assert.equal(status, 0);
    // The display name from the legacy camelCase YAML is surfaced.
    assert.match(stdout, /you are legacy — Legacy Display \(member\)/);
  } finally {
    cleanup();
  }
});

test('whoami: surfaces display_name when present (em-dash separator)', () => {
  // Pre-fix whoami showed only the name+role: "you are noir
  // (member)". The display_name was stored on disk but invisible
  // at the orientation surface. Now: "you are noir — Noir
  // (Critic) (member)".
  const { root, cleanup } = bootstrap();
  try {
    runGate(root, [
      'register',
      '--name', 'noir',
      '--display-name', 'Noir (Critic)',
    ]);
    const { stdout } = runGate(root, ['whoami'], { GUILD_ACTOR: 'noir' });
    assert.match(stdout, /you are noir — Noir \(Critic\) \(member\)/);
  } finally {
    cleanup();
  }
});

test('whoami: omits the display_name chunk when absent', () => {
  // Members without a display_name keep the original concise
  // shape; the em-dash is conditional, not always present.
  const { root, cleanup } = bootstrap();
  try {
    runGate(root, ['register', '--name', 'plain']);
    const { stdout } = runGate(root, ['whoami'], { GUILD_ACTOR: 'plain' });
    // Pin the first line shape exactly. (Other lines may carry em-
    // dashes — e.g. the "no utterances yet — try ..." onboarding
    // hint — which is unrelated to the display_name surfacing.)
    const firstLine = stdout.split('\n')[0]!;
    assert.equal(firstLine, 'you are plain (member)');
  } finally {
    cleanup();
  }
});

test('register: --category alias normalizes on write and in dry-run preview', () => {
  const { root, cleanup } = bootstrap();
  try {
    // dry-run: preview must show canonical, not the raw alias.
    const dry = runGate(root, [
      'register',
      '--name',
      'tester',
      '--category',
      'pro',
      '--dry-run',
    ]);
    assert.equal(dry.status, 0);
    assert.match(dry.stdout, /category: "professional"/);
    assert.ok(!existsSync(join(root, 'members', 'tester.yaml')));

    // real: the YAML written must match what dry-run claimed.
    const real = runGate(root, [
      'register',
      '--name',
      'tester',
      '--category',
      'pro',
    ]);
    assert.equal(real.status, 0);
    const yaml = readFileSync(join(root, 'members', 'tester.yaml'), 'utf8');
    assert.match(yaml, /category: professional/);
  } finally {
    cleanup();
  }
});

test('register: already-exists fails loudly instead of silently overwriting', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { status, stderr } = runGate(root, ['register', '--name', 'alice']);
    assert.notEqual(status, 0);
    assert.match(stderr, /Member "alice" already exists/);
  } finally {
    cleanup();
  }
});

test('register: --category host is rejected (guild.config.yaml is the source of truth)', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { status, stderr } = runGate(root, [
      'register',
      '--name',
      'foo',
      '--category',
      'host',
    ]);
    assert.notEqual(status, 0);
    assert.match(stderr, /not registerable via CLI/);
    assert.match(stderr, /guild\.config\.yaml/);
    assert.ok(!existsSync(join(root, 'members', 'foo.yaml')));
  } finally {
    cleanup();
  }
});

test('register: --name that collides with host_names is rejected (guards the host/member single-role invariant)', () => {
  // Complement to the `--category host` guard above: that one catches
  // the "trying to create a host via --category" path; this one
  // catches "trying to create a member with a name already claimed
  // as a host". Both end up as the same invariant violation from
  // downstream verbs (which name resolves to which role?), so both
  // must be rejected pre-save.
  const { root, cleanup } = bootstrap();
  try {
    const { status, stderr } = runGate(root, ['register', '--name', 'human']);
    assert.notEqual(status, 0);
    assert.match(stderr, /already declared as a host/);
    assert.match(stderr, /host_names:/);
    assert.ok(!existsSync(join(root, 'members', 'human.yaml')));
  } finally {
    cleanup();
  }
});

test('register: host/member collision fires before --dry-run (disk untouched either way)', () => {
  // Pin the ordering: the host check must happen before the dry-run
  // branch, otherwise `register --name <host> --dry-run` would
  // produce a preview that cannot ever be committed — a confusing
  // dead-end. Test that the error surfaces regardless of --dry-run.
  const { root, cleanup } = bootstrap();
  try {
    const { status, stderr } = runGate(root, [
      'register',
      '--name',
      'human',
      '--dry-run',
    ]);
    assert.notEqual(status, 0);
    assert.match(stderr, /already declared as a host/);
  } finally {
    cleanup();
  }
});

test('register: --dry-run does not touch disk and yields parseable JSON', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { status, stdout } = runGate(root, [
      'register',
      '--name',
      'ghost',
      '--dry-run',
      '--format',
      'json',
    ]);
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.dry_run, true);
    assert.equal(payload.preview.name, 'ghost');
    assert.equal(payload.preview.category, 'professional');
    assert.ok(!existsSync(join(root, 'members', 'ghost.yaml')));
  } finally {
    cleanup();
  }
});

test('register: assertActor error surfaces the register hint', () => {
  // The onboarding loop: an unregistered agent tries fast-track,
  // the error tells them how to register. This is the whole reason
  // assertActor carries the hint.
  const { root, cleanup } = bootstrap();
  try {
    const { status, stderr } = runGate(root, [
      'fast-track',
      '--from',
      'newcomer',
      '--action',
      'try',
      '--reason',
      'first touch',
    ]);
    assert.notEqual(status, 0);
    assert.match(stderr, /no such member or host/);
    assert.match(stderr, /gate register --name newcomer/);
  } finally {
    cleanup();
  }
});
