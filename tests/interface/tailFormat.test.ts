// gate tail --format json — agent-facing JSON output.
//
// Pre-fix, gate tail was the lone read-verb without --format json
// support. Sibling verbs (voices, list, board, show, status,
// whoami) all support both formats. After PR #109 unified the
// utterance JSON shape to snake_case, exposing tail JSON closes
// the asymmetry without requiring a follow-up rename.
//
// These tests pin:
//   - empty stream emits `[]` (not error envelope) so jq pipelines
//     don't have to branch
//   - utterance JSON keys are snake_case (request_id / invoked_by /
//     completion_note / deny_reason / failure_reason) inheriting
//     the post-#109 contract
//   - --format text stays the existing default
//   - the gate schema entry for tail declares both flags
//   - typo on --format value rejects loudly (`gate tail --format
//     josn` should not silently degrade)

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
  const root = mkdtempSync(join(tmpdir(), 'guild-tail-format-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, d));
  }
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
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

test('gate tail --format json: empty stream emits [] (not error envelope)', (t) => {
  // jq pipelines should not have to branch on "is this an array or
  // an error". Same boundary `gate voices --format json` honors.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['tail', '--format', 'json']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '[]');
});

test('gate tail --format json: emits utterances with snake_case keys (post-#109)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Plant one fast-tracked request so the stream has something
  // to render. fast-track produces an `authored` utterance.
  const ft = runGate(
    root,
    [
      'fast-track',
      '--from', 'alice',
      '--action', 'try',
      '--reason', 'sample',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(ft.status, 0, `fast-track failed: ${ft.stderr}`);

  const r = runGate(root, ['tail', '--format', 'json']);
  assert.equal(r.status, 0);
  const arr = JSON.parse(r.stdout);
  assert.equal(Array.isArray(arr), true);
  assert.equal(arr.length, 1);
  const u = arr[0];
  assert.equal(u.kind, 'authored');
  // snake_case contract from #109 is preserved through tail.
  assert.ok('request_id' in u);
  assert.equal(typeof u.request_id, 'string');
  assert.ok(!('requestId' in u), 'must not emit camelCase requestId');
});

test('gate tail (no --format) still defaults to text', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(
    root,
    ['fast-track', '--from', 'alice', '--action', 'a', '--reason', 'b'],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runGate(root, ['tail']);
  assert.equal(r.status, 0);
  // Text rendering shape — a header line.
  assert.match(r.stdout, /most recent utterance\(s\)/);
});

test('gate tail --format <invalid> rejects', (t) => {
  // A typo like `--format josn` must not silently degrade to text.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['tail', '--format', 'josn']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--format must be 'json' or 'text'/);
});

test('gate tail --format json: positional N still controls limit', (t) => {
  // The positional-N + --limit shape from text mode carries to
  // JSON unchanged — pin so a future refactor doesn't drop one.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  for (let i = 0; i < 3; i++) {
    runGate(
      root,
      [
        'fast-track',
        '--from', 'alice',
        '--action', `a${i}`,
        '--reason', 'b',
      ],
      { GUILD_ACTOR: 'alice' },
    );
  }
  const r = runGate(root, ['tail', '2', '--format', 'json']);
  assert.equal(r.status, 0);
  const arr = JSON.parse(r.stdout);
  assert.equal(arr.length, 2);
});

test('gate schema declares tail format flag (orchestrator contract)', (t) => {
  // MCP wirings consume `gate schema` to discover what flags each
  // verb accepts. Pre-fix tail's schema entry was bare `input: {}`;
  // post-fix it advertises both `limit` and `format`.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['schema']);
  assert.equal(r.status, 0);
  const schema = JSON.parse(r.stdout);
  const tail = schema.verbs.find((v: { name: string }) => v.name === 'tail');
  assert.ok(tail, 'tail must be in schema');
  assert.ok(tail.input.properties.format, 'tail must advertise --format');
  assert.ok(tail.input.properties.limit, 'tail must advertise --limit');
});
