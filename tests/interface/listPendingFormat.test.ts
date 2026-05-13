// gate `list` and `pending`: --format json|text contract.
//
// Pre-fix, neither verb accepted --format — text-only output, breaking
// the asymmetry vs every other gate read verb (board / status / voices
// / tail / show / why / summarize). Surfaced by the post-merge
// bird's-eye check report on 2026-05-03; PR adds the JSON envelope.
//
// JSON shape mirrors board's `_meta` convention:
//   {
//     requests: [<request.toJSON()>...],
//     _meta: { state, verb, filter? }
//   }
// `_meta.filter` is omitted when no filter applied.

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
  const root = mkdtempSync(join(tmpdir(), 'guild-list-pending-format-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const dir of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, dir));
  }
  for (const name of ['alice', 'bob']) {
    writeFileSync(
      join(root, 'members', `${name}.yaml`),
      `name: ${name}\ncategory: professional\nactive: true\n`,
    );
  }
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

function seedTwoPending(root: string): void {
  for (const action of ['fix one', 'fix two']) {
    runGate(
      root,
      [
        'request',
        '--from', 'alice',
        '--action', action,
        '--reason', 'r',
      ],
      {},
    );
  }
}

// ---- list ----

test('gate list --format json emits {requests, _meta} envelope', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedTwoPending(root);
  const r = runGate(
    root,
    ['list', '--state', 'pending', '--format', 'json'],
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.ok(Array.isArray(payload.requests), 'requests must be an array');
  assert.equal(payload.requests.length, 2);
  // Each request entry is a full Request.toJSON()
  for (const req of payload.requests) {
    assert.ok(req.id);
    assert.equal(req.state, 'pending');
    assert.equal(req.from, 'alice');
  }
  // _meta carries state + verb (always present)
  assert.equal(payload._meta.state, 'pending');
  assert.equal(payload._meta.verb, 'list');
  // No filter applied → no _meta.filter
  assert.equal(payload._meta.filter, undefined);
});

test('gate list --format json with --from filter echoes filter in _meta', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedTwoPending(root);
  const r = runGate(
    root,
    ['list', '--state', 'pending', '--from', 'alice', '--format', 'json'],
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.requests.length, 2);
  assert.equal(payload._meta.filter.from, 'alice');
});

test('gate list --format json with empty result returns empty requests array', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // No seed — state is empty.
  const r = runGate(
    root,
    ['list', '--state', 'pending', '--format', 'json'],
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.deepEqual(payload.requests, []);
  assert.equal(payload._meta.state, 'pending');
});

test('gate list --format text preserves prior text behavior', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedTwoPending(root);
  const r = runGate(
    root,
    ['list', '--state', 'pending', '--format', 'text'],
  );
  assert.equal(r.status, 0);
  // Text output has no JSON envelope, just the per-request lines.
  assert.doesNotMatch(r.stdout, /^\{/);
  assert.match(r.stdout, /fix one/);
  assert.match(r.stdout, /fix two/);
});

test('gate list (no --format) defaults to text', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedTwoPending(root);
  const r = runGate(
    root,
    ['list', '--state', 'pending'],
  );
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /^\{/);
});

test('gate list --format invalid is rejected', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(
    root,
    ['list', '--state', 'pending', '--format', 'yaml'],
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--format must be 'json' or 'text'/);
});

// ---- pending ----

test('gate pending --format json emits the same envelope, with _meta.verb=pending', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedTwoPending(root);
  const r = runGate(root, ['pending', '--format', 'json']);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.requests.length, 2);
  assert.equal(payload._meta.state, 'pending');
  assert.equal(payload._meta.verb, 'pending');
  assert.equal(payload._meta.filter, undefined);
});

test('gate pending --format json with --for filter echoes filter source', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedTwoPending(root);
  const r = runGate(
    root,
    ['pending', '--for', 'alice', '--format', 'json'],
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload._meta.filter.for, 'alice');
  assert.equal(payload._meta.filter.for_source, '--for');
});

test('gate pending --format json with GUILD_ACTOR scopes and reports source', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedTwoPending(root);
  const r = runGate(
    root,
    ['pending', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload._meta.filter.for, 'alice');
  assert.equal(payload._meta.filter.for_source, 'GUILD_ACTOR');
});

test('gate pending --format text preserves prior text behavior', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedTwoPending(root);
  const r = runGate(root, ['pending', '--format', 'text']);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /^\{/);
  assert.match(r.stdout, /fix one/);
});

test('gate list/pending --format json suppresses the GUILD_ACTOR filter stderr notice', (t) => {
  // The "filtered by GUILD_ACTOR=..." line is a human-facing
  // disclosure for text mode. JSON consumers already get the same
  // fact on stdout as `_meta.filter.for_source: 'GUILD_ACTOR'`, so
  // the stderr line is redundant — emitting it on every JSON
  // invocation crosses the chronic-noise threshold named by
  // lore/traps/trap_chronic_noise_blindness.md. This test pins
  // both halves of the asymmetry.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedTwoPending(root);
  // JSON: no stderr disclosure, but _meta.filter still carries the fact.
  const jsonRun = runGate(
    root,
    ['list', '--state', 'pending', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(jsonRun.status, 0);
  assert.doesNotMatch(
    jsonRun.stderr,
    /filtered by GUILD_ACTOR/,
    'JSON mode must not emit the redundant filter notice (carried structurally in _meta)',
  );
  const payload = JSON.parse(jsonRun.stdout);
  assert.equal(payload._meta.filter.for_source, 'GUILD_ACTOR');
  // Text: disclosure preserved so humans see the implicit scoping.
  const textRun = runGate(
    root,
    ['list', '--state', 'pending', '--format', 'text'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(textRun.status, 0);
  assert.match(
    textRun.stderr,
    /filtered by GUILD_ACTOR=alice/,
    'text mode must keep the filter notice — it is the only surface humans see',
  );
});

test('gate board --format json suppresses the GUILD_ACTOR filter stderr notice', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedTwoPending(root);
  const jsonRun = runGate(root, ['board', '--format', 'json'], {
    GUILD_ACTOR: 'alice',
  });
  assert.equal(jsonRun.status, 0);
  assert.doesNotMatch(
    jsonRun.stderr,
    /filtered by GUILD_ACTOR/,
    'board JSON mode must not emit the redundant filter notice (carried as _meta.filter.source)',
  );
  const payload = JSON.parse(jsonRun.stdout);
  assert.equal(payload._meta.filter.source, 'GUILD_ACTOR');
  const textRun = runGate(root, ['board', '--format', 'text'], {
    GUILD_ACTOR: 'alice',
  });
  assert.equal(textRun.status, 0);
  assert.match(textRun.stderr, /filtered by GUILD_ACTOR=alice/);
});

test('gate pending --format invalid is rejected', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['pending', '--format', 'yaml']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--format must be 'json' or 'text'/);
});

// ---- still-rejects-unknown-flags after the format addition ----

test('gate list still rejects unknown flags (format addition is targeted)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(
    root,
    ['list', '--state', 'pending', '--bogus-flag-xyz', 'x'],
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown flag/i);
});

test('gate pending still rejects unknown flags (format addition is targeted)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['pending', '--bogus-flag-xyz', 'x']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown flag/i);
});

// ---- list --format text: action truncation + newline-safety ----

test('gate list --format text shows ellipsis when action exceeds 60 chars', (t) => {
  // Pre-fix, `String(j['action']).slice(0, 60)` truncated silently:
  // a 500-char action rendered as exactly 60 chars of prefix with no
  // indicator. trap_silent_fallback_loses_signal — caller can't tell
  // prefix from full content. Fix uses truncateCodePoints, which
  // appends `...` and splits on Unicode code points (also closes the
  // UTF-16 surrogate-cleave latent bug).
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const longAction = 'x'.repeat(500);
  runGate(
    root,
    ['request', '--from', 'alice', '--action', longAction, '--reason', 'r'],
  );
  const r = runGate(root, ['list', '--state', 'pending']);
  assert.equal(r.status, 0);
  // Find the line for our request and assert it ends with '...'
  const line = r.stdout
    .split('\n')
    .find((ln) => /^\d{4}-\d{2}-\d{2}-\d+\s+\[pending\]/.test(ln));
  assert.ok(line, 'must find the pending request line');
  assert.match(line!, /\.\.\.$/, 'truncated action must end with `...`');
  // Total visible action segment is 60 chars (57 of content + 3 dots).
  const actionSegment = line!.replace(/^.*from=alice\s+/, '');
  assert.equal(actionSegment.length, 60, 'truncated segment is exactly 60 chars');
});

test('gate list --format text collapses newlines in action to U+21B5 ↵', (t) => {
  // Pre-fix, a multi-line action broke the columnar layout — the
  // second line shifted to column 0. The fix replaces every
  // \r/\n/\t run with ' ↵ ' so the table stays one line per row.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(
    root,
    [
      'request',
      '--from', 'alice',
      '--action', 'line1\nline2',
      '--reason', 'r',
    ],
  );
  const r = runGate(root, ['list', '--state', 'pending']);
  assert.equal(r.status, 0);
  // The line for our request must contain both halves on ONE line,
  // joined by the ↵ marker.
  const line = r.stdout
    .split('\n')
    .find((ln) => /^\d{4}-\d{2}-\d{2}-\d+\s+\[pending\]/.test(ln));
  assert.ok(line, 'must find the pending request line');
  assert.match(line!, /line1 ↵ line2/, 'newline collapsed to ↵ marker');
  // The line "line2" must NOT appear on its own at the start of any
  // subsequent line (which was the pre-fix layout break).
  assert.ok(
    !r.stdout.split('\n').some((ln) => /^line2\b/.test(ln)),
    'no continuation line bleeds into the table layout',
  );
});

test('gate list --format json preserves full action verbatim (no truncation)', (t) => {
  // The text-mode truncation must not leak into JSON consumers.
  // toRenderJSON emits the full string.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const longAction = 'y'.repeat(500);
  runGate(
    root,
    ['request', '--from', 'alice', '--action', longAction, '--reason', 'r'],
  );
  const r = runGate(root, ['list', '--state', 'pending', '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.requests[0].action.length, 500);
});
