// _lockChild.ts — helper subprocess for the cross-passage race
// E2E suite. Parent spawns this with the following env:
//
//   CHILD_ROOT          contentRoot for withGuildLock
//   CHILD_BARRIER       barrier path (also passed as GUILD_LOCK_TEST_BARRIER)
//   CHILD_READY         ready-marker path; we touch it just before
//                       calling withGuildLock so the parent can
//                       wait for "all children at the gate" before
//                       releasing the barrier
//   CHILD_PASSAGE       cosmetic; recorded in lock metadata
//   CHILD_VERB          cosmetic; recorded in lock metadata
//   CHILD_HOLD_MS       how long the winner sleeps inside fn
//                       (gives losers time to retry/fail observably)
//
// Exit codes:
//   0 → acquired, ran fn, released cleanly
//   2 → LockBusyError (the loser path)
//   1 → unexpected error
//
// stderr carries the error message (parent asserts on it).

import { writeFileSync } from 'node:fs';
import {
  withGuildLock,
  LockBusyError,
} from '../../../src/infrastructure/lock/guildLock.js';

function env(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.length === 0) {
    process.stderr.write(`_lockChild: missing env ${name}\n`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const root = env('CHILD_ROOT');
  const ready = env('CHILD_READY');
  const passage = env('CHILD_PASSAGE');
  const verb = env('CHILD_VERB');
  const holdMs = Number(process.env['CHILD_HOLD_MS'] ?? '50');

  // Signal "I'm at the barrier" — parent waits for this file
  // (per child) before touching the barrier file.
  writeFileSync(ready, '1', 'utf8');

  try {
    await withGuildLock(
      { contentRoot: root },
      { passage, verb, actor: 'race-test' },
      async () => {
        // Hold briefly so a contending acquire can race and lose.
        await new Promise<void>((r) => setTimeout(r, holdMs));
        return null;
      },
    );
    process.exit(0);
  } catch (e) {
    if (e instanceof LockBusyError) {
      process.stderr.write(`lock_busy: ${e.message}\n`);
      process.exit(2);
    }
    process.stderr.write(`unexpected: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}

main();
