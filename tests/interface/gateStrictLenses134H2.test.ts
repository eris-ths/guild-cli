// #134 H2 — gate.strict_lenses opt-in mode tests.
//
// Pin the H2 contract:
//   - default (unset / false) — gate review's allowed-lense set comes
//     from `lenses:` in guild.config.yaml (current behavior, byte-
//     identical to pre-H2).
//   - true — gate review's allowed-lense set is the unified devil
//     catalog (bundled defaults + <content_root>/devil/lenses/*.yaml
//     extensions). Unknown lenses rejected.
//   - regression: `--lense devil` always works under default config
//     (DEFAULT_LENSES include 'devil') AND under strict mode (bundled
//     catalog includes 'devil-substrate' lenses but NOT a 'devil' lense
//     — wait — the substrate-side bundled lenses are different from
//     gate's DEFAULT_LENSES. Strict-mode flip is a real migration step
//     for teams that used 'devil' as a gate framing label).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

interface RunResult {
  stdout: string;
  stderr: string;
  status: number;
}

function bootstrap(extraConfig = ''): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'gate-strict-lenses-h2-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n' + extraConfig,
  );
  mkdirSync(join(root, 'members'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(cwd: string, args: string[]): RunResult {
  const r = spawnSync(process.execPath, [GATE, ...args], { cwd, encoding: 'utf8' });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

function extractRequestId(output: string): string {
  const m = output.match(/\d{4}-\d{2}-\d{2}-\d{4}/);
  if (!m) throw new Error(`could not find request id in output: ${output}`);
  return m[0];
}

function makeReviewable(root: string, by = 'alice'): string {
  run(root, ['register', '--name', by]);
  run(root, ['register', '--name', 'bob']);
  const created = run(root, [
    'request',
    '--from', by,
    '--action', 'do',
    '--reason', 'r',
  ]);
  const id = extractRequestId(created.stdout + created.stderr);
  run(root, ['approve', id, '--by', 'eris']);
  run(root, ['execute', id, '--by', by]);
  run(root, ['complete', id, '--by', by]);
  return id;
}

// -------------------- default (unset / false) — current behavior --------------------

test('#134 H2: gate.strict_lenses unset → default DEFAULT_LENSES still accept devil', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = makeReviewable(root);
  const r = run(root, [
    'review', id,
    '--by', 'bob',
    '--lense', 'devil',
    '--verdict', 'ok',
    '--note', 'fine',
  ]);
  assert.equal(r.status, 0, `default should accept 'devil': ${r.stderr}`);
  assert.match(r.stdout, /✓ review recorded/);
});

test('#134 H2: gate.strict_lenses=false explicit → byte-identical to unset', (t) => {
  const { root, cleanup } = bootstrap('gate:\n  strict_lenses: false\n');
  t.after(cleanup);
  const id = makeReviewable(root);
  const r = run(root, [
    'review', id,
    '--by', 'bob',
    '--lense', 'devil',
    '--verdict', 'ok',
    '--note', 'fine',
  ]);
  assert.equal(r.status, 0, r.stderr);
});

test('#134 H2: gate.strict_lenses unset → unknown lense rejected per existing config.lenses', (t) => {
  // Existing behavior: unknown lense fails domain validation against
  // DEFAULT_LENSES (devil/layer/cognitive/user). H2 must NOT regress this.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = makeReviewable(root);
  const r = run(root, [
    'review', id,
    '--by', 'bob',
    '--lense', 'injection', // bundled devil catalog name, not in DEFAULT_LENSES
    '--verdict', 'ok',
    '--note', 'x',
  ]);
  assert.notEqual(r.status, 0, 'default mode must still reject lenses outside config.lenses');
  assert.match(r.stderr, /Invalid lense/);
});

// -------------------- strict mode — devil catalog --------------------

test('#134 H2: strict mode accepts a bundled devil catalog lense', (t) => {
  const { root, cleanup } = bootstrap('gate:\n  strict_lenses: true\n');
  t.after(cleanup);
  const id = makeReviewable(root);
  const r = run(root, [
    'review', id,
    '--by', 'bob',
    '--lense', 'injection', // bundled devil catalog
    '--verdict', 'ok',
    '--note', 'sql injection check',
  ]);
  assert.equal(r.status, 0, `strict mode must accept bundled catalog lense: ${r.stderr}`);
  assert.match(r.stdout, /✓ review recorded/);
});

test('#134 H2: strict mode rejects an unknown lense (not in bundled or extension)', (t) => {
  const { root, cleanup } = bootstrap('gate:\n  strict_lenses: true\n');
  t.after(cleanup);
  const id = makeReviewable(root);
  const r = run(root, [
    'review', id,
    '--by', 'bob',
    '--lense', 'totally-made-up',
    '--verdict', 'ok',
    '--note', 'x',
  ]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Invalid lense/);
});

test('#134 H2: strict mode picks up a content_root extension (G+H2 compose)', (t) => {
  const { root, cleanup } = bootstrap('gate:\n  strict_lenses: true\n');
  t.after(cleanup);
  // Register an extension via G's loader.
  const extDir = join(root, 'devil', 'lenses');
  mkdirSync(extDir, { recursive: true });
  writeFileSync(
    join(extDir, 'team-a11y.yaml'),
    [
      'name: team-a11y',
      'title: Accessibility',
      'description: keyboard nav, contrast, ARIA correctness.',
      '',
    ].join('\n'),
  );
  const id = makeReviewable(root);
  const r = run(root, [
    'review', id,
    '--by', 'bob',
    '--lense', 'team-a11y',
    '--verdict', 'ok',
    '--note', 'a11y pass',
  ]);
  assert.equal(r.status, 0, `extension must be accepted under strict mode: ${r.stderr}`);
  assert.match(r.stdout, /✓ review recorded/);
});

// -------------------- help text reflects mode --------------------

test('#134 H2: gate review --help text reflects strict-mode source', (t) => {
  const { root, cleanup } = bootstrap('gate:\n  strict_lenses: true\n');
  t.after(cleanup);
  const r = run(root, ['review', '--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /gate\.strict_lenses=true/);
  assert.match(r.stdout, /unified devil catalog/);
});

test('#134 H2: gate review --help (default) keeps the resolved-from-config wording', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = run(root, ['review', '--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /resolved from guild\.config\.yaml/);
});

// -------------------- read-after-write under strict mode --------------------

test('#134 H2: write-then-read under strict mode survives hydrate (records-outlive-writers)', (t) => {
  // Regression for the dogfood-found bug: strict mode wrote a review
  // with a bundled-catalog lense (`injection`), then `gate show` /
  // `gate list` failed hydrate because the read path only knew
  // config.lenses (= DEFAULT_LENSES) — the strict-mode allowed set
  // wasn't propagated to the hydrate path. Fix: Review.restore uses
  // parseLenseLoose so the allowed-set check only fires on fresh
  // writes, not on re-reads of historical records.
  const { root, cleanup } = bootstrap('gate:\n  strict_lenses: true\n');
  t.after(cleanup);
  const id = makeReviewable(root);
  const w = run(root, [
    'review', id,
    '--by', 'bob',
    '--lense', 'injection',
    '--verdict', 'ok',
    '--note', 'no injection vectors',
  ]);
  assert.equal(w.status, 0, `strict-mode write must succeed: ${w.stderr}`);

  // The bug surfaces on read, not write. show/list must round-trip.
  const s = run(root, ['show', id, '--format', 'json']);
  assert.equal(s.status, 0, `show must hydrate the strict-mode review: ${s.stderr}`);
  const payload = JSON.parse(s.stdout);
  assert.equal(payload.reviews.length, 1);
  assert.equal(payload.reviews[0].lense, 'injection');
});

test('#134 H2: read tolerates a lense not in the CURRENT allowed-set (config drift)', (t) => {
  // Config-drift variant: write under strict mode, then turn strict
  // OFF and re-read. The historical record must survive even though
  // `injection` is no longer in config.lenses. Same principle: the
  // record was valid at write time; the read path doesn't re-litigate
  // policy changes.
  const { root, cleanup } = bootstrap('gate:\n  strict_lenses: true\n');
  t.after(cleanup);
  const id = makeReviewable(root);
  run(root, [
    'review', id,
    '--by', 'bob',
    '--lense', 'injection',
    '--verdict', 'ok',
    '--note', 'no inj',
  ]);
  // Flip strict OFF — now the allowed set is DEFAULT_LENSES which
  // doesn't include `injection`. Read must still work.
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\ngate:\n  strict_lenses: false\n',
  );
  const s = run(root, ['show', id, '--format', 'json']);
  assert.equal(s.status, 0, `historical record must survive policy flip: ${s.stderr}`);
  const payload = JSON.parse(s.stdout);
  assert.equal(payload.reviews[0].lense, 'injection');
});

// -------------------- malformed config falls back to false --------------------

test('#134 H2: malformed gate.strict_lenses falls back to false (no crash)', (t) => {
  const { root, cleanup } = bootstrap('gate:\n  strict_lenses: "yes-please"\n');
  t.after(cleanup);
  const id = makeReviewable(root);
  const r = run(root, [
    'review', id,
    '--by', 'bob',
    '--lense', 'devil', // would be rejected if strict accidentally on (not bundled)
    '--verdict', 'ok',
    '--note', 'x',
  ]);
  assert.equal(r.status, 0, `malformed config must fall back to non-strict: ${r.stderr}`);
});
