// Pins the shape of `formatContentRootDisclosure()` — the helper
// that emits the one-line orientation disclosure shared by gate,
// agora, devil and ctx when cwd isn't the canonical content root,
// or when no `guild.config.yaml` was found (silent-fallback case).
//
// Combo C3 from the 2026-05-10 eris-dogfood agora play
// ("silent-fallback-loses-signal") surfaced that the fallback
// notice identifies the situation but doesn't suggest a corrective
// next step. Slice B of wave 2026-05-11-0001 appends a `next:`
// sub-bullet to the disclosure ONLY in the fallback case
// (configFile === null). When a real config is loaded, the
// historical shape is preserved.
//
// Scope is deliberately narrow: pure formatter contract. Caller
// integration (boot, register, agora new/play, devil open) is
// exercised by their respective handler tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatContentRootDisclosure } from '../../src/interface/gate/handlers/internal.js';

const NEXT_LINE =
  '\n  next: create guild.config.yaml here, OR cd into an existing content_root';

test('formatContentRootDisclosure: null when cwd == contentRoot AND real config is loaded', () => {
  const result = formatContentRootDisclosure(
    { configFile: '/abs/repo/guild.config.yaml', contentRoot: '/abs/repo' },
    '/abs/repo',
  );
  assert.equal(result, null);
});

test('formatContentRootDisclosure: config present + cwd subdir → disclosure WITHOUT next: hint', () => {
  const result = formatContentRootDisclosure(
    { configFile: '/abs/repo/guild.config.yaml', contentRoot: '/abs/repo' },
    '/abs/repo/subdir',
  );
  assert.equal(
    result,
    'content root: /abs/repo (config: /abs/repo/guild.config.yaml)',
  );
  assert.ok(!result?.includes('next:'), 'next: hint must not leak into config-present case');
});

test('formatContentRootDisclosure: configFile null (fallback) → disclosure WITH next: hint', () => {
  const result = formatContentRootDisclosure(
    { configFile: null, contentRoot: '/tmp/some-cwd' },
    '/tmp/some-cwd',
  );
  assert.equal(
    result,
    `content root: /tmp/some-cwd (config: none — cwd used as fallback root)${NEXT_LINE}`,
  );
});

test('formatContentRootDisclosure: next: hint uses newline + 2-space indent (sub-bullet)', () => {
  const result = formatContentRootDisclosure(
    { configFile: null, contentRoot: '/x' },
    '/x',
  );
  const lines = (result as string).split('\n');
  assert.equal(lines.length, 2);
  assert.match(
    lines[0]!,
    /^content root: \/x \(config: none — cwd used as fallback root\)$/,
  );
  assert.equal(
    lines[1],
    '  next: create guild.config.yaml here, OR cd into an existing content_root',
  );
});

test('formatContentRootDisclosure: fallback case keyed on configFile, not cwd alignment', () => {
  // When configFile is null AND cwd is outside, the fallback branch
  // still owns the recovery hint — it's keyed on configFile, not on
  // cwd alignment.
  const result = formatContentRootDisclosure(
    { configFile: null, contentRoot: '/root' },
    '/elsewhere',
  );
  assert.ok(result?.includes('next: create guild.config.yaml here'));
});
