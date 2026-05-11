// gate doctor sweep-traps — trap-memory retirement (#327, axis 5).
//
// Pinned here:
//   - dry-run lists what would be swept without touching the filesystem
//   - --apply moves expired traps to <content_root>/trap-quarantine/
//     and appends a `quarantine` event to trap-retirement-log.yaml
//   - --revive <name> moves a quarantined trap back AND appends a
//     `revive` event to the same log
//   - relevant_until: indefinite is never auto-swept
//   - relevant_until: <future-date> is not swept
//   - relevant_until: <past-date> IS swept
//   - no frontmatter at all → safe default (kept), per principle 04
//   - --apply and --revive are mutually exclusive
//   - quarantine + revive round-trip leaves the file at its original
//     path with byte-identical contents and the log carrying both events

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  writeFileSync,
  rmSync,
  mkdirSync,
  readFileSync,
  existsSync,
  statSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

interface Bootstrap {
  root: string;
  trapDir: string;
  quarantineDir: string;
  logPath: string;
  cleanup: () => void;
}

function bootstrap(): Bootstrap {
  const root = makeTempRoot('guild-sweep-traps-');
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox', 'lore', 'lore/traps']) {
    mkdirSync(join(root, d), { recursive: true });
  }
  for (const s of ['pending', 'approved', 'executing', 'completed', 'failed', 'denied']) {
    mkdirSync(join(root, 'requests', s));
  }
  // One member so the misconfigured-cwd warning never fires —
  // sweep-traps doesn't depend on it, but the bootstrap is shared
  // shape across the doctor test family.
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  return {
    root,
    trapDir: join(root, 'lore', 'traps'),
    quarantineDir: join(root, 'trap-quarantine'),
    logPath: join(root, 'trap-retirement-log.yaml'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function runGate(
  cwd: string,
  args: string[],
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, GUILD_ACTOR: 'eris' },
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

function writeTrap(trapDir: string, name: string, frontmatter: string | null, body = 'body\n'): void {
  const fm = frontmatter === null ? '' : `---\n${frontmatter}\n---\n`;
  writeFileSync(join(trapDir, name), `${fm}${body}`, 'utf8');
}

test('sweep-traps dry-run lists expired traps without touching disk', (t) => {
  const b = bootstrap();
  t.after(b.cleanup);
  writeTrap(b.trapDir, 'trap_old.md', 'relevant_until: 2024-01-01');
  writeTrap(b.trapDir, 'trap_new.md', 'relevant_until: 2099-01-01');
  writeTrap(b.trapDir, 'trap_indef.md', 'relevant_until: indefinite');
  writeTrap(b.trapDir, 'trap_bare.md', null);

  const r = runGate(b.root, ['doctor', 'sweep-traps']);
  assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
  // Expired one is flagged for sweep
  assert.match(r.stdout, /\[sweep\] trap_old\.md/);
  // Future-dated, indefinite, bare are all kept
  assert.match(r.stdout, /\[keep-future\] trap_new\.md/);
  assert.match(r.stdout, /\[keep-indefinite\] trap_indef\.md/);
  assert.match(r.stdout, /\[keep-indefinite\] trap_bare\.md/);
  // Dry-run must not have created quarantine dir or log
  assert.equal(existsSync(b.quarantineDir), false);
  assert.equal(existsSync(b.logPath), false);
  // The expired trap is still where it was
  assert.equal(existsSync(join(b.trapDir, 'trap_old.md')), true);
});

test('sweep-traps --apply quarantines expired and writes audit log', (t) => {
  const b = bootstrap();
  t.after(b.cleanup);
  writeTrap(b.trapDir, 'trap_expired.md', 'relevant_until: 2020-06-15');
  writeTrap(b.trapDir, 'trap_indef.md', 'relevant_until: indefinite');

  const r = runGate(b.root, ['doctor', 'sweep-traps', '--apply']);
  assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
  // Expired trap moved
  assert.equal(existsSync(join(b.trapDir, 'trap_expired.md')), false);
  assert.equal(
    existsSync(join(b.quarantineDir, 'trap_expired.md')),
    true,
  );
  // Indefinite trap untouched
  assert.equal(existsSync(join(b.trapDir, 'trap_indef.md')), true);
  // Log file carries one event
  const log = readFileSync(b.logPath, 'utf8');
  assert.match(log, /^events:/);
  assert.match(log, /action: quarantine/);
  assert.match(log, /trap: trap_expired\.md/);
  assert.match(log, /by: eris/);
  assert.match(log, /reason: ".*relevant_until: 2020-06-15.*"/);
});

test('sweep-traps --revive restores quarantined trap and appends revive event', (t) => {
  const b = bootstrap();
  t.after(b.cleanup);
  writeTrap(b.trapDir, 'trap_recall.md', 'relevant_until: 2020-01-01', 'original-body\n');

  // Sweep first
  const sweep = runGate(b.root, ['doctor', 'sweep-traps', '--apply']);
  assert.equal(sweep.status, 0, `stderr=${sweep.stderr}`);
  const quarantined = join(b.quarantineDir, 'trap_recall.md');
  const quarantinedBytes = readFileSync(quarantined);
  assert.equal(existsSync(join(b.trapDir, 'trap_recall.md')), false);

  // Revive
  const revive = runGate(b.root, [
    'doctor',
    'sweep-traps',
    '--revive',
    'trap_recall.md',
  ]);
  assert.equal(revive.status, 0, `stderr=${revive.stderr}\nstdout=${revive.stdout}`);
  // File back at trap dir with byte-identical content
  const restored = readFileSync(join(b.trapDir, 'trap_recall.md'));
  assert.deepEqual(Uint8Array.from(restored), Uint8Array.from(quarantinedBytes));
  // Quarantine slot is freed (rename, not copy)
  assert.equal(existsSync(quarantined), false);
  // Log carries BOTH events in order
  const log = readFileSync(b.logPath, 'utf8');
  const quarantineIdx = log.indexOf('action: quarantine');
  const reviveIdx = log.indexOf('action: revive');
  assert.notEqual(quarantineIdx, -1);
  assert.notEqual(reviveIdx, -1);
  assert.ok(quarantineIdx < reviveIdx, 'expected quarantine event before revive event');
});

test('sweep-traps treats no-frontmatter trap as indefinite (safe default)', (t) => {
  const b = bootstrap();
  t.after(b.cleanup);
  writeTrap(b.trapDir, 'trap_bare.md', null, 'no frontmatter at all\n');
  const r = runGate(b.root, ['doctor', 'sweep-traps', '--apply']);
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  // Trap stays put; nothing was quarantined
  assert.equal(existsSync(join(b.trapDir, 'trap_bare.md')), true);
  assert.equal(existsSync(b.quarantineDir), false);
  assert.equal(existsSync(b.logPath), false);
});

test('sweep-traps does not sweep traps with future relevant_until', (t) => {
  const b = bootstrap();
  t.after(b.cleanup);
  writeTrap(b.trapDir, 'trap_future.md', 'relevant_until: 2099-12-31');
  const r = runGate(b.root, ['doctor', 'sweep-traps', '--apply']);
  assert.equal(r.status, 0);
  assert.equal(existsSync(join(b.trapDir, 'trap_future.md')), true);
  assert.equal(existsSync(b.quarantineDir), false);
});

test('sweep-traps refuses --apply + --revive together', (t) => {
  const b = bootstrap();
  t.after(b.cleanup);
  const r = runGate(b.root, [
    'doctor',
    'sweep-traps',
    '--apply',
    '--revive',
    'trap_x.md',
  ]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /mutually exclusive/);
});

test('sweep-traps --revive rejects path-bearing names', (t) => {
  const b = bootstrap();
  t.after(b.cleanup);
  // No quarantined file matters — the rejection is at the boundary.
  const r = runGate(b.root, [
    'doctor',
    'sweep-traps',
    '--revive',
    '../escape.md',
  ]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /bare filename/);
});

test('sweep-traps --revive errors when no such quarantined trap exists', (t) => {
  const b = bootstrap();
  t.after(b.cleanup);
  const r = runGate(b.root, [
    'doctor',
    'sweep-traps',
    '--revive',
    'trap_ghost.md',
  ]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no quarantined trap/);
});

test('sweep-traps --apply without expired traps is a no-op', (t) => {
  const b = bootstrap();
  t.after(b.cleanup);
  writeTrap(b.trapDir, 'trap_indef.md', 'relevant_until: indefinite');
  const r = runGate(b.root, ['doctor', 'sweep-traps', '--apply']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /no expired traps/);
  assert.equal(existsSync(b.quarantineDir), false);
  assert.equal(existsSync(b.logPath), false);
});

test('sweep-traps --format json on dry-run emits a structured envelope', (t) => {
  const b = bootstrap();
  t.after(b.cleanup);
  writeTrap(b.trapDir, 'trap_old.md', 'relevant_until: 2020-01-01');
  writeTrap(b.trapDir, 'trap_indef.md', 'relevant_until: indefinite');
  const r = runGate(b.root, ['doctor', 'sweep-traps', '--format', 'json']);
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const parsed = JSON.parse(r.stdout) as Array<{
    trap: string;
    action: string;
    rationale: string;
    relevant_until: string | null;
  }>;
  assert.ok(Array.isArray(parsed));
  const byName = Object.fromEntries(parsed.map((e) => [e.trap, e]));
  assert.equal(byName['trap_old.md']?.action, 'sweep');
  assert.equal(byName['trap_indef.md']?.action, 'keep-indefinite');
  assert.equal(byName['trap_old.md']?.relevant_until, '2020-01-01');
});

test('sweep-traps with empty trap dir is a clean no-op', (t) => {
  const b = bootstrap();
  t.after(b.cleanup);
  const r = runGate(b.root, ['doctor', 'sweep-traps']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /no traps under/);
});

test('sweep-traps tolerates missing trap dir entirely', (t) => {
  const b = bootstrap();
  t.after(b.cleanup);
  // Remove the trap dir entirely (bootstrap created it)
  rmSync(b.trapDir, { recursive: true, force: true });
  const r = runGate(b.root, ['doctor', 'sweep-traps']);
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
});

test('sweep-traps invalid relevant_until value is kept and surfaced', (t) => {
  const b = bootstrap();
  t.after(b.cleanup);
  writeTrap(b.trapDir, 'trap_typo.md', 'relevant_until: 2026-13-99');
  const r = runGate(b.root, ['doctor', 'sweep-traps']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\[keep-invalid\] trap_typo\.md/);
  // Apply also leaves it alone
  const apply = runGate(b.root, ['doctor', 'sweep-traps', '--apply']);
  assert.equal(apply.status, 0);
  assert.equal(existsSync(join(b.trapDir, 'trap_typo.md')), true);
});

test('sweep-traps unknown flag is rejected', (t) => {
  const b = bootstrap();
  t.after(b.cleanup);
  const r = runGate(b.root, ['doctor', 'sweep-traps', '--bogus']);
  // Unknown flag rejection lands as a thrown error → exit 1, error
  // envelope on stderr.
  assert.equal(r.status, 1);
});

test('sweep-traps round-trip preserves substrate byte-identically at trap location', (t) => {
  const b = bootstrap();
  t.after(b.cleanup);
  const original = `---\nrelevant_until: 2020-04-01\n---\n# trap body\n\nimportant content with unicode: éèà\n`;
  writeFileSync(join(b.trapDir, 'trap_rt.md'), original, 'utf8');
  const beforeBytes = readFileSync(join(b.trapDir, 'trap_rt.md'));
  const beforeStat = statSync(join(b.trapDir, 'trap_rt.md'));

  // sweep
  const sweep = runGate(b.root, ['doctor', 'sweep-traps', '--apply']);
  assert.equal(sweep.status, 0);
  assert.equal(existsSync(join(b.trapDir, 'trap_rt.md')), false);

  // revive
  const revive = runGate(b.root, [
    'doctor',
    'sweep-traps',
    '--revive',
    'trap_rt.md',
  ]);
  assert.equal(revive.status, 0, `stderr=${revive.stderr}`);

  // byte-identical contents at trap location
  const afterBytes = readFileSync(join(b.trapDir, 'trap_rt.md'));
  assert.deepEqual(Uint8Array.from(afterBytes), Uint8Array.from(beforeBytes));
  // size match (trivial check; bytewise equal already covers it)
  const afterStat = statSync(join(b.trapDir, 'trap_rt.md'));
  assert.equal(afterStat.size, beforeStat.size);

  // log carries BOTH events
  const log = readFileSync(b.logPath, 'utf8');
  const occurrences = (s: string, needle: string): number =>
    s.split(needle).length - 1;
  assert.equal(occurrences(log, 'trap: trap_rt.md'), 2);
  assert.equal(occurrences(log, 'action: quarantine'), 1);
  assert.equal(occurrences(log, 'action: revive'), 1);
});
