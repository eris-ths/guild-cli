// devil-review — `devil ingest` verb tests (3 source adapters).
//
// Strict per-source v0 input shapes. Real adapters mapping actual
// /ultrareview, Claude Security, SCG output to these shapes ship as
// separate utilities; the v0 contract is what THIS verb expects.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DEVIL = resolve(here, '../../../../bin/devil.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'devil-ingest-'));
  writeFileSync(join(root, 'guild.config.yaml'), 'content_root: .\nhost_names: [human]\n');
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * Drop a fake `scg` executable inside `root/fake-bin/`, return the
 * directory path so callers can prepend it to PATH for the spawned
 * `devil ingest --from scg` test. Lets the SCG-availability check
 * (e-001 fix in src/passages/devil/interface/handlers/ingest.ts)
 * fire its `which scg` probe and find a passing binary without
 * actually requiring SCG to be installed in CI.
 *
 * The fake binary just exits 0 — we never actually invoke it (the
 * v0 ingest takes a pre-formatted JSON file, not SCG output).
 * On Windows, the probe runs `where scg`; we drop a `.cmd` shim
 * alongside the POSIX shell script so the same helper works there.
 */
function installFakeScg(root: string): string {
  const fakeBin = join(root, 'fake-bin');
  mkdirSync(fakeBin, { recursive: true });
  if (process.platform === 'win32') {
    writeFileSync(join(fakeBin, 'scg.cmd'), '@echo off\r\nexit /b 0\r\n');
  } else {
    const shimPath = join(fakeBin, 'scg');
    writeFileSync(shimPath, '#!/bin/sh\nexit 0\n');
    chmodSync(shimPath, 0o755);
  }
  return fakeBin;
}

function runDevil(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [DEVIL, ...args], {
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

function openReview(root: string): string {
  const r = runDevil(
    root,
    ['open', 'src/foo.ts', '--type', 'file', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  if (r.status !== 0) throw new Error(`open failed: ${r.stderr}`);
  return JSON.parse(r.stdout).review_id;
}

function writeJson(root: string, name: string, payload: unknown): string {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(payload, null, 2));
  return path;
}

// ---- ultrareview ----

test('ingest ultrareview: 2 bugs become 2 finding entries on the named lenses', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const inputPath = writeJson(root, 'bugs.json', {
    source: 'ultrareview',
    version: '1',
    bugs: [
      {
        lense: 'injection',
        title: 'sql concat',
        details: 'user input concatenated into raw SQL on /admin/search',
        severity: 'high',
        rationale: 'public endpoint reachable by any authenticated user',
      },
      {
        lense: 'auth-access',
        title: 'IDOR on order id',
        details: 'GET /orders/<id> returns any user order',
        severity: 'critical',
        rationale: 'no ownership check, public endpoint',
      },
    ],
  });
  const r = runDevil(
    root,
    ['ingest', reviewId, '--from', 'ultrareview', inputPath, '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.source, 'ultrareview');
  assert.equal(payload.ingested_count, 2);
  assert.deepEqual(payload.ingested_entry_ids, ['e-001', 'e-002']);
  assert.equal(payload.re_run_index, 0);

  // Verify on disk
  const show = runDevil(root, ['show', reviewId, '--format', 'json']);
  const review = JSON.parse(show.stdout).review;
  assert.equal(review.entries.length, 2);
  assert.equal(review.entries[0].persona, 'ultrareview-fleet');
  assert.equal(review.entries[0].lense, 'injection');
  assert.equal(review.entries[0].kind, 'finding');
  assert.equal(review.entries[0].severity, 'high');
  assert.equal(review.entries[1].lense, 'auth-access');
  assert.equal(review.entries[1].severity, 'critical');
  assert.equal(review.re_run_history.length, 1);
  assert.equal(review.re_run_history[0].source, 'ultrareview');
});

test('ingest ultrareview: bad lense surfaces LenseNotFound', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const inputPath = writeJson(root, 'bugs.json', {
    source: 'ultrareview',
    version: '1',
    bugs: [
      {
        lense: 'made-up',
        title: 't',
        details: 'd',
        severity: 'low',
        rationale: 'r',
      },
    ],
  });
  const r = runDevil(
    root,
    ['ingest', reviewId, '--from', 'ultrareview', inputPath],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Lense not found in catalog: made-up/);
});

// ---- claude-security ----

test('ingest claude-security: findings become entries on category lenses', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const inputPath = writeJson(root, 'cs.json', {
    source: 'claude-security',
    version: '1',
    findings: [
      {
        lense: 'crypto',
        title: 'JWT alg=none accepted',
        details: 'verifier does not pin the algorithm',
        severity: 'high',
        rationale: 'public auth path; default config accepts unsigned tokens',
      },
      {
        lense: 'deserialization',
        title: 'YAML.load on user input',
        details: 'use of unsafe YAML.load instead of safe_load',
        severity: 'medium',
        rationale: 'admin path — exploitability bounded by admin role',
      },
    ],
  });
  const r = runDevil(
    root,
    ['ingest', reviewId, '--from', 'claude-security', inputPath, '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ingested_count, 2);
  const show = runDevil(root, ['show', reviewId, '--format', 'json']);
  const review = JSON.parse(show.stdout).review;
  assert.equal(review.entries[0].persona, 'claude-security');
  assert.equal(review.entries[0].lense, 'crypto');
  assert.equal(review.entries[1].lense, 'deserialization');
});

// ---- scg ----

test('ingest scg: produces ONE kind=gate entry on supply-chain with embedded stages', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const fakeBin = installFakeScg(root); // SCG availability check (e-001)
  const inputPath = writeJson(root, 'scg.json', {
    source: 'scg',
    version: '1',
    verdict: 'CLEAR',
    stages: [
      { name: 'L1-audit', verdict: 'pass', reasoning: 'no advisories on direct deps' },
      { name: 'L2-osv', verdict: 'pass', reasoning: 'no transitive advisories matched' },
      { name: 'L3-static', verdict: 'pass', reasoning: 'no IOC patterns matched' },
      { name: 'IOC', verdict: 'pass', reasoning: 'no known malware signatures' },
      { name: 'lockfile', verdict: 'pass', reasoning: 'matches manifest' },
      { name: 'integrity', verdict: 'pass', reasoning: 'all checksums valid' },
      { name: 'env', verdict: 'pass', reasoning: 'no suspicious dev-time env' },
      { name: 'aggregate', verdict: 'CLEAR', reasoning: 'all 7 prior stages pass' },
    ],
  });
  const r = runDevil(
    root,
    ['ingest', reviewId, '--from', 'scg', inputPath, '--format', 'json'],
    {
      GUILD_ACTOR: 'alice',
      PATH: `${fakeBin}${delimiter}${process.env['PATH'] ?? ''}`,
    },
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ingested_count, 1);
  const show = runDevil(root, ['show', reviewId, '--format', 'json']);
  const review = JSON.parse(show.stdout).review;
  assert.equal(review.entries.length, 1);
  const e = review.entries[0];
  assert.equal(e.persona, 'scg-supply-chain-gate');
  assert.equal(e.lense, 'supply-chain');
  assert.equal(e.kind, 'gate');
  assert.match(e.text, /SCG verdict: CLEAR/);
  assert.equal(e.stages.length, 8);
  assert.equal(e.stages[0].name, 'L1-audit');
  assert.equal(e.stages[7].name, 'aggregate');
});

test('ingest scg with empty stages array fails', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const fakeBin = installFakeScg(root);
  const inputPath = writeJson(root, 'scg.json', {
    source: 'scg',
    version: '1',
    verdict: 'CLEAR',
    stages: [],
  });
  const r = runDevil(
    root,
    ['ingest', reviewId, '--from', 'scg', inputPath],
    {
      GUILD_ACTOR: 'alice',
      PATH: `${fakeBin}${delimiter}${process.env['PATH'] ?? ''}`,
    },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /'stages' must be a non-empty array/);
});

// ---- error paths ----

test('ingest: --from unknown source fails', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    ['ingest', reviewId, '--from', 'unknown-tool', '/tmp/x'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--from must be one of/);
});

test('ingest: missing input file fails cleanly', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    ['ingest', reviewId, '--from', 'ultrareview', '/tmp/does-not-exist-' + Date.now()],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /failed to read\/parse/);
});

test('ingest: source field mismatch fails', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  // claim source: ultrareview but invoke --from claude-security
  const inputPath = writeJson(root, 'mismatch.json', {
    source: 'ultrareview',
    version: '1',
    findings: [],
  });
  const r = runDevil(
    root,
    ['ingest', reviewId, '--from', 'claude-security', inputPath],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /source field is 'ultrareview', expected 'claude-security'/);
});

test('ingest: unsupported version fails', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const inputPath = writeJson(root, 'v2.json', {
    source: 'ultrareview',
    version: '2',
    bugs: [],
  });
  const r = runDevil(
    root,
    ['ingest', reviewId, '--from', 'ultrareview', inputPath],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /only version='1' is supported/);
});

test('ingest: missing positionals fails', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(root, ['ingest', '--from', 'ultrareview'], {
    GUILD_ACTOR: 'alice',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /<rev-id> AND <input-path> required/);
});

test('ingest: missing review (DevilReviewNotFound)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const inputPath = writeJson(root, 'x.json', {
    source: 'ultrareview',
    version: '1',
    bugs: [],
  });
  const r = runDevil(
    root,
    ['ingest', 'rev-2099-12-31-001', '--from', 'ultrareview', inputPath],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DevilReview "rev-2099-12-31-001" not found/);
});

test('ingest: re_run_history accumulates across multiple ingests', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const inputPath = writeJson(root, 'bugs.json', {
    source: 'ultrareview',
    version: '1',
    bugs: [
      {
        lense: 'composition',
        title: 't',
        details: 'd',
        severity: 'low',
        rationale: 'r',
      },
    ],
  });
  // Run twice — Claude Security in particular is stochastic-by-design
  // and re-runs are expected. The substrate keeps the history.
  runDevil(root, ['ingest', reviewId, '--from', 'ultrareview', inputPath], {
    GUILD_ACTOR: 'alice',
  });
  runDevil(root, ['ingest', reviewId, '--from', 'ultrareview', inputPath], {
    GUILD_ACTOR: 'alice',
  });
  const show = runDevil(root, ['show', reviewId, '--format', 'json']);
  const review = JSON.parse(show.stdout).review;
  assert.equal(review.entries.length, 2);
  assert.equal(review.re_run_history.length, 2);
  assert.equal(review.re_run_history[0].source, 'ultrareview');
  assert.equal(review.re_run_history[1].source, 'ultrareview');
});

test('ingest: text-mode prints summary line', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const inputPath = writeJson(root, 'bugs.json', {
    source: 'ultrareview',
    version: '1',
    bugs: [
      {
        lense: 'temporal',
        title: 't',
        details: 'd',
        severity: 'medium',
        rationale: 'r',
      },
    ],
  });
  const r = runDevil(
    root,
    ['ingest', reviewId, '--from', 'ultrareview', inputPath],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.match(r.stdout, /✓ ingested 1 entry from ultrareview/);
  assert.match(r.stdout, /ids: e-001/);
  assert.match(r.stdout, /next: devil show/);
});

test('ingest refuses after conclude (terminal-state)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  // Cover all 12 lenses so conclude can fire.
  const ALL_LENSES = [
    'injection', 'injection-parser', 'path-network', 'auth-access',
    'memory-safety', 'crypto', 'deserialization', 'protocol-encoding',
    'supply-chain', 'composition', 'temporal', 'coherence',
  ];
  for (const lense of ALL_LENSES) {
    runDevil(
      root,
      [
        'entry', reviewId,
        '--persona', 'red-team',
        '--lense', lense,
        '--kind', 'skip',
        '--text', 'irrelevant',
      ],
      { GUILD_ACTOR: 'alice' },
    );
  }
  runDevil(root, ['conclude', reviewId, '--synthesis', 'closed'], { GUILD_ACTOR: 'alice' });
  const inputPath = writeJson(root, 'late.json', {
    source: 'ultrareview',
    version: '1',
    bugs: [
      {
        lense: 'composition',
        title: 't',
        details: 'd',
        severity: 'low',
        rationale: 'r',
      },
    ],
  });
  const r = runDevil(
    root,
    ['ingest', reviewId, '--from', 'ultrareview', inputPath],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already concluded — terminal state/);
});

// ---- SCG mandatory-delegate runtime check (e-001 fix) ----

test('ingest --from scg refuses if scg is not on PATH (e-001 mandatory-delegate enforcement)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  // Deliberately do NOT install fake scg — and override PATH to a
  // tmpdir that contains nothing executable, so the spawned devil's
  // `which scg` probe returns non-zero. This pins the e-001 fix:
  // the supply-chain lense's "mandatory delegate" claim is now
  // runtime-enforced, not just documented.
  const emptyBin = join(root, 'empty-bin');
  const inputPath = writeJson(root, 'scg.json', {
    source: 'scg',
    version: '1',
    verdict: 'CLEAR',
    stages: [
      { name: 'L1-audit', verdict: 'pass', reasoning: 'no advisories' },
    ],
  });
  // Use only emptyBin in PATH; even Node's binary resolution still
  // works because we pass process.execPath as the binary directly.
  const r = runDevil(
    root,
    ['ingest', reviewId, '--from', 'scg', inputPath],
    {
      GUILD_ACTOR: 'alice',
      PATH: emptyBin, // scg WILL NOT be found via `which`
    },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /requires the supply-chain-guard 'scg' command on PATH/);
  assert.match(r.stderr, /mandatory delegate per #126 decision C/);
  assert.match(r.stderr, /e-001/);
});

test('ingest --from ultrareview is unaffected by missing scg (only scg requires the binary)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const emptyBin = join(root, 'empty-bin');
  const inputPath = writeJson(root, 'bugs.json', {
    source: 'ultrareview',
    version: '1',
    bugs: [
      {
        lense: 'composition',
        title: 't',
        details: 'd',
        severity: 'low',
        rationale: 'r',
      },
    ],
  });
  const r = runDevil(
    root,
    ['ingest', reviewId, '--from', 'ultrareview', inputPath, '--format', 'json'],
    {
      GUILD_ACTOR: 'alice',
      PATH: emptyBin, // scg not on PATH, but --from ultrareview doesn't need it
    },
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
});
