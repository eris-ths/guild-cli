// Worktree-isolation enforcement (issue #231).
//
// Filesystem-layer guard for the substrate-experiment-6 race: two
// SubAgents started under the same cwd let the first-committer's
// `git add` scoop the second's uncommitted files, destroying
// attribution. The record-layer fix (#230, multi-executor) keeps the
// substrate honest about who was assigned. This wave keeps the
// FILESYSTEM honest about who is currently writing.
//
// Surface contract verified here:
//   - profile=standard + parallel executors + same cwd → warning notice,
//     execute is allowed (records-outlive-writers / no enforcement)
//   - profile=swarm    + parallel executors + same cwd → second execute
//     refused with exit 1 and an actionable error
//   - profile=swarm    + parallel executors + different cwds → both pass
//   - profile=swarm    + single executor → no constraint (no race to gate)
//   - hydrate tolerance: a request without the new field reads as
//     non-isolated (no false-refuse on legacy records)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

// Wrap mkdtempSync so every test directory is canonical. On darwin
// `os.tmpdir()` returns `/var/folders/...` which is itself a symlink
// to `/private/var/folders/...`; passing the symlink form into the
// CLI and asserting against the realpath form (or vice-versa) is the
// exact ambiguity #231 had to resolve — pin tests to canonical to
// avoid co-mingling that with the actual collision logic. (Pattern
// established in #238 for the same reason.)
function mkdtempReal(prefix: string): string {
  return realpathSync(mkdtempSync(prefix));
}

interface Bootstrap {
  root: string;
  cleanup: () => void;
}

function bootstrap(profile: 'standard' | 'swarm'): Bootstrap {
  const root = mkdtempReal(join(tmpdir(), `guild-wti-${profile}-`));
  // Pin self_approve: warn so this suite stays focused on worktree
  // isolation. #233 makes swarm forbid self-approve by default; the
  // helper `createApproved` below self-approves to set up the wave,
  // and asserting that orthogonal policy here would muddy what these
  // tests actually verify.
  writeFileSync(
    join(root, 'guild.config.yaml'),
    `content_root: .\nhost_names: [eris]\nprofile: ${profile}\n` +
      `features:\n  self_approve: warn\n`,
  );
  mkdirSync(join(root, 'members'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function run(
  cwd: string,
  args: string[],
  actor?: string,
): { stdout: string; stderr: string; status: number } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (actor !== undefined) env['GUILD_ACTOR'] = actor;
  else delete env['GUILD_ACTOR'];
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env,
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

function registerAll(root: string, names: string[]): void {
  for (const n of names) {
    run(root, ['register', '--name', n]);
  }
}

// Create + approve in a single helper so the table tests below stay
// readable. Returns the freshly approved request id.
function createApproved(
  root: string,
  args: { from: string; executors: string[]; target: string },
): string {
  const r = run(root, [
    'request',
    '--from',
    args.from,
    '--action',
    'wave work',
    '--reason',
    'parallel impl',
    '--executors',
    args.executors.join(','),
    '--target',
    args.target,
    '--format',
    'json',
  ]);
  assert.equal(r.status, 0, `request failed: ${r.stderr}`);
  const id = (JSON.parse(r.stdout) as { id: string }).id;
  const ap = run(root, ['approve', id, '--by', args.from]);
  assert.equal(ap.status, 0, `approve failed: ${ap.stderr}`);
  return id;
}

test('profile=standard + parallel executors + same cwd: warns, both execute', (t) => {
  const { root, cleanup } = bootstrap('standard');
  t.after(cleanup);
  registerAll(root, ['alice', 'miki', 'leysia']);

  // Two SEPARATE requests on the same target — substrate-experiment 6
  // shape: a wave fanned out across multiple executors, each on its
  // own request id. Standard profile must warn but not refuse.
  const id1 = createApproved(root, {
    from: 'alice',
    executors: ['miki', 'leysia'],
    target: 'shared-target',
  });
  const id2 = createApproved(root, {
    from: 'alice',
    executors: ['miki', 'leysia'],
    target: 'shared-target',
  });

  const e1 = run(root, ['execute', id1, '--by', 'miki', '--cwd', root]);
  assert.equal(e1.status, 0, `execute1 failed: ${e1.stderr}`);
  const e2 = run(root, ['execute', id2, '--by', 'leysia', '--cwd', root]);
  assert.equal(
    e2.status,
    0,
    `execute2 should pass under profile=standard but failed: ${e2.stderr}`,
  );
});

test('profile=standard + parallel executors: request emits a warning notice on stderr', (t) => {
  const { root, cleanup } = bootstrap('standard');
  t.after(cleanup);
  registerAll(root, ['alice', 'miki', 'leysia']);

  const r = run(root, [
    'request',
    '--from',
    'alice',
    '--action',
    'parallel work',
    '--reason',
    'r',
    '--executors',
    'miki,leysia',
    '--format',
    'json',
  ]);
  assert.equal(r.status, 0, r.stderr);
  // Notice mentions both the profile and the explicit feature key so a
  // reader knows exactly what to flip in guild.config.yaml.
  assert.match(r.stderr, /profile=standard/);
  assert.match(r.stderr, /worktree_required_for_parallel/);
});

test('profile=swarm + parallel executors + same cwd: second execute refused', (t) => {
  const { root, cleanup } = bootstrap('swarm');
  t.after(cleanup);
  registerAll(root, ['alice', 'miki', 'leysia']);

  const id1 = createApproved(root, {
    from: 'alice',
    executors: ['miki', 'leysia'],
    target: 'shared-target',
  });
  const id2 = createApproved(root, {
    from: 'alice',
    executors: ['miki', 'leysia'],
    target: 'shared-target',
  });

  const e1 = run(root, ['execute', id1, '--by', 'miki', '--cwd', root]);
  assert.equal(e1.status, 0, `first execute should succeed: ${e1.stderr}`);

  const e2 = run(root, ['execute', id2, '--by', 'leysia', '--cwd', root]);
  assert.equal(
    e2.status,
    1,
    `second execute should refuse but exited ${e2.status}: ${e2.stderr}`,
  );
  assert.match(e2.stderr, /refusing to execute/);
  assert.match(e2.stderr, /requires_worktree_isolation/);
});

test('profile=swarm + parallel executors + DIFFERENT cwds: both execute', (t) => {
  const { root, cleanup } = bootstrap('swarm');
  t.after(cleanup);
  registerAll(root, ['alice', 'miki', 'leysia']);

  const id1 = createApproved(root, {
    from: 'alice',
    executors: ['miki', 'leysia'],
    target: 'shared-target',
  });
  const id2 = createApproved(root, {
    from: 'alice',
    executors: ['miki', 'leysia'],
    target: 'shared-target',
  });

  // Simulate separate worktrees by passing different --cwd values.
  // The collision check compares the resolved absolute paths, so any
  // two distinct directories suffice.
  const wt1 = mkdtempReal(join(tmpdir(), 'wti-wt1-'));
  const wt2 = mkdtempReal(join(tmpdir(), 'wti-wt2-'));
  t.after(() => {
    rmSync(wt1, { recursive: true, force: true });
    rmSync(wt2, { recursive: true, force: true });
  });

  const e1 = run(root, ['execute', id1, '--by', 'miki', '--cwd', wt1]);
  assert.equal(e1.status, 0, `execute1 failed: ${e1.stderr}`);
  const e2 = run(root, ['execute', id2, '--by', 'leysia', '--cwd', wt2]);
  assert.equal(
    e2.status,
    0,
    `different-cwd execute should succeed: ${e2.stderr}`,
  );
});

test('profile=swarm + single executor: requires_worktree_isolation NOT set, no constraint', (t) => {
  const { root, cleanup } = bootstrap('swarm');
  t.after(cleanup);
  registerAll(root, ['alice', 'miki']);

  const r = run(root, [
    'request',
    '--from',
    'alice',
    '--action',
    'solo work',
    '--reason',
    'r',
    '--executor',
    'miki',
    '--format',
    'json',
  ]);
  assert.equal(r.status, 0, r.stderr);
  const id = (JSON.parse(r.stdout) as { id: string }).id;

  // Verify the on-disk record carries no isolation flag — a singleton
  // wave has no race to gate, so the field should be absent.
  const showJson = run(root, ['show', id, '--format', 'json']);
  const payload = JSON.parse(showJson.stdout) as Record<string, unknown>;
  assert.equal(
    payload['requires_worktree_isolation'],
    undefined,
    'single-executor should not stamp the flag',
  );
});

test('profile=swarm + parallel: persisted record carries requires_worktree_isolation: true', (t) => {
  const { root, cleanup } = bootstrap('swarm');
  t.after(cleanup);
  registerAll(root, ['alice', 'miki', 'leysia']);

  const r = run(root, [
    'request',
    '--from',
    'alice',
    '--action',
    'wave',
    '--reason',
    'r',
    '--executors',
    'miki,leysia',
    '--format',
    'json',
  ]);
  assert.equal(r.status, 0, r.stderr);
  const id = (JSON.parse(r.stdout) as { id: string }).id;

  const showJson = run(root, ['show', id, '--format', 'json']);
  const payload = JSON.parse(showJson.stdout) as Record<string, unknown>;
  assert.equal(payload['requires_worktree_isolation'], true);
});

test('hydrate tolerance: a record without the field loads as non-isolated (no false-refuse)', (t) => {
  const { root, cleanup } = bootstrap('swarm');
  t.after(cleanup);
  registerAll(root, ['alice', 'miki']);

  // Hand-write a pre-#231 shaped pending file and make sure execute
  // does NOT spuriously refuse it. The field is simply absent.
  const pendingDir = join(root, 'requests', 'pending');
  mkdirSync(pendingDir, { recursive: true });
  const id = '2026-04-14-0001';
  const yaml = [
    `id: ${id}`,
    'from: alice',
    'action: legacy work',
    'reason: pre-#231 record',
    'state: pending',
    'created_at: 2026-04-14T00:00:00.000Z',
    'executors:',
    '  - miki',
    'status_log:',
    '  - state: pending',
    '    by: alice',
    '    at: 2026-04-14T00:00:00.000Z',
    '    note: created',
    'reviews: []',
    '',
  ].join('\n');
  writeFileSync(join(pendingDir, `${id}.yaml`), yaml);

  // Approve then execute — neither path should refuse the legacy
  // record despite running under profile=swarm.
  const ap = run(root, ['approve', id, '--by', 'alice']);
  assert.equal(ap.status, 0, `approve failed: ${ap.stderr}`);
  const ex = run(root, ['execute', id, '--by', 'miki', '--cwd', root]);
  assert.equal(
    ex.status,
    0,
    `legacy record should execute without refusal: ${ex.stderr}`,
  );
});

test('execute --cwd stamps executing_at_cwd into the status_log entry', (t) => {
  const { root, cleanup } = bootstrap('swarm');
  t.after(cleanup);
  registerAll(root, ['alice', 'miki']);

  const r = run(root, [
    'request',
    '--from',
    'alice',
    '--action',
    'work',
    '--reason',
    'r',
    '--executor',
    'miki',
    '--format',
    'json',
  ]);
  assert.equal(r.status, 0, r.stderr);
  const id = (JSON.parse(r.stdout) as { id: string }).id;
  run(root, ['approve', id, '--by', 'alice']);

  const wt = mkdtempReal(join(tmpdir(), 'wti-stamp-'));
  t.after(() => rmSync(wt, { recursive: true, force: true }));
  const ex = run(root, ['execute', id, '--by', 'miki', '--cwd', wt]);
  assert.equal(ex.status, 0, ex.stderr);

  // Read the on-disk YAML directly — verify the field landed where
  // the spec says it should (status_log[-1].executing_at_cwd).
  const executingDir = join(root, 'requests', 'executing');
  const files = readdirSync(executingDir).filter((f) => f.startsWith(id));
  assert.equal(files.length, 1, `expected one executing file for ${id}`);
  const text = readFileSync(join(executingDir, files[0]!), 'utf8');
  assert.match(text, /executing_at_cwd:/);
  assert.match(text, new RegExp(wt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

// Devil HIGH-1 (#231 follow-up): symlink-bypass regression. Pre-fix,
// `path.resolve` was used on the supplied --cwd, which leaves
// symlinks intact: `/var/X` and `/private/var/X` (or any local
// symlink farm) name the same physical directory but compare
// non-equal as strings, so the second execute would slip through
// the collision check. Post-fix, both sides are realpath'd before
// comparison, so the second invocation is refused.
test('Devil HIGH-1: symlink form of an already-executing cwd is canonicalised and refused', (t) => {
  const { root, cleanup } = bootstrap('swarm');
  t.after(cleanup);
  registerAll(root, ['alice', 'miki', 'leysia']);

  const id1 = createApproved(root, {
    from: 'alice',
    executors: ['miki', 'leysia'],
    target: 'shared-target',
  });
  const id2 = createApproved(root, {
    from: 'alice',
    executors: ['miki', 'leysia'],
    target: 'shared-target',
  });

  // Build a real directory + a symlink pointing at it. We then run
  // two executes: the first via the real path, the second via the
  // symlink form. With realpath canonicalisation, both flatten to
  // the same identity → refuse. Without it (pre-fix) the second
  // would have passed.
  const realWt = mkdtempReal(join(tmpdir(), 'wti-real-'));
  const linkParent = mkdtempReal(join(tmpdir(), 'wti-link-'));
  const linkWt = join(linkParent, 'symlinked-worktree');
  symlinkSync(realWt, linkWt, 'dir');
  t.after(() => {
    rmSync(realWt, { recursive: true, force: true });
    rmSync(linkParent, { recursive: true, force: true });
  });

  const e1 = run(root, ['execute', id1, '--by', 'miki', '--cwd', realWt]);
  assert.equal(e1.status, 0, `real-path execute failed: ${e1.stderr}`);

  const e2 = run(root, ['execute', id2, '--by', 'leysia', '--cwd', linkWt]);
  assert.equal(
    e2.status,
    1,
    `symlink-form execute should be refused (realpath canonicalisation), got ${e2.status}: ${e2.stderr}`,
  );
  assert.match(e2.stderr, /refusing to execute/);
});

// Sister test: the canonical form of the on-disk peer cwd is also
// realpath'd at write time, so the comparison is symmetric — start
// via the symlink, then attempt the real path. Both directions
// must collapse identically, otherwise the order of arrival
// determines safety which is exactly the kind of fail-open Devil
// flagged.
test('Devil HIGH-1: symmetric — first via symlink, second via realpath also refused', (t) => {
  const { root, cleanup } = bootstrap('swarm');
  t.after(cleanup);
  registerAll(root, ['alice', 'miki', 'leysia']);

  const id1 = createApproved(root, {
    from: 'alice',
    executors: ['miki', 'leysia'],
    target: 'shared-target',
  });
  const id2 = createApproved(root, {
    from: 'alice',
    executors: ['miki', 'leysia'],
    target: 'shared-target',
  });

  const realWt = mkdtempReal(join(tmpdir(), 'wti-real2-'));
  const linkParent = mkdtempReal(join(tmpdir(), 'wti-link2-'));
  const linkWt = join(linkParent, 'symlinked-worktree');
  symlinkSync(realWt, linkWt, 'dir');
  t.after(() => {
    rmSync(realWt, { recursive: true, force: true });
    rmSync(linkParent, { recursive: true, force: true });
  });

  const e1 = run(root, ['execute', id1, '--by', 'miki', '--cwd', linkWt]);
  assert.equal(e1.status, 0, `symlink-form first execute failed: ${e1.stderr}`);

  const e2 = run(root, ['execute', id2, '--by', 'leysia', '--cwd', realWt]);
  assert.equal(
    e2.status,
    1,
    `real-path second execute should be refused, got ${e2.status}: ${e2.stderr}`,
  );
  assert.match(e2.stderr, /refusing to execute/);
});
