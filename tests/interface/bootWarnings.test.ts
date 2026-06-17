import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';
import {
  GATE,
  bootstrap,
  runGate,
  escapeRegex,
  bootstrapWithMembers,
  registerMember,
  makeRequestWithTarget,
  makeRequestSessioned,
} from './_bootHelpers.js';

// -------------------- C3 / silent-fallback-loses-signal --------------------
//
// Combo C3 from the 2026-05-10 dogfood arc (substrate/agora/plays/
// eris-dogfood-0510/2026-05-10-001.yaml). Pre-this-PR, four
// enrichment paths in boot caught their own errors silently and the
// payload's status counts went on lying. Devil's concern2 on PR #105
// (agent-first-session 2026-04-16) flagged this as the gap that lets
// agents trust the snapshot more than they should.

test('#C3: clean boot has empty warnings array (no false positives)', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['boot']);
    const payload = JSON.parse(stdout);
    assert.ok(Array.isArray(payload.warnings),
      'warnings must always be an array (empty in clean case)');
    assert.equal(payload.warnings.length, 0,
      `clean bootstrap should produce zero warnings, got: ${JSON.stringify(payload.warnings)}`);

    // text format must NOT print the warning block when empty
    const { stdout: textOut } = runGate(root, ['boot', '--format', 'text']);
    assert.doesNotMatch(textOut, /warning\(s\) raised/);
  } finally {
    cleanup();
  }
});

test('#C3: broken issues path surfaces a warning instead of silent swallow', () => {
  // Sabotage the issues directory: replace it with a regular file so
  // listAll() throws when it tries to readdir(). This reproduces the
  // exact silent-swallow path the original `// issues dir may not
  // exist — non-fatal` catch was hiding.
  const { root, cleanup } = bootstrap();
  try {
    // The issues path defaults to <content_root>/issues. Create a
    // regular file at that path so the directory walk fails.
    writeFileSync(join(root, 'issues'), 'NOT A DIRECTORY');
    const { stdout, status } = runGate(root, ['boot']);
    assert.equal(status, 0, 'boot must remain non-fatal even when enrichment fails');
    const payload = JSON.parse(stdout);
    assert.ok(Array.isArray(payload.warnings));
    assert.ok(
      payload.warnings.some((w: string) => /issues enrichment failed/.test(w)),
      `expected an issues-enrichment warning; got: ${JSON.stringify(payload.warnings)}`,
    );

    // text format surfaces the warning block + the inaccuracy disclaimer
    const { stdout: textOut } = runGate(root, ['boot', '--format', 'text']);
    assert.match(textOut, /warning\(s\) raised/);
    assert.match(textOut, /issues enrichment failed/);
    assert.match(textOut, /counts in 'queues:'.*may be inaccurate/);
  } finally {
    cleanup();
  }
});

test('#C3: warning text in JSON includes the underlying error message', () => {
  // Silent try/catch dropped the error info entirely. The new shape
  // must propagate enough of `e.message` for an agent reading the
  // payload to know what actually broke.
  const { root, cleanup } = bootstrap();
  try {
    writeFileSync(join(root, 'issues'), 'NOT A DIRECTORY');
    const { stdout } = runGate(root, ['boot']);
    const payload = JSON.parse(stdout);
    const w = payload.warnings.find((s: string) =>
      /issues enrichment failed/.test(s));
    assert.ok(w, 'expected to find an issues-enrichment warning');
    // The exact ENOTDIR / EEXIST shape varies by node version; just
    // confirm SOMETHING about the error was preserved (not just the
    // generic "issues enrichment failed").
    assert.ok(
      w.length > 'issues enrichment failed (open_issues count may be inaccurate): '.length + 5,
      `warning should include the underlying error detail, got: ${w}`,
    );
  } finally {
    cleanup();
  }
});
