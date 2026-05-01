// gate doctor — unrecognized files in issues/ and members/.
//
// Companion to doctorUnrecognized.test.ts (which covers requests/).
// Pre-fix gap: YamlIssueRepository.listAll's regex filter
// (^i-\d{4}-\d{2}-\d{2}-\d{3,4}\.yaml$) and YamlMemberRepository's
// regex filter (^[a-z][a-z0-9_-]{0,31}\.yaml$) silently dropped
// off-pattern entries. An `i-bogus.yaml` in `issues/` or a
// `Dave.yaml` in `members/` (uppercase first letter) was invisible
// to gate forever; doctor reported the root as clean while the
// member was missing from `gate list`. This test pins:
//   - off-pattern .yaml files surface as `unrecognized_file`
//   - subdirectories surface as `unrecognized_directory`
//   - the four common typo cases for member names (uppercase,
//     leading digit, leading underscore, too long)
//   - the boundary stays consistent with requests: .txt / .md /
//     dotfiles ignored, only .yaml + dirs surfaced.
//
// Cross-platform note: the uppercase typo cases use names that
// don't case-fold-collide with anything in `bootstrap()` because
// Windows NTFS is case-insensitive by default — `Alice.yaml` and
// `alice.yaml` would resolve to the same file there.

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
  const root = mkdtempSync(join(tmpdir(), 'guild-doctor-im-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, d));
  }
  // Need at least one valid request state subdir so the requests scan
  // doesn't surface its own findings and pollute area filters.
  for (const s of ['pending', 'approved', 'executing', 'completed', 'failed', 'denied']) {
    mkdirSync(join(root, 'requests', s));
  }
  // A baseline valid member so listAll has something to count.
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

test('doctor: off-pattern .yaml under issues/ surfaces as unrecognized_file', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Three off-pattern names that listAll's regex silently drops:
  //   - missing the i- prefix
  //   - too-short sequence (only 2 digits — pattern requires 3-4)
  //   - capitalised prefix (`I-` instead of `i-`)
  // (We deliberately don't pick "month 13" or other semantic-date
  // violations: the regex is `\d{2}` and validates digit count, not
  // calendar reality, so a month-13 filename actually matches.)
  writeFileSync(join(root, 'issues', 'bogus.yaml'), 'stray');
  writeFileSync(join(root, 'issues', 'i-2026-05-01-99.yaml'), 'short-seq');
  writeFileSync(join(root, 'issues', 'I-2026-05-01-0001.yaml'), 'cap-prefix');

  const r = runGate(root, ['doctor', '--format', 'json']);
  assert.notEqual(r.status, 0);
  const payload = JSON.parse(r.stdout);
  const findings = payload.findings as Array<{
    area: string;
    kind: string;
    source: string;
    message: string;
  }>;
  const offPattern = findings.filter(
    (f) => f.area === 'issues' && f.kind === 'unrecognized_file',
  );
  assert.equal(offPattern.length, 3, '3 off-pattern .yaml files in issues/ expected');
  for (const f of offPattern) {
    // Message points at the layout the user is missing.
    assert.match(f.message, /i-YYYY-MM-DD-NNNN\.yaml/);
  }
});

test('doctor: subdirectory under issues/ surfaces as unrecognized_directory', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  mkdirSync(join(root, 'issues', 'archived'));

  const r = runGate(root, ['doctor', '--format', 'json']);
  assert.notEqual(r.status, 0);
  const payload = JSON.parse(r.stdout);
  const findings = payload.findings as Array<{
    area: string;
    kind: string;
    source: string;
    message: string;
  }>;
  const dirs = findings.filter(
    (f) => f.area === 'issues' && f.kind === 'unrecognized_directory',
  );
  assert.equal(dirs.length, 1);
  assert.match(dirs[0]!.message, /no legitimate place for nested directories/);
});

test('doctor: off-pattern .yaml under members/ surfaces (the four common typos)', (t) => {
  // D4 from devil review (req 2026-05-01-0001): the four
  // pattern-violating cases that silently drop a member from `gate
  // list`. This is the ACTUAL bug a fresh agent hits when their
  // member name renders as missing — pre-this scan, doctor reported
  // the root as clean while the file sat there in plain view.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Pick uppercase-prefix typo names that DON'T case-fold to any
  // lowercase fixture name — Windows NTFS is case-insensitive by
  // default, so `Alice.yaml` would be the same file as the
  // `alice.yaml` planted by bootstrap() and the test would see only
  // 3 findings instead of 4. `Dave` has no lowercase counterpart in
  // the fixture, so the case test stays portable across CI runners.
  writeFileSync(
    join(root, 'members', 'Dave.yaml'),
    'name: Dave\ncategory: professional\nactive: true\n',
  );
  writeFileSync(
    join(root, 'members', '1bob.yaml'),
    'name: bob\ncategory: professional\nactive: true\n',
  );
  writeFileSync(
    join(root, 'members', '_carol.yaml'),
    'name: carol\ncategory: professional\nactive: true\n',
  );
  // Name >32 chars: 'z' + 32 chars = 33 chars before .yaml.
  // (Use `z` not `a` so this also doesn't case-fold-collide with
  // any other planted file.)
  const tooLongName = 'z' + 'y'.repeat(32);
  writeFileSync(
    join(root, 'members', `${tooLongName}.yaml`),
    'name: too-long\ncategory: professional\nactive: true\n',
  );

  const r = runGate(root, ['doctor', '--format', 'json']);
  assert.notEqual(r.status, 0);
  const payload = JSON.parse(r.stdout);
  const findings = payload.findings as Array<{
    area: string;
    kind: string;
    source: string;
    message: string;
  }>;
  const offPattern = findings.filter(
    (f) => f.area === 'members' && f.kind === 'unrecognized_file',
  );
  assert.equal(
    offPattern.length,
    4,
    '4 off-pattern member files expected (uppercase, leading digit, leading underscore, too long)',
  );
  // Path separator: source carries native separators (`/` on POSIX,
  // `\` on Windows). Normalise to forward slashes for the suffix
  // assertion so the test passes on both CI runners.
  const basenames = offPattern
    .map((f) => f.source.replace(/\\/g, '/').split('/').pop())
    .sort();
  // Sort is by codepoint so digits (0x31) < uppercase (0x41) <
  // underscore (0x5f) < lowercase (0x61).
  assert.equal(basenames[0], '1bob.yaml');
  assert.equal(basenames[1], 'Dave.yaml');
  assert.equal(basenames[2], '_carol.yaml');
  assert.equal(basenames[3], `${tooLongName}.yaml`);
  // The message names the pattern so the operator can debug without
  // leaving for --help.
  for (const f of offPattern) {
    assert.match(f.message, /\[a-z\]\[a-z0-9_-\]\{0,31\}\.yaml/);
  }
});

test('doctor: subdirectory under members/ surfaces as unrecognized_directory', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  mkdirSync(join(root, 'members', 'archived'));

  const r = runGate(root, ['doctor', '--format', 'json']);
  assert.notEqual(r.status, 0);
  const payload = JSON.parse(r.stdout);
  const findings = payload.findings as Array<{
    area: string;
    kind: string;
    source: string;
    message: string;
  }>;
  const dirs = findings.filter(
    (f) => f.area === 'members' && f.kind === 'unrecognized_directory',
  );
  assert.equal(dirs.length, 1);
  assert.match(dirs[0]!.message, /no legitimate place for nested directories/);
});

test('doctor: non-yaml files in issues/ and members/ are NOT surfaced', (t) => {
  // Boundary mirrors requests-side test: the scan is opinionated
  // about *attempted records*. notes.txt / README.md / .gitkeep are
  // legitimately useful for repo authors to leave in record
  // directories.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  writeFileSync(join(root, 'issues', 'notes.txt'), 'human notes');
  writeFileSync(join(root, 'issues', '.gitkeep'), '');
  writeFileSync(join(root, 'issues', 'README.md'), '# notes');
  writeFileSync(join(root, 'members', 'notes.txt'), 'roster notes');
  writeFileSync(join(root, 'members', '.gitkeep'), '');
  writeFileSync(join(root, 'members', 'README.md'), '# roster');

  const r = runGate(root, ['doctor', '--format', 'json']);
  assert.equal(r.status, 0, 'no findings → exit 0');
  const payload = JSON.parse(r.stdout);
  assert.deepEqual(payload.findings, []);
});

test('repair --apply: off-pattern issue file is quarantined; off-pattern member file is quarantined', (t) => {
  // Mirror the requests-side repair contract: off-pattern .yaml in
  // any record directory gets quarantined (the listAll regex was
  // ignoring it anyway, moving it to quarantine/ is safe and
  // reversible).
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  writeFileSync(join(root, 'issues', 'bogus.yaml'), 'stray');
  // Use `Dave.yaml` (no `dave.yaml` in the bootstrap fixture) so the
  // case-insensitive Windows filesystem doesn't fold this into the
  // existing `alice.yaml` and silently un-plant the test input.
  writeFileSync(
    join(root, 'members', 'Dave.yaml'),
    'name: Dave\ncategory: professional\nactive: true\n',
  );

  const planJson = runGate(root, ['doctor', '--format', 'json']);
  const r = runGate(
    root,
    ['repair', '--apply'],
    {},
    planJson.stdout,
  );
  assert.equal(r.status, 0);
  // Both files were quarantined.
  assert.match(r.stdout, /\[quarantined\].*bogus\.yaml/);
  assert.match(r.stdout, /\[quarantined\].*Dave\.yaml/);
});
