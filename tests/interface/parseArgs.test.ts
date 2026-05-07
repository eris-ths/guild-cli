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
 *
 * IMPORTANT — concurrency safety: process.chdir() is global state.
 * This helper is safe today because (a) node:test runs each *.test.js
 * file in a child process via tests/run.mjs, so chdir cannot leak
 * across files, and (b) within one file, tests run serially by
 * default. If a future change adds `test.concurrency > 1` to this
 * file or imports `withCleanCwd` into another test that runs in
 * parallel within the same process, two tests could race on cwd
 * and silent-fail on either side. Promote to a per-call DI seam
 * before parallelizing.
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

test('optionalOption: bare flag (no value) errors instead of silently passing', () => {
  // Pre-fix `--depth` (no value) silently fell through to envFallback /
  // undefined. A user typing `gate request --depth` expecting to set
  // the value would see the request go through with depth unset.
  // Surfaced in v0.5 dogfood; same fail-open class `requireOption`
  // already protected against.
  const args = parseArgs(['--depth']);
  try {
    optionalOption(args, 'depth');
    assert.fail('expected throw on bare flag');
  } catch (e) {
    assert.match((e as Error).message, /Missing --depth value\./);
    // Surface the escape-valve hint so a user whose value legitimately
    // begins with `--` (e.g. `--from --foo`) sees how to pass it.
    assert.match(
      (e as Error).message,
      /If your value begins with "--", use --depth=<value>/,
    );
  }
});

test('optionalOption: bare flag with envFallback names the env in the error', () => {
  // Sibling shape to requireOption's same-condition error; the env
  // hint propagates so a user who set GUILD_ACTOR sees that path is
  // still available even though they typo'd the flag.
  const args = parseArgs(['--for']);
  try {
    optionalOption(args, 'for', 'GUILD_ACTOR');
    assert.fail('expected throw on bare flag');
  } catch (e) {
    assert.match(
      (e as Error).message,
      /Missing --for value \(or set GUILD_ACTOR\)\./,
    );
  }
});

test('optionalOption: bare flag error fires BEFORE env fallback resolves', () => {
  // Pre-fix order was: bare flag → undefined → envFallback wins.
  // Post-fix: bare flag is itself a user error and short-circuits
  // the env path. Otherwise a typo'd `--for` would be silently
  // overridden by the ambient env, exact silent-fail-open shape.
  const args = parseArgs(['--for']);
  const prev = process.env['GUILD_ACTOR'];
  process.env['GUILD_ACTOR'] = 'should-not-be-returned';
  try {
    assert.throws(
      () => optionalOption(args, 'for', 'GUILD_ACTOR'),
      /Missing --for value/,
    );
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

// ── Per-verb boolean-flag registration (issue #158) ──
//
// Prior to #158, every boolean flag had to live in the global
// KNOWN_BOOLEAN_FLAGS set in parseArgs.ts. New verbs that forgot to
// register would have their boolean flags silently consume the next
// token. The per-verb pattern: `parseArgs(argv, { booleanFlags })`
// extends the active boolean set for one call.

test('parseArgs: booleanFlags option treats verb-local flags as boolean', () => {
  // Without registration, `--my-bool somevalue` reads "somevalue" as
  // the flag value (the slow-burning footgun the issue calls out).
  const without = parseArgs(['--my-bool', 'somevalue']);
  assert.equal(without.options['my-bool'], 'somevalue', 'precondition: leak observable');
  assert.deepEqual(without.positional, []);

  // With registration, the same argv treats --my-bool as boolean and
  // "somevalue" as the next positional, which is the intent for any
  // verb that documents --my-bool as a boolean.
  const withReg = parseArgs(['--my-bool', 'somevalue'], {
    booleanFlags: new Set(['my-bool']),
  });
  assert.equal(withReg.options['my-bool'], true);
  assert.deepEqual(withReg.positional, ['somevalue']);
});

test('parseArgs: booleanFlags is unioned with the global KNOWN_BOOLEAN_FLAGS', () => {
  // Verb-local registration MUST NOT shadow or replace the global
  // set — `dry-run` (global) and a verb-local flag both work in the
  // same call.
  const args = parseArgs(['--dry-run', 'literal-value', '--my-bool', 'positional'], {
    booleanFlags: new Set(['my-bool']),
  });
  assert.equal(args.options['dry-run'], true);
  assert.equal(args.options['my-bool'], true);
  // Both eaten tokens flow through to positional in argv order.
  assert.deepEqual(args.positional, ['literal-value', 'positional']);
});

test('parseArgs: empty booleanFlags is equivalent to omitting the option', () => {
  // Hot-path: passing `{ booleanFlags: new Set() }` should not
  // change behaviour vs `parseArgs(argv)`. Pin the equivalence so
  // a future internal refactor doesn't introduce a divergence.
  const a = parseArgs(['--foo', 'bar', '--dry-run']);
  const b = parseArgs(['--foo', 'bar', '--dry-run'], { booleanFlags: new Set() });
  assert.deepEqual(a, b);
});

test('parseArgs: --key=value form ignores booleanFlags (explicit value wins)', () => {
  // The = form is unambiguous: the user gave a literal value. Even
  // for a verb-local boolean flag, --my-bool=false should produce
  // the string "false", not coerce to true. This matches how the
  // parser handles `--dry-run=false` for the global set.
  const args = parseArgs(['--my-bool=false'], {
    booleanFlags: new Set(['my-bool']),
  });
  assert.equal(args.options['my-bool'], 'false');
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
