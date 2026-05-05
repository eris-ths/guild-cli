import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseArgs,
  requireOption,
  optionalOption,
} from '../../src/interface/shared/parseArgs.js';

/**
 * Run `fn` with cwd pinned to a fresh tmpdir that has no `.guild-actor`
 * file in any ancestor. Required for tests that delete `GUILD_ACTOR`
 * and expect the env-fallback chain to fall through to "unset" — the
 * helper internally invokes `resolveGuildActor()`, which on `develop`
 * would otherwise pick up the repo-root `.guild-actor` and silently
 * satisfy the call.
 *
 * Pinned by issue #183: PRs cut from `develop` carry `.guild-actor`
 * into CI, breaking three env-unset tests below. The narrow fix is
 * cwd isolation rather than a DI seam through every callsite —
 * resolveGuildActor.test.ts already exercises the (cwd, env) matrix
 * via the explicit `start` parameter; what's missing is honest
 * isolation in tests that go through requireOption / optionalOption,
 * since those don't expose `start`.
 */
function withCleanCwd(fn: () => void): void {
  const cwdBefore = process.cwd();
  const cleanRoot = mkdtempSync(join(tmpdir(), 'parseargs-cleancwd-'));
  process.chdir(cleanRoot);
  try {
    fn();
  } finally {
    process.chdir(cwdBefore);
    rmSync(cleanRoot, { recursive: true, force: true });
  }
}

test('requireOption returns explicit value when present', () => {
  const args = parseArgs(['--from', 'kiri']);
  assert.equal(requireOption(args, 'from', '<m>'), 'kiri');
});

test('requireOption throws when key missing and no env fallback', () => {
  const args = parseArgs([]);
  assert.throws(() => requireOption(args, 'from', '<m>'), /Missing --from <m>\./);
});

test('requireOption: missing flag with env fallback names the env var', () => {
  // Touch-feel improvement: when a callsite supplies an env fallback
  // (e.g. GUILD_ACTOR for --by), forgetting the flag should hint that
  // exporting the env would also satisfy the call. Without this hint,
  // a fresh agent has to read the env-fallback section of AGENT.md to
  // discover the alternative.
  withCleanCwd(() => {
    const args = parseArgs([]);
    const prev = process.env['GUILD_ACTOR'];
    delete process.env['GUILD_ACTOR'];
    try {
      assert.throws(
        () => requireOption(args, 'by', '<m>', 'GUILD_ACTOR'),
        (e: unknown) => {
          assert.ok(e instanceof Error);
          assert.match(e.message, /Missing --by <m> \(or set GUILD_ACTOR\)\./);
          return true;
        },
      );
    } finally {
      if (prev !== undefined) process.env['GUILD_ACTOR'] = prev;
    }
  });
});

test('requireOption: missing flag without shape stays bare', () => {
  // The shape arg is optional; tests of the helper itself pass nothing
  // and want a terse "Missing --x." with no extra placeholder noise.
  const args = parseArgs([]);
  assert.throws(
    () => requireOption(args, 'from'),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.match(e.message, /^Missing --from\.$/);
      return true;
    },
  );
});

test('requireOption falls back to env var when option missing', () => {
  const args = parseArgs([]);
  const prev = process.env['GUILD_ACTOR'];
  process.env['GUILD_ACTOR'] = 'noir';
  try {
    assert.equal(
      requireOption(args, 'from', '<m>', 'GUILD_ACTOR'),
      'noir',
    );
  } finally {
    if (prev === undefined) delete process.env['GUILD_ACTOR'];
    else process.env['GUILD_ACTOR'] = prev;
  }
});

test('requireOption: explicit value wins over env fallback', () => {
  const args = parseArgs(['--from', 'kiri']);
  const prev = process.env['GUILD_ACTOR'];
  process.env['GUILD_ACTOR'] = 'noir';
  try {
    assert.equal(
      requireOption(args, 'from', '<m>', 'GUILD_ACTOR'),
      'kiri',
    );
  } finally {
    if (prev === undefined) delete process.env['GUILD_ACTOR'];
    else process.env['GUILD_ACTOR'] = prev;
  }
});

test('requireOption: empty env var is treated as unset', () => {
  withCleanCwd(() => {
    const args = parseArgs([]);
    const prev = process.env['GUILD_ACTOR'];
    process.env['GUILD_ACTOR'] = '';
    try {
      assert.throws(
        () => requireOption(args, 'from', '<m>', 'GUILD_ACTOR'),
        /Missing --from/,
      );
    } finally {
      if (prev === undefined) delete process.env['GUILD_ACTOR'];
      else process.env['GUILD_ACTOR'] = prev;
    }
  });
});

test('optionalOption returns undefined when missing and no env fallback', () => {
  const args = parseArgs([]);
  assert.equal(optionalOption(args, 'for'), undefined);
});

test('optionalOption falls back to env var', () => {
  const args = parseArgs([]);
  const prev = process.env['GUILD_ACTOR'];
  process.env['GUILD_ACTOR'] = 'rin';
  try {
    assert.equal(optionalOption(args, 'for', 'GUILD_ACTOR'), 'rin');
  } finally {
    if (prev === undefined) delete process.env['GUILD_ACTOR'];
    else process.env['GUILD_ACTOR'] = prev;
  }
});

test('optionalOption: explicit value wins over env', () => {
  const args = parseArgs(['--for', 'noir']);
  const prev = process.env['GUILD_ACTOR'];
  process.env['GUILD_ACTOR'] = 'rin';
  try {
    assert.equal(optionalOption(args, 'for', 'GUILD_ACTOR'), 'noir');
  } finally {
    if (prev === undefined) delete process.env['GUILD_ACTOR'];
    else process.env['GUILD_ACTOR'] = prev;
  }
});

test('withCleanCwd isolates the .guild-actor file fallback (issue #183 regression)', () => {
  // Simulate the develop-branch CI condition: ambient .guild-actor in
  // an ancestor directory of cwd. Without withCleanCwd, env-unset
  // tests silent-fail because resolveGuildActor() walks up and finds
  // the file. With withCleanCwd, the chdir happens before the helper
  // is ever called, so cwd has no ancestor file and the fallback is
  // genuinely empty.
  const ambientRoot = mkdtempSync(join(tmpdir(), 'parseargs-ambient-'));
  writeFileSync(join(ambientRoot, '.guild-actor'), 'ambient-leak');
  const cwdBefore = process.cwd();
  process.chdir(ambientRoot);
  const prev = process.env['GUILD_ACTOR'];
  delete process.env['GUILD_ACTOR'];
  try {
    // Sanity: without isolation, the leak resolves the actor from the
    // file. requireOption returns the file content silently — no throw.
    const leaked = requireOption(parseArgs([]), 'by', '<m>', 'GUILD_ACTOR');
    assert.equal(leaked, 'ambient-leak', 'precondition: leak should be observable');

    // With isolation: same call inside withCleanCwd throws as the test
    // contract intends, regardless of the ambient file.
    withCleanCwd(() => {
      assert.throws(
        () => requireOption(parseArgs([]), 'by', '<m>', 'GUILD_ACTOR'),
        /Missing --by/,
      );
    });
  } finally {
    if (prev !== undefined) process.env['GUILD_ACTOR'] = prev;
    process.chdir(cwdBefore);
    rmSync(ambientRoot, { recursive: true, force: true });
  }
});

// ── POSIX `--` end-of-options separator ──
//
// Regression: bare `--text "--reason - foo"` stayed boolean because
// the parser refuses to consume values that start with `--`. The
// escape valves are `--text=<value>` (already worked) and `--`
// (added here). Both need to deliver the same value unchanged.

test('parseArgs: -- separator makes subsequent tokens positional even if they start with --', () => {
  const args = parseArgs(['note', 'i-0001', '--by', 'eris', '--', '--reason', '-', '実装済']);
  assert.deepEqual(args.options, { by: 'eris' });
  assert.deepEqual(args.positional, ['note', 'i-0001', '--reason', '-', '実装済']);
});

test('parseArgs: -- separator consumes itself (not kept as a positional)', () => {
  const args = parseArgs(['foo', '--', 'bar']);
  assert.deepEqual(args.positional, ['foo', 'bar']);
});

test('parseArgs: -- separator with no following tokens is a no-op', () => {
  const args = parseArgs(['foo', '--']);
  assert.deepEqual(args.positional, ['foo']);
  assert.deepEqual(args.options, {});
});

test('parseArgs: --key=value still accepts values starting with --', () => {
  // This form already worked pre-fix (the = branch bypasses the
  // startsWith check). Pinned to prevent regression.
  const args = parseArgs(['--text=--reason - foo']);
  assert.equal(args.options['text'], '--reason - foo');
});

test('parseArgs: bare --key followed by --value still lands as boolean (ambiguous)', () => {
  // This is the documented ambiguity the separator resolves — the
  // parser has no per-flag schema so it cannot tell `--value` apart
  // from a legitimate next flag. `--key true` is the only safe call.
  const args = parseArgs(['--text', '--reason']);
  assert.equal(args.options['text'], true);
  assert.equal(args.options['reason'], true);
});

test('requireOption: boolean-landing emits a hint pointing at the escape valves', () => {
  const args = parseArgs(['--reason', '--another-flag']);
  assert.throws(
    () => requireOption(args, 'reason', '"..."'),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.match(e.message, /Missing --reason value/);
      assert.match(e.message, /--reason=<value>/);
      assert.match(e.message, /"-- <value>"/);
      return true;
    },
  );
});

test('requireOption: boolean-landing also names the env fallback when present', () => {
  // Same propagation as the missing-flag branch — if env would have
  // satisfied the call, mention it. Boolean-landing typically means
  // "you passed --by --another-flag-by-mistake", and at that point
  // the user might also benefit from knowing GUILD_ACTOR exists.
  withCleanCwd(() => {
    const args = parseArgs(['--by', '--bogus']);
    const prev = process.env['GUILD_ACTOR'];
    delete process.env['GUILD_ACTOR'];
    try {
      assert.throws(
        () => requireOption(args, 'by', '<m>', 'GUILD_ACTOR'),
        (e: unknown) => {
          assert.ok(e instanceof Error);
          assert.match(e.message, /Missing --by value \(or set GUILD_ACTOR\)\./);
          return true;
        },
      );
    } finally {
      if (prev !== undefined) process.env['GUILD_ACTOR'] = prev;
    }
  });
});

test('requireOption: plain missing flag does NOT emit the -- hint (stays terse)', () => {
  const args = parseArgs([]);
  try {
    requireOption(args, 'reason', '"..."');
    assert.fail('expected throw');
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.match(e.message, /Missing --reason "\.\.\."\./);
    assert.equal(/begin/.test(e.message), false);
  }
});

// ── KNOWN_BOOLEAN_FLAGS: `--dry-run <positional>` doesn't swallow ──

test('parseArgs: known-boolean flag stays boolean even with non-dash next token', () => {
  // The historical footgun: `gate review ... --dry-run "LGTM"` read
  // "LGTM" as --dry-run's value, silently dropping the boolean intent
  // and losing the positional. Boolean-only flags in the registry
  // short-circuit the speculative-consume rule.
  const args = parseArgs(['--dry-run', 'LGTM']);
  assert.equal(args.options['dry-run'], true);
  assert.deepEqual(args.positional, ['LGTM']);
});

test('parseArgs: explicit --dry-run=false still parses as the literal string', () => {
  // We didn't coerce the =value form — callers still see the raw
  // string. Existing call sites check `=== true`, so `--dry-run=false`
  // reads as falsy (correct) without the parser doing magic.
  const args = parseArgs(['--dry-run=false']);
  assert.equal(args.options['dry-run'], 'false');
});

test('parseArgs: non-boolean flag preserves the value-consuming behaviour', () => {
  // Regression guard: only the known list short-circuits. Unknown
  // flags keep the "next non-dash token is my value" convention.
  const args = parseArgs(['--from', 'eris', 'extra']);
  assert.equal(args.options['from'], 'eris');
  assert.deepEqual(args.positional, ['extra']);
});
