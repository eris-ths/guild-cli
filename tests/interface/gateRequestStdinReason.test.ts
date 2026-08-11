// `gate request --reason -` reads the reason from stdin.
//
// Why this exists: the stdin read was written twice — once while
// resolving the optional `--reason` for the template / from-agora
// paths, and once again inside the plain-request branch. The first
// read drained the stream; the second returned "" and the wave failed
// as `reason required`. The author's text was already consumed at that
// point, so the wrapper's retry advice ("pass a long reason on stdin")
// described the thing that had just been thrown away.
//
// `gate fast-track --reason -` reads once and always worked, which is
// what let the bug survive: the two verbs share the flag, the docs and
// the wrapper's guidance, and only one of them was ever exercised. The
// fast-track case is asserted here too, so a fix that regressed it
// cannot look like a pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

const REASON = 'multi-line reason\nsecond line — arrived intact';

function bootstrap(): { root: string; cleanup: () => void } {
  const root = makeTempRoot('guild-stdin-reason-');
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\nrole: member\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(root: string, args: string[], stdin?: string) {
  return spawnSync(process.execPath, [GATE, ...args], {
    cwd: root,
    encoding: 'utf8',
    input: stdin,
    env: { ...process.env, GUILD_ACTOR: 'alice' },
  });
}

for (const verb of ['request', 'fast-track'] as const) {
  test(`gate ${verb} --reason - reads the reason from stdin`, () => {
    const { root, cleanup } = bootstrap();
    try {
      const created = runGate(
        root,
        [
          verb,
          '--from',
          'alice',
          '--action',
          'stdin reason probe',
          '--reason',
          '-',
          '--format',
          'json',
        ],
        REASON,
      );
      assert.equal(
        created.status,
        0,
        `gate ${verb} exited ${created.status}: ${created.stderr}`,
      );
      const payload = JSON.parse(created.stdout) as { ok: boolean; id: string };
      assert.equal(payload.ok, true, `gate ${verb} reported not-ok`);

      // Round-trip through the store. What matters is that the
      // *recorded* reason is the piped text, not merely that the
      // command exited 0 — an empty read would still exit 0 the day
      // the domain stops requiring a non-empty reason.
      const shown = runGate(root, ['show', payload.id, '--format', 'json'], '');
      assert.equal(shown.status, 0, `gate show failed: ${shown.stderr}`);
      const record = JSON.parse(shown.stdout) as { reason?: string };
      assert.equal(
        record.reason,
        REASON,
        `gate ${verb}: reason did not survive the stdin round-trip`,
      );
    } finally {
      cleanup();
    }
  });
}
