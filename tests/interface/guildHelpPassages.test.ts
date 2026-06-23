// guild --help discloses the passages (CLI↔doc friction #7)
//
// guild is the admin-side helper for managing actors; the work runs
// through the passages (gate / agora / devil / ctx), each a separate CLI.
// Pre-this, `guild --help` listed only member-management verbs, so an
// agent that entered via `guild` had no in-CLI path to the passages — an
// orientation-disclosure gap (principle 09). This pins that guild --help
// now names the four passages and points a newcomer at `gate --help`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GUILD = resolve(here, '../../../bin/guild.mjs');

function guildHelp(): string {
  const r = spawnSync(process.execPath, [GUILD, '--help'], { encoding: 'utf8' });
  return (r.stdout ?? '') + (r.stderr ?? '');
}

test('guild --help names the four passages with their --help pointers', () => {
  const out = guildHelp();
  for (const passage of ['gate', 'agora', 'devil', 'ctx']) {
    assert.match(out, new RegExp(`${passage}\\b`), `mentions ${passage}`);
    assert.match(out, new RegExp(`${passage} --help`), `points at ${passage} --help`);
  }
});

test('guild --help points a newcomer at gate and the full map', () => {
  const out = guildHelp();
  assert.match(out, /Start with `gate --help`/);
  assert.match(out, /AGENT\.md/);
});

test('guild --help still documents member management', () => {
  const out = guildHelp();
  // the original purpose must remain front-and-center
  assert.match(out, /member management/);
  assert.match(out, /guild list/);
});
