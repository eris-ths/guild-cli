// gate resume --with-doctor [--auto-repair] — #306
//
// Invariants:
//   1. --with-doctor on clean substrate → doctor.is_clean=true, no findings,
//      no auto_repair key (only present when --auto-repair flag set).
//   2. --with-doctor on dirty substrate → doctor.findings non-empty, summary
//      mentions the malformed counts. JSON payload retains pre-#306 keys.
//   3. --with-doctor --auto-repair on dirty substrate → quarantines findings,
//      auto_repair.quarantined > 0, and a re-run shows is_clean=true.
//   4. --auto-repair without --with-doctor → exit 1 with a pointed error.
//   5. text mode with --with-doctor → appends a "substrate doctor" section
//      to the prose; the pre-existing prose body remains intact.
//   6. Without --with-doctor → JSON has no `doctor` key (forward compat).

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
const GUILD = resolve(here, '../../../bin/guild.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-resume-doctor-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  mkdirSync(join(root, 'members'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? -1 };
}

function runGuild(cwd: string, args: string[]): void {
  spawnSync(process.execPath, [GUILD, ...args], { cwd, stdio: 'ignore' });
}

test('gate resume --with-doctor: clean substrate → is_clean=true, no findings', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGuild(root, ['new', '--name', 'claude', '--category', 'professional']);
    const { stdout, status } = runGate(root, ['resume', '--with-doctor'], {
      GUILD_ACTOR: 'claude',
    });
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);
    assert.ok(payload.doctor, 'doctor section should exist');
    assert.equal(payload.doctor.is_clean, true);
    assert.deepEqual(payload.doctor.findings, []);
    assert.equal(payload.doctor.auto_repair, undefined);
  } finally {
    cleanup();
  }
});

test('gate resume (no --with-doctor): doctor key absent (forward compat)', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGuild(root, ['new', '--name', 'claude', '--category', 'professional']);
    const { stdout, status } = runGate(root, ['resume'], {
      GUILD_ACTOR: 'claude',
    });
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);
    assert.equal(
      'doctor' in payload,
      false,
      'doctor key MUST be absent when --with-doctor is off',
    );
  } finally {
    cleanup();
  }
});

test('gate resume --with-doctor: dirty substrate surfaces findings', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGuild(root, ['new', '--name', 'claude', '--category', 'professional']);
    // Plant a malformed file under requests/ to produce a finding.
    mkdirSync(join(root, 'requests'), { recursive: true });
    writeFileSync(join(root, 'requests', 'garbage.yaml'), '::: not valid yaml :::\n');
    const { stdout, status } = runGate(root, ['resume', '--with-doctor'], {
      GUILD_ACTOR: 'claude',
    });
    // resume's exit code is unaffected by doctor findings — resume is
    // a read verb; non-clean substrate doesn't fail the session boot.
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);
    assert.ok(payload.doctor);
    assert.equal(payload.doctor.is_clean, false);
    assert.ok(payload.doctor.findings.length > 0);
    assert.match(payload.doctor.summary, /malformed/);
  } finally {
    cleanup();
  }
});

test('gate resume --with-doctor --auto-repair: quarantines and re-run is clean', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGuild(root, ['new', '--name', 'claude', '--category', 'professional']);
    mkdirSync(join(root, 'requests'), { recursive: true });
    writeFileSync(join(root, 'requests', 'garbage.yaml'), '::: not valid yaml :::\n');
    const first = runGate(
      root,
      ['resume', '--with-doctor', '--auto-repair'],
      { GUILD_ACTOR: 'claude' },
    );
    assert.equal(first.status, 0);
    const p1 = JSON.parse(first.stdout);
    assert.ok(p1.doctor.auto_repair, 'auto_repair block expected');
    assert.equal(p1.doctor.auto_repair.attempted, true);
    assert.ok(
      p1.doctor.auto_repair.quarantined > 0,
      'at least one finding should be quarantined',
    );
    // Re-run: substrate should now be clean.
    const second = runGate(
      root,
      ['resume', '--with-doctor'],
      { GUILD_ACTOR: 'claude' },
    );
    const p2 = JSON.parse(second.stdout);
    assert.equal(p2.doctor.is_clean, true);
  } finally {
    cleanup();
  }
});

test('gate resume --auto-repair (no --with-doctor): exit 1 with pointed error', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGuild(root, ['new', '--name', 'claude', '--category', 'professional']);
    const { status, stderr } = runGate(root, ['resume', '--auto-repair'], {
      GUILD_ACTOR: 'claude',
    });
    assert.equal(status, 1);
    assert.match(stderr, /--auto-repair requires --with-doctor/);
  } finally {
    cleanup();
  }
});

test('gate resume --with-doctor --format text: appends substrate doctor section', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGuild(root, ['new', '--name', 'claude', '--category', 'professional']);
    const { stdout, status } = runGate(
      root,
      ['resume', '--with-doctor', '--format', 'text'],
      { GUILD_ACTOR: 'claude' },
    );
    assert.equal(status, 0);
    // pre-existing prose body
    assert.match(stdout, /resuming as claude/i);
    // new section
    assert.match(stdout, /substrate doctor/i);
    assert.match(stdout, /clean/i);
  } finally {
    cleanup();
  }
});

test('gate resume --with-doctor --format text on dirty: lists findings + repair hint', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGuild(root, ['new', '--name', 'claude', '--category', 'professional']);
    mkdirSync(join(root, 'requests'), { recursive: true });
    writeFileSync(join(root, 'requests', 'garbage.yaml'), '::: not yaml :::\n');
    const { stdout, status } = runGate(
      root,
      ['resume', '--with-doctor', '--format', 'text'],
      { GUILD_ACTOR: 'claude' },
    );
    assert.equal(status, 0);
    assert.match(stdout, /substrate doctor/i);
    assert.match(stdout, /finding/i);
    assert.match(stdout, /auto-repair|gate repair/);
  } finally {
    cleanup();
  }
});
