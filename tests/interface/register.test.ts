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

// ---------------------------------------------------------------
// Path-disclosure notice (designed in 2026-05-01-0001/0002).
//
// Pre-this, `gate register` from a subdir of an active guild
// silently wrote into the parent's members/ directory — fresh
// agents had no signal where their YAML actually landed. Same gap
// hit no-config-found cases (cwd used as fallback root). The
// fix surfaces the absolute path on stderr (humans) AND in the
// JSON envelope (orchestrators) so both contracts stay honest.
// ---------------------------------------------------------------

test('register: success-text emits stderr notice naming the absolute path written + config in use', () => {
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, ['register', '--name', 'pathy']);
    assert.equal(r.status, 0);
    // Stderr carries one notice line; stdout stays parseable.
    assert.match(
      r.stderr,
      new RegExp(
        `^notice: wrote ${escapeRegex(join(root, 'members', 'pathy.yaml'))} \\(config: ${escapeRegex(join(root, 'guild.config.yaml'))}\\)\\n$`,
      ),
    );
    assert.doesNotMatch(r.stdout, /notice:/);
  } finally {
    cleanup();
  }
});

test('register: success-json adds where_written + config_file fields AND emits the stderr notice', () => {
  // Devil concern D2 on req 2026-05-01-0002: JSON is the
  // orchestrator contract, stderr is the human contract — both
  // must be honest. Pin both surfaces so a future refactor
  // can't drop one quietly.
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, [
      'register',
      '--name', 'jsony',
      '--format', 'json',
    ]);
    assert.equal(r.status, 0);
    const payload = JSON.parse(r.stdout);
    assert.equal(payload.ok, true);
    assert.equal(
      payload.where_written,
      join(root, 'members', 'jsony.yaml'),
    );
    assert.equal(
      payload.config_file,
      join(root, 'guild.config.yaml'),
    );
    assert.match(r.stderr, /^notice: wrote /);
  } finally {
    cleanup();
  }
});

test('register: dry-run preview also surfaces the absolute path + config (devil D3 — dry-run not less honest than real write)', () => {
  // Pre-fix the dry-run preview said `would write
  // members/<name>.yaml` (relative path) while the real write
  // was about to land at an absolute path possibly on a parent
  // guild. That asymmetry was the whole gap. Both paths now
  // disclose the same way.
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, [
      'register',
      '--name', 'dryone',
      '--dry-run',
    ]);
    assert.equal(r.status, 0);
    // Preview header carries the absolute path now.
    assert.match(
      r.stdout,
      new RegExp(`^dry-run: would write ${escapeRegex(join(root, 'members', 'dryone.yaml'))}:`),
    );
    // Stderr notice fires on dry-run too, with `would write` (not
    // `wrote`) so the verb stays honest.
    assert.match(r.stderr, /^notice: would write /);
    assert.match(
      r.stderr,
      new RegExp(`config: ${escapeRegex(join(root, 'guild.config.yaml'))}`),
    );
  } finally {
    cleanup();
  }
});

test('register: error case (collision) does NOT emit the path notice', () => {
  // Devil concern D4 on req 2026-05-01-0002: the notice claims a
  // write happened. It must fire ONLY after memberUC.create
  // succeeds. Collisions throw before reaching the emit point;
  // host-name reservation and validation errors throw earlier
  // still. Pin the boundary so a future refactor doesn't move
  // the emit ahead of the create.
  const { root, cleanup } = bootstrap();
  try {
    const r = runGate(root, ['register', '--name', 'alice']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /already exists/);
    assert.doesNotMatch(r.stderr, /^notice: wrote/m);
    assert.doesNotMatch(r.stderr, /^notice: would write/m);
  } finally {
    cleanup();
  }
});

test('register: no-config fallback path surfaces "config: none" so the implicit-cwd case is named explicitly', () => {
  // The other half of the silent-pickup gap: an agent who runs
  // gate register in an empty dir with no parent config gets cwd
  // used as content_root with no warning. Post-fix the notice
  // names it (`config: none — cwd used as fallback root`) so the
  // agent learns the implicit default exists.
  const root = mkdtempSync(join(tmpdir(), 'guild-register-nocfg-'));
  try {
    const r = runGate(root, ['register', '--name', 'cwdsolo']);
    assert.equal(r.status, 0);
    assert.match(
      r.stderr,
      new RegExp(
        `^notice: wrote ${escapeRegex(join(root, 'members', 'cwdsolo.yaml'))} \\(config: none — cwd used as fallback root\\)\\n$`,
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Escape regex special chars so absolute paths from tmpdir() can
// be embedded in `new RegExp(...)`. Native path separators differ
// across CI runners (POSIX `/`, Windows `\`) and `\` would
// otherwise consume the next character of the literal path.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
