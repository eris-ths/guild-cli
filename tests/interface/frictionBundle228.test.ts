// Friction bundle (#228) — touch-feel UX improvements that descend
// to the standard profile, sibling to #233 (self_approve policy under
// swarm).
//
// Scope (4 sub-tasks):
//   1. flag canon: `gate review` accepts `--note` (canonical, parity
//      with the six other write verbs); `--comment` is a deprecated
//      alias kept for back-compat. Mutual-exclusion on both. Stderr
//      deprecation hint when the alias is used.
//   2. `gate review --help` lists the lenses resolved from
//      `guild.config.yaml`, not just the four defaults baked into the
//      domain enum. Discoverability lives at help time, not just
//      error time.
//   3. `gate request` emits a `suggested_next` hint mentioning
//      `gate fast-track` whenever the author and the (sole) executor
//      coincide — the self-wave case where a single-step shortcut
//      exists and the standard pending→approve→execute→complete dance
//      is overkill.
//   4. dist staleness warning ALREADY writes to stderr (verified —
//      `bin/_lib/checkDistFreshness.mjs` uses `process.stderr.write`).
//      The bundle entry is still recorded so the contract is pinned
//      against future regressions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(extraConfig = ''): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-friction-228-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n' + extraConfig,
  );
  mkdirSync(join(root, 'members'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(
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

function extractRequestId(output: string): string {
  const m = output.match(/\d{4}-\d{2}-\d{2}-\d{4}/);
  if (!m) throw new Error(`could not find request id in output: ${output}`);
  return m[0];
}

// -------------------- sub-task 1: --note alias --------------------

test('#228(1): gate review accepts --note as canonical comment flag', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(root, ['register', '--name', 'alice']);
  run(root, ['register', '--name', 'bob']);
  const created = run(
    root,
    ['request', '--from', 'alice', '--action', 'do', '--reason', 'r'],
  );
  const id = extractRequestId(created.stdout + created.stderr);
  run(root, ['approve', id, '--by', 'eris']);
  run(root, ['execute', id, '--by', 'alice']);
  run(root, ['complete', id, '--by', 'alice']);
  // The new canonical flag — mirror the shape used by approve/complete.
  const r = run(root, [
    'review', id,
    '--by', 'bob',
    '--lense', 'devil',
    '--verdict', 'ok',
    '--note', 'looks ok to me',
  ]);
  assert.equal(r.status, 0, `--note should be accepted: ${r.stderr}`);
  assert.match(r.stdout, /✓ review recorded/);
  // Deprecation notice MUST NOT fire when the canonical flag is used.
  assert.equal(/deprecated alias/.test(r.stderr), false,
    `--note should not trigger the deprecation notice; got: ${r.stderr}`);
});

test('#228(1): gate review still accepts --comment but warns on stderr', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(root, ['register', '--name', 'alice']);
  run(root, ['register', '--name', 'bob']);
  const created = run(
    root,
    ['request', '--from', 'alice', '--action', 'do', '--reason', 'r'],
  );
  const id = extractRequestId(created.stdout + created.stderr);
  run(root, ['approve', id, '--by', 'eris']);
  run(root, ['execute', id, '--by', 'alice']);
  run(root, ['complete', id, '--by', 'alice']);
  const r = run(root, [
    'review', id,
    '--by', 'bob',
    '--lense', 'devil',
    '--verdict', 'ok',
    '--comment', 'still works',
  ]);
  assert.equal(r.status, 0,
    `--comment back-compat path must still succeed: ${r.stderr}`);
  assert.match(r.stdout, /✓ review recorded/);
  // Deprecation notice rides stderr so JSON callers stay clean.
  assert.match(r.stderr, /--comment is a deprecated alias of --note/);
});

test('#228(1): gate review rejects --note + --comment together', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(root, ['register', '--name', 'alice']);
  run(root, ['register', '--name', 'bob']);
  const created = run(
    root,
    ['request', '--from', 'alice', '--action', 'do', '--reason', 'r'],
  );
  const id = extractRequestId(created.stdout + created.stderr);
  run(root, ['approve', id, '--by', 'eris']);
  run(root, ['execute', id, '--by', 'alice']);
  run(root, ['complete', id, '--by', 'alice']);
  const r = run(root, [
    'review', id,
    '--by', 'bob',
    '--lense', 'devil',
    '--verdict', 'ok',
    '--note', 'a',
    '--comment', 'b',
  ]);
  assert.notEqual(r.status, 0, 'mutual-exclusion should fail loudly');
  assert.match(r.stderr + r.stdout, /mutually exclusive/);
});

// -------------------- sub-task 2: lense help dynamic --------------------

test('#228(2): gate review --help lists the resolved lenses (default config)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = run(root, ['review', '--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /accepted lenses .*resolved from guild\.config\.yaml/);
  // The four defaults must be present without a custom config.
  assert.match(r.stdout, /devil/);
  assert.match(r.stdout, /layer/);
  assert.match(r.stdout, /cognitive/);
  assert.match(r.stdout, /user/);
  // The deprecation note for --comment is also surfaced at help time.
  assert.match(r.stdout, /--comment is a deprecated alias of --note/);
});

test('#228(2): gate review --help reflects custom lenses from guild.config.yaml', (t) => {
  // Custom lense list — `security` and `perf` are NOT in the domain
  // defaults but should appear in help when configured.
  const { root, cleanup } = bootstrap(
    'lenses: [devil, layer, cognitive, user, security, perf]\n',
  );
  t.after(cleanup);
  const r = run(root, ['review', '--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /security/);
  assert.match(r.stdout, /perf/);
});

// -------------------- sub-task 3: self-wave fast-track hint --------------

test('#228(3): gate request hints fast-track when author == executor', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(root, ['register', '--name', 'alice']);
  // Self-wave: --executor matches --from. The hint mentions fast-track
  // alongside the standard approve next-step.
  const r = run(root, [
    'request',
    '--from', 'alice',
    '--action', 'self-do',
    '--reason', 'just me',
    '--executor', 'alice',
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /suggested_next:.*fast-track/);
});

test('#228(3): gate request does NOT hint fast-track when executor differs', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(root, ['register', '--name', 'alice']);
  run(root, ['register', '--name', 'bob']);
  const r = run(root, [
    'request',
    '--from', 'alice',
    '--action', 'cross',
    '--reason', 'r',
    '--executor', 'bob',
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(/fast-track/.test(r.stdout), false,
    'cross-actor wave should not push the self-flow shortcut');
});

// -------------------- sub-task 4: dist stale → stderr (regression pin) ---

test('#228(4): dist staleness warning rides stderr (does not pollute stdout)', async () => {
  // The helper writes to process.stderr.write. Pin the contract by
  // importing the helper directly and capturing both streams — same
  // shape as distFreshness.test.ts but with an explicit assertion that
  // stdout is empty so a future regression that flips to console.log
  // / process.stdout.write is caught here.
  const { mkdtempSync: mk, writeFileSync: wf, mkdirSync: md, rmSync: rm, utimesSync: ut } =
    await import('node:fs');
  const { tmpdir: td } = await import('node:os');
  const { pathToFileURL } = await import('node:url');
  const root = mk(join(td(), 'friction-228-stale-'));
  try {
    const src = join(root, 'src');
    const dist = join(root, 'dist', 'src');
    md(src, { recursive: true });
    md(dist, { recursive: true });
    wf(join(src, 'a.ts'), '// src');
    wf(join(dist, 'a.js'), '// dist');
    const old = (Date.now() - 60000) / 1000;
    const now = Date.now() / 1000;
    ut(join(dist, 'a.js'), old, old);
    ut(join(src, 'a.ts'), now, now);

    const helperUrl = pathToFileURL(
      resolve(here, '../../../bin/_lib/checkDistFreshness.mjs'),
    ).href;
    const helper = await import(helperUrl) as {
      checkDistFreshness: (s: string, d: string) => void;
    };

    // Capture stdout AND stderr.
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    let outCap = '';
    let errCap = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = (c: string | Uint8Array): boolean => {
      outCap += c.toString();
      return true;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = (c: string | Uint8Array): boolean => {
      errCap += c.toString();
      return true;
    };
    try {
      helper.checkDistFreshness(src, dist);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stdout as any).write = origOut;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stderr as any).write = origErr;
    }
    assert.equal(outCap, '',
      `stdout must remain pristine for JSON consumers; got: ${outCap}`);
    assert.match(errCap, /dist\/ is stale/);
  } finally {
    rm(root, { recursive: true, force: true });
  }
});
