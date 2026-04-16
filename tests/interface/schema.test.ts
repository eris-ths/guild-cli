// gate schema — drift + shape stability.
//
// schema.ts is hand-maintained. This test keeps it honest by
// comparing the VERBS list to the actual CLI dispatch table in
// index.ts. If someone adds a case to main() without updating
// schema.ts (or vice versa), this test fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VERBS } from '../../src/interface/gate/handlers/schema.js';

const here = dirname(fileURLToPath(import.meta.url));

test('gate schema: every VERBS entry matches a case in index.ts dispatch', () => {
  const indexPath = join(here, '../../../src/interface/gate/index.ts');
  const src = readFileSync(indexPath, 'utf8');
  const dispatchedVerbs = new Set<string>();
  for (const m of src.matchAll(/case '([a-z-]+)':/g)) {
    dispatchedVerbs.add(m[1]!);
  }
  for (const v of VERBS) {
    assert.ok(
      dispatchedVerbs.has(v.name),
      `schema lists "${v.name}" but index.ts has no 'case' for it (drift)`,
    );
  }
});

test('gate schema: every dispatched verb has a VERBS entry', () => {
  const indexPath = join(here, '../../../src/interface/gate/index.ts');
  const src = readFileSync(indexPath, 'utf8');
  const dispatchedVerbs = new Set<string>();
  for (const m of src.matchAll(/case '([a-z-]+)':/g)) {
    dispatchedVerbs.add(m[1]!);
  }
  const schemaNames = new Set(VERBS.map((v) => v.name));
  for (const name of dispatchedVerbs) {
    assert.ok(
      schemaNames.has(name),
      `index.ts dispatches "${name}" but schema.ts does not list it — add it to VERBS`,
    );
  }
});

test('gate schema: write verbs all declare the writeResponse output', () => {
  const writeVerbs = VERBS.filter((v) => v.category === 'write');
  // At minimum, request/approve/deny/execute/complete/fail/review/fast-track
  // must all expose `writeResponseSchema` shape so agents can rely on
  // ok/id/state/message/suggested_next being present.
  const expected = [
    'request',
    'approve',
    'deny',
    'execute',
    'complete',
    'fail',
    'review',
    'fast-track',
  ];
  for (const name of expected) {
    const v = writeVerbs.find((w) => w.name === name);
    assert.ok(v, `expected write verb ${name} in schema`);
    const required = v!.output.required ?? [];
    assert.ok(
      required.includes('suggested_next'),
      `verb ${name} output must declare suggested_next as required`,
    );
  }
});

test('gate schema: input required fields are a subset of declared properties', () => {
  // Catches typos like required: ['reasnon'] that would never
  // actually match an input arg.
  for (const v of VERBS) {
    const props = Object.keys(v.input.properties ?? {});
    const required = v.input.required ?? [];
    for (const r of required) {
      assert.ok(
        props.includes(r),
        `verb ${v.name}: required field '${r}' is not among its declared properties [${props.join(', ')}]`,
      );
    }
  }
});
