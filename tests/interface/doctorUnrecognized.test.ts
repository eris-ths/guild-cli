// gate doctor — unrecognized files in record directories.
//
// Pre-fix gap: listByState's regex filter (^\d{4}-\d{2}-\d{2}-\d{3,4}\.yaml$)
// silently dropped off-pattern entries. A `bad.yaml` in
// `requests/pending/` or a `2026-05-01-7777.yaml` at the wrong directory
// level was invisible to gate forever; doctor reported the root as
// clean while the directory was not. This test pins the new
// `unrecognized_file` / `unrecognized_directory` finding kinds and
// the boundary (yaml + dirs surfaced; .txt / .md / dotfiles ignored).

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

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-doctor-unrec-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, d));
  }
  // Create the standard state subdirs so we can plant entries inside.
  for (const s of ['pending', 'approved', 'executing', 'completed', 'failed', 'denied']) {
    mkdirSync(join(root, 'requests', s));
  }
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
  input?: string,
): { stdout: string; stderr: string; status: number } {
  const opts: Parameters<typeof spawnSync>[2] = {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  };
  if (input !== undefined) opts.input = input;
  const r = spawnSync(process.execPath, [GATE, ...args], opts);
  return {
    stdout: typeof r.stdout === 'string' ? r.stdout : '',
    stderr: typeof r.stderr === 'string' ? r.stderr : '',
    status: r.status ?? -1,
  };
}

test('doctor: off-pattern .yaml under <state>/ surfaces as unrecognized_file', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  writeFileSync(join(root, 'requests', 'pending', 'bad.yaml'), 'stray');
  writeFileSync(join(root, 'requests', 'pending', '2026-05-01-7.yaml'), 'wrong-digits');

  const r = runGate(root, ['doctor', '--format', 'json']);
  // Doctor exits non-zero when findings exist.
  assert.notEqual(r.status, 0);
  const payload = JSON.parse(r.stdout);
  const findings = payload.findings as Array<{ kind: string; source: string; message: string }>;
  const offPattern = findings.filter((f) => f.kind === 'unrecognized_file');
  assert.equal(offPattern.length, 2, '2 off-pattern .yaml files expected');
  // The message points at the layout the user is missing.
  for (const f of offPattern) {
    assert.match(f.message, /YYYY-MM-DD-NNNN\.yaml/);
  }
  // Sources are absolute paths to the planted files.
  const sources = offPattern.map((f) => f.source).sort();
  assert.equal(sources.length, 2);
  assert.match(sources[0]!, /2026-05-01-7\.yaml$/);
  assert.match(sources[1]!, /bad\.yaml$/);
});

test('doctor: subdirectory under <state>/ surfaces as unrecognized_directory', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  mkdirSync(join(root, 'requests', 'pending', 'oops-dir'));

  const r = runGate(root, ['doctor', '--format', 'json']);
  assert.notEqual(r.status, 0);
  const payload = JSON.parse(r.stdout);
  const findings = payload.findings as Array<{ kind: string; message: string }>;
  const dirs = findings.filter((f) => f.kind === 'unrecognized_directory');
  assert.equal(dirs.length, 1);
  assert.match(dirs[0]!.message, /no legitimate place for nested directories/);
});

test('doctor: .yaml file at requests/ root (wrong directory level) is surfaced', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Pattern-matching name but at the wrong directory level — pre-fix
  // this was invisible because listByState only scans state subdirs.
  writeFileSync(join(root, 'requests', '2026-05-01-9999.yaml'), 'misplaced');

  const r = runGate(root, ['doctor', '--format', 'json']);
  assert.notEqual(r.status, 0);
  const payload = JSON.parse(r.stdout);
  const findings = payload.findings as Array<{ kind: string; message: string; source: string }>;
  // Path separator: source carries native separators (`/` on POSIX,
  // `\` on Windows). Normalise to forward slashes for the suffix
  // assertion so the test passes on both CI runners.
  const rootFiles = findings.filter(
    (f) =>
      f.kind === 'unrecognized_file' &&
      /requests\/2026-05-01-9999\.yaml$/.test(f.source.replace(/\\/g, '/')),
  );
  assert.equal(rootFiles.length, 1);
  assert.match(rootFiles[0]!.message, /should live under <state>\//);
});

test('doctor: non-state directory at requests/ root is surfaced', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  mkdirSync(join(root, 'requests', 'random-dir'));

  const r = runGate(root, ['doctor', '--format', 'json']);
  assert.notEqual(r.status, 0);
  const payload = JSON.parse(r.stdout);
  const findings = payload.findings as Array<{ kind: string; message: string; source: string }>;
  const dirs = findings.filter(
    (f) => f.kind === 'unrecognized_directory' && /random-dir$/.test(f.source),
  );
  assert.equal(dirs.length, 1);
  assert.match(dirs[0]!.message, /not a state name/);
  // Message lists the expected state names so the user knows what
  // the layout is supposed to be without leaving for --help.
  assert.match(dirs[0]!.message, /pending/);
  assert.match(dirs[0]!.message, /denied/);
});

test('doctor: non-yaml files (notes.txt, .gitkeep) are NOT surfaced', (t) => {
  // Boundary: the diagnostic is opinionated about *attempted records*.
  // notes.txt / README.md / .gitkeep are legitimately useful for repo
  // authors to leave in record directories and not surfaced as health
  // issues. Pin the boundary so a future "warn on anything unexpected"
  // refactor doesn't quietly start flagging conventional repo artifacts.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  writeFileSync(join(root, 'requests', 'pending', 'notes.txt'), 'human notes');
  writeFileSync(join(root, 'requests', 'pending', '.gitkeep'), '');
  writeFileSync(join(root, 'requests', 'pending', 'README.md'), '# notes');

  const r = runGate(root, ['doctor', '--format', 'json']);
  // No findings → exit 0.
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.deepEqual(payload.findings, []);
});

test('repair --apply: unrecognized_file is quarantined; unrecognized_directory is no-op', (t) => {
  // The kind/action mapping in RepairPlan: off-pattern .yaml files
  // get quarantined (gate ignores them anyway, moving them out is
  // safe and reversible). Directories are no-op because their
  // contents are unknown and quarantining a tree is invasive — the
  // operator must inspect first. Pin the boundary so a future
  // "quarantine everything unknown" refactor doesn't silently
  // start moving directories.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  writeFileSync(join(root, 'requests', 'pending', 'bad.yaml'), 'stray');
  mkdirSync(join(root, 'requests', 'pending', 'oops-dir'));

  const planJson = runGate(root, ['doctor', '--format', 'json']);
  const r = runGate(
    root,
    ['repair', '--apply'],
    {},
    planJson.stdout,
  );
  assert.equal(r.status, 0);
  // The file got quarantined.
  assert.match(r.stdout, /\[quarantined\].*bad\.yaml/);
  // The directory was a no-op.
  assert.match(r.stdout, /\[no_op\].*oops-dir/);
});
