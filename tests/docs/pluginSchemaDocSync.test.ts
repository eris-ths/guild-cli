// #283 — drift detection for docs/plugin-schema.md.
//
// docs/plugin-schema.md is a hand-written field-by-field reference
// for what plugin authors receive on HookContext.request and on
// ctx.extra.review. It enumerates every Request getter (in tables)
// and references Review getters (inline in the extra.review section).
// Without this test, a new getter on Request lands undocumented and
// the doc silently lies — exactly the failure mode #280 was about.
//
// Two contracts pinned here:
//
//   1. Request: bidirectional + doc-resident allowlist
//      Every public getter on the `Request` class must be listed in
//      EITHER the doc tables (under § Request reference) OR the
//      "Intentionally undocumented Request getters" section. Adding
//      a new Request getter without updating one or the other fails
//      this test.
//      Inversely: every `request.NAME` reference in the doc tables
//      must correspond to an actual public getter on `Request`.
//      Stale doc references fail.
//
//   2. Review: doc-references-must-exist (no exhaustiveness)
//      The doc doesn't claim to enumerate every Review field, but it
//      does reference specific ones inline (`r.by`, `r.lense`, etc.).
//      Every `r.NAME` reference in the doc must correspond to an
//      actual public getter on `Review`. Stale doc references fail;
//      undocumented Review getters do NOT fail (intentional — the
//      doc surface for Review is opt-in, not exhaustive).
//
// Implementation choice: read the .d.ts files emitted by `tsc`
// rather than parsing the .ts source via the TypeScript Compiler API.
// The .d.ts is the canonical public surface (private fields are
// already stripped) and parsing is a one-liner regex. `npm test`
// runs `tsc && node tests/run.mjs`, so .d.ts is always fresh.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../../..');

const REQUEST_DTS = resolve(REPO, 'dist/src/domain/request/Request.d.ts');
const REVIEW_DTS = resolve(REPO, 'dist/src/domain/request/Review.d.ts');
const SCHEMA_DOC = resolve(REPO, 'docs/plugin-schema.md');

/**
 * Extract public getter names from a .d.ts file's exported class
 * declaration. Matches `    get NAME(): ...` lines inside the class
 * block. Methods (e.g. `hasExecutor()`, `toJSON()`) are NOT collected
 * here — methods are out of scope for the v1 sync contract per #283
 * decision 3.
 *
 * Class boundary detection: from `export declare class NAME {` to the
 * matching closing `}` at column 0. The .d.ts emitter consistently
 * indents class members, so column-0 `}` reliably terminates.
 */
function extractGetters(dtsPath: string, className: string): Set<string> {
  const text = readFileSync(dtsPath, 'utf8');
  const startRe = new RegExp(`^export declare class ${className} \\{`, 'm');
  const startMatch = startRe.exec(text);
  if (!startMatch) {
    throw new Error(`could not find class ${className} in ${dtsPath}`);
  }
  const startIdx = startMatch.index + startMatch[0].length;
  // Find the matching column-0 `}` after the class opens.
  const tail = text.slice(startIdx);
  const endRe = /^\}/m;
  const endMatch = endRe.exec(tail);
  if (!endMatch) {
    throw new Error(`could not find end of class ${className}`);
  }
  const body = tail.slice(0, endMatch.index);
  const getterRe = /^\s+get (\w+)\(\):/gm;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = getterRe.exec(body)) !== null) {
    out.add(m[1]!);
  }
  return out;
}

/**
 * Extract the field names a doc table claims for `request.NAME`. We
 * look for the literal `request.NAME` occurring inside a markdown
 * table cell — i.e. wrapped in backticks. The trailing `.value` /
 * `.map(...)` etc. is stripped so we get the bare getter name.
 */
function extractDocRequestFields(docText: string): Set<string> {
  const out = new Set<string>();
  // Match `request.NAME` inside backticks, where NAME is a simple
  // identifier. The dot-suffix (e.g. `request.from.value`) is fine —
  // we just take the first identifier after `request.`.
  // Negative lookahead `(?![\w(])` excludes method calls (e.g.
  // `request.toJSON()`) — methods are out of scope for the v1 sync
  // contract per #283 decision 3 (getter-only). The `\w` inside the
  // class is required to defeat regex backtracking: a bare `(?!\()`
  // lets greedy `\w*` shorten the match (e.g. `toJSO` of `toJSON(`)
  // until the lookahead at the next char succeeds. Including `\w`
  // forbids that escape — the run must end at a non-word char.
  const re = /`request\.([a-zA-Z_]\w*)(?![\w(])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(docText)) !== null) {
    out.add(m[1]!);
  }
  return out;
}

/**
 * Extract Review field names referenced as `r.NAME` in the doc. Same
 * shape as extractDocRequestFields but for the inline `r.X` pattern
 * used in the § ctx.extra.review (review events only) section.
 */
function extractDocReviewFields(docText: string): Set<string> {
  const out = new Set<string>();
  // Same negative-lookahead rule as Request: skip method calls.
  // See extractDocRequestFields for the backtracking-defeat rationale.
  const re = /`r\.([a-zA-Z_]\w*)(?![\w(])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(docText)) !== null) {
    out.add(m[1]!);
  }
  return out;
}

/**
 * Extract the names listed in the "Intentionally undocumented Request
 * getters" section. Each bullet starts with a backticked identifier:
 * `- \`NAME\` — explanation`.
 */
function extractUndocumentedSection(docText: string): Set<string> {
  const sectionRe = /## Intentionally undocumented Request getters([\s\S]*?)(?=\n## )/;
  const m = sectionRe.exec(docText);
  if (!m) {
    throw new Error(
      'docs/plugin-schema.md missing "## Intentionally undocumented Request getters" section',
    );
  }
  const body = m[1]!;
  const itemRe = /^-\s+`(\w+)`/gm;
  const out = new Set<string>();
  let item: RegExpExecArray | null;
  while ((item = itemRe.exec(body)) !== null) {
    out.add(item[1]!);
  }
  return out;
}

function fmt(s: Iterable<string>): string {
  return [...s].sort().join(', ') || '(none)';
}

// -------------------- Request bidirectional sync --------------------

test('#283: every Request getter is either documented or in the undocumented allowlist', () => {
  const codeGetters = extractGetters(REQUEST_DTS, 'Request');
  const docText = readFileSync(SCHEMA_DOC, 'utf8');
  const documented = extractDocRequestFields(docText);
  const undocumented = extractUndocumentedSection(docText);
  const known = new Set([...documented, ...undocumented]);

  const missing = [...codeGetters].filter((g) => !known.has(g));
  assert.equal(
    missing.length,
    0,
    `\n\n` +
      `Request getter(s) exist in code but are neither documented nor in the\n` +
      `intentionally-undocumented allowlist:\n` +
      `  ${fmt(missing)}\n\n` +
      `next: open docs/plugin-schema.md and EITHER\n` +
      `  (a) add a row under § Value-object fields / § Plain primitives /\n` +
      `      § Collections (whichever fits the return type), OR\n` +
      `  (b) add a bullet to § Intentionally undocumented Request getters\n` +
      `      with one sentence on why a plugin author should not reach\n` +
      `      for this field.\n\n` +
      `This test (#283) exists so doc-vs-code drift surfaces in CI rather\n` +
      `than silently misleading plugin authors.\n`,
  );
});

test('#283: every `request.X` reference in docs/plugin-schema.md exists as a Request getter', () => {
  const codeGetters = extractGetters(REQUEST_DTS, 'Request');
  const docText = readFileSync(SCHEMA_DOC, 'utf8');
  const documented = extractDocRequestFields(docText);

  const stale = [...documented].filter((d) => !codeGetters.has(d));
  assert.equal(
    stale.length,
    0,
    `\n\n` +
      `docs/plugin-schema.md references \`request.X\` field(s) that do NOT\n` +
      `exist as public getters on Request:\n` +
      `  ${fmt(stale)}\n\n` +
      `next: a Request getter was likely renamed or removed; update or\n` +
      `delete the corresponding row in docs/plugin-schema.md so the doc\n` +
      `stops claiming a field that doesn't exist.\n`,
  );
});

// -------------------- Review stale-reference check --------------------

test('#283: every `r.X` reference in docs/plugin-schema.md exists as a Review getter', () => {
  // Note: this is a one-way check — the doc does NOT claim to enumerate
  // every Review getter (some, like `invokedBy`, are intentionally
  // out-of-scope for the plugin surface). We only fail when the doc
  // makes a claim that no longer matches code.
  const codeGetters = extractGetters(REVIEW_DTS, 'Review');
  const docText = readFileSync(SCHEMA_DOC, 'utf8');
  const documented = extractDocReviewFields(docText);

  const stale = [...documented].filter((d) => !codeGetters.has(d));
  assert.equal(
    stale.length,
    0,
    `\n\n` +
      `docs/plugin-schema.md references \`r.X\` field(s) on Review that do\n` +
      `NOT exist as public getters:\n` +
      `  ${fmt(stale)}\n\n` +
      `next: a Review getter was likely renamed or removed; update or\n` +
      `delete the corresponding inline reference in the\n` +
      `§ ctx.extra.review section of docs/plugin-schema.md.\n`,
  );
});

// -------------------- Self-test the parser --------------------

test('#283: parser self-test — Request getter extraction returns a non-empty set', () => {
  // Sanity: if the .d.ts shape changes (tsc upgrade, target change),
  // the parser may silently return empty. Pin against that.
  const codeGetters = extractGetters(REQUEST_DTS, 'Request');
  assert.ok(
    codeGetters.size >= 20,
    `Expected ≥20 Request getters; got ${codeGetters.size}. ` +
      `This usually means the .d.ts shape changed and the parser is broken — ` +
      `update extractGetters() in this file before chasing the field-level failures.`,
  );
});
