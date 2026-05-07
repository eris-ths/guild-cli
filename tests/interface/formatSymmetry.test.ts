// Format-symmetry contract test (principle 11 enforcement).
//
// Principle 11 says "JSON is the substrate, text is the projection."
// The natural reading: every verb that emits a JSON envelope must
// also emit a coherent text projection (and vice versa). The
// **inverse symmetry** — that adding a JSON path doesn't drift
// from the text path — has not had a CI guard until now.
//
// What this test pins:
//   For each representative read verb across the 5 passages, on a
//   minimal-but-realistic content_root, both `--format json` and
//   `--format text` must exit 0 and produce non-empty stdout. JSON
//   mode must additionally produce parseable JSON.
//
// What it does NOT pin:
//   - Round-trip equivalence between JSON keys and text columns
//     (would require per-verb mapping; out of scope).
//   - Write verbs (open, register, etc.) where setup cost dominates.
//     Read verbs cover the regression class that matters most:
//     reflection / observability surfaces a fresh agent reaches for
//     when orienting on a substrate.
//
// Adding a new read verb that supports --format: append it to the
// CASES table below. The maintenance cost is one row.
//
// Why NOT iterate every verb in `<cli> schema`: the schema is the
// agent contract; this test should fail loudly on a regression even
// if schema and handler drifted in the same direction. A hand-rolled
// CASES list keeps the assertion source-of-truth distinct from the
// schema source-of-truth.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = resolve(here, '../../../bin');

interface Case {
  /** Bin name without `.mjs`, e.g. 'gate'. */
  cli: 'gate' | 'agora' | 'devil';
  /** Verb argv. */
  args: string[];
  /** Human-readable label for failure messages. */
  label: string;
}

// Representative read verbs across the 5 passages. Each runs cleanly
// against an empty (or minimal) content_root with no required
// positional argument. WRITE verbs and verbs requiring positionals
// are intentionally excluded — they have their own focused tests
// where the per-verb shape is asserted directly. The goal here is
// the symmetry contract, not exhaustive verb coverage.
const CASES: Case[] = [
  // gate read verbs (no positional, run cleanly on a minimal root)
  { cli: 'gate', args: ['status'], label: 'gate status' },
  { cli: 'gate', args: ['board'], label: 'gate board' },
  { cli: 'gate', args: ['schema'], label: 'gate schema' },
  { cli: 'gate', args: ['doctor'], label: 'gate doctor' },
  { cli: 'gate', args: ['tail'], label: 'gate tail' },
  { cli: 'gate', args: ['whoami'], label: 'gate whoami' },
  // agora read verbs
  { cli: 'agora', args: ['list'], label: 'agora list' },
  { cli: 'agora', args: ['schema'], label: 'agora schema' },
  // devil read verbs
  { cli: 'devil', args: ['list'], label: 'devil list' },
  { cli: 'devil', args: ['schema'], label: 'devil schema' },
];

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'fmt-symmetry-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  // One member so verbs that require an actor don't blow up on
  // the resolution step. We don't mutate state.
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(
  cli: string,
  cwd: string,
  args: string[],
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(
    process.execPath,
    [join(BIN_DIR, `${cli}.mjs`), ...args],
    {
      cwd,
      env: { ...process.env, GUILD_ACTOR: 'alice' },
      encoding: 'utf8',
    },
  );
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

for (const c of CASES) {
  test(`format symmetry: \`${c.label}\` succeeds in both --format text and --format json`, (t) => {
    const { root, cleanup } = bootstrap();
    t.after(cleanup);

    const textRun = run(c.cli, root, [...c.args, '--format', 'text']);
    const jsonRun = run(c.cli, root, [...c.args, '--format', 'json']);

    assert.equal(
      textRun.status,
      0,
      `${c.label} --format text exited ${textRun.status}; stderr:\n${textRun.stderr}`,
    );
    assert.equal(
      jsonRun.status,
      0,
      `${c.label} --format json exited ${jsonRun.status}; stderr:\n${jsonRun.stderr}`,
    );

    assert.ok(
      textRun.stdout.length > 0,
      `${c.label} --format text produced empty stdout`,
    );
    assert.ok(
      jsonRun.stdout.length > 0,
      `${c.label} --format json produced empty stdout`,
    );

    // JSON mode must parse — catches "envelope shape regressed to
    // text-with-a-pre-amble" style bugs.
    assert.doesNotThrow(
      () => JSON.parse(jsonRun.stdout),
      `${c.label} --format json produced unparseable JSON:\n${jsonRun.stdout.slice(0, 200)}`,
    );
  });
}

test('format symmetry: invalid --format value is rejected uniformly across passages', (t) => {
  // Negative: every verb that accepts --format must reject
  // unknown values with a consistent shape, not silently fall
  // back to text. Pre-fix in #135 a couple of read verbs were
  // text-only and ignored --format; the contract now is that
  // --format is universal among --format-aware verbs.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  for (const c of CASES) {
    const r = run(c.cli, root, [...c.args, '--format', 'yaml']);
    assert.notEqual(
      r.status,
      0,
      `${c.label} --format yaml should be rejected; got exit 0`,
    );
    assert.match(
      r.stderr,
      /--format must be 'json' or 'text'|--format must be 'text' or 'json'/,
      `${c.label} --format yaml stderr should name the accepted values; got:\n${r.stderr}`,
    );
  }
});
