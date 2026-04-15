#!/usr/bin/env node
// run-tests.mjs — Node 20+ compatible test runner.
//
// Why this exists: `node --test "dist/tests/**/*.test.js"` (glob
// pattern on the command line) is only supported by `--test` in
// Node 22+. On Node 20 the string is interpreted as a literal file
// path which doesn't exist, and the run fails immediately. The
// previous POSIX approach (`find | xargs node --test`) worked on
// Node 20 but not on Windows.
//
// This script enumerates every *.test.js file under dist/tests
// using only Node built-ins (`fs.readdirSync` + manual recursion),
// then spawns `node --test <file1> <file2> ...`. Works identically
// on Node 20 / 22 and on Linux / Windows — which is the whole
// reason the cross-platform PR exists.
//
// Zero new dependencies, zero shell-isms.

import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(process.argv[2] ?? 'dist/tests');

/**
 * Recursively collect `*.test.js` files under `dir`. Uses
 * `withFileTypes: true` for the one readdir call per directory
 * (cheaper than stat-ing each entry). Sorted alphabetically so
 * test ordering is stable across runs.
 */
function findTests(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') {
      return out;
    }
    throw e;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findTests(full));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out;
}

const files = findTests(ROOT).sort();

if (files.length === 0) {
  process.stderr.write(
    `run-tests: no *.test.js files found under ${ROOT}\n` +
      `(did you forget to run "tsc" first?)\n`,
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--test', ...files],
  { stdio: 'inherit' },
);

if (result.error) {
  process.stderr.write(`run-tests: failed to spawn node: ${result.error.message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
