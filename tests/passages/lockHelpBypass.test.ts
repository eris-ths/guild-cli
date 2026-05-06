// <write-verb> --help must bypass the lock (issue #200).
//
// Pre-#200 path:
//   1. main() top-level `--help` check matches only the bare flag
//   2. <write-verb> --help → withEntryLock acquires (or fails)
//   3. handler's rejectUnknownFlags throws HelpRequested
//   4. catch renders help, but if step 2 saw a contended lock the
//      user gets `lock_busy` instead.
//
// Post-#200: detect args.options.help in main() and route dispatch
// around withEntryLock entirely.
//
// Pin all four entries (gate / agora / devil / ctx) since each has
// the same shape and the same regression risk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BIN = (n: string) => resolve(here, '../../../bin', `${n}.mjs`);

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'help-bypass-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// Pre-seed `.guild-lock` with the test runner's own pid so the
// staleness reclaim refuses (alive + ancestor-pid safety valve +
// recent started_at). Any verb hitting withEntryLock would throw
// LockBusyError; --help must avoid that path entirely.
function seedBusyLock(root: string, passage: string): void {
  const meta = {
    pid: process.pid,
    ppid: process.ppid,
    started_at: new Date().toISOString(),
    verb: 'someverb',
    actor: 'someone-else',
    host: 'test-host',
    cwd: root,
    passage,
    guild_cli_version: '0.0.0-test',
  };
  writeFileSync(join(root, '.guild-lock'), JSON.stringify(meta, null, 2) + '\n');
}

function run(
  bin: string,
  cwd: string,
  args: string[],
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    env: { ...process.env, GUILD_ACTOR: 'alice' },
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

// One canonical write verb per entry. The point isn't to exhaust
// the verb space — it's to pin "lock contention does not block help"
// at the entry layer. Each binary uses the same pre-lock check.
const CASES: Array<{ entry: string; verb: string }> = [
  { entry: 'gate', verb: 'approve' },
  { entry: 'agora', verb: 'play' },
  { entry: 'devil', verb: 'open' },
  { entry: 'ctx', verb: 'record' },
];

for (const { entry, verb } of CASES) {
  test(`${entry} ${verb} --help bypasses contended lock`, (t) => {
    const { root, cleanup } = bootstrap();
    t.after(cleanup);
    seedBusyLock(root, entry);
    const r = run(BIN(entry), root, [verb, '--help']);
    assert.equal(
      r.status,
      0,
      `expected help to succeed despite contended lock; stderr=${r.stderr}`,
    );
    // The handler's rejectUnknownFlags throws HelpRequested which the
    // top-level catch renders to stdout. Pin "help text actually
    // emitted" rather than just "no lock_busy".
    assert.ok(
      r.stdout.length > 0,
      `expected help text on stdout; got status=${r.status} stdout=<${r.stdout}> stderr=<${r.stderr}>`,
    );
    assert.doesNotMatch(
      r.stderr,
      /lock_busy|another guild-cli write is in flight/,
      'help path must not surface lock_busy',
    );
  });
}
