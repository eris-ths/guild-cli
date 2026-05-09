// gate schema — drift + shape stability.
//
// schema.ts is hand-maintained. This test keeps it honest by
// comparing the VERBS list to the actual CLI dispatch table in
// index.ts. If someone adds a case to main() without updating
// schema.ts (or vice versa), this test fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { VERBS } from '../../src/interface/gate/handlers/schema.js';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrapMinimal(prefix: string): { root: string; cleanup: () => void } {
  const root = makeTempRoot(prefix);
  writeFileSync(join(root, 'guild.config.yaml'), 'content_root: .\nhost_names: [human]\n');
  mkdirSync(join(root, 'members'), { recursive: true });
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

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

// --- issue #36 Phase 1: source: 'core' | 'plugin' discriminator ---

test('gate schema --format json: every verb carries source = "core" (built-in surface)', (t) => {
  // The runtime payload must always emit `source` so consumers can
  // filter built-in vs plugin verbs without cross-checking another
  // source of truth. Built-in verbs default to 'core' regardless of
  // whether the VerbSchema entry sets the field explicitly.
  const { root, cleanup } = bootstrapMinimal('gate-schema-source-');
  t.after(cleanup);

  const r = spawnSync(process.execPath, [GATE, 'schema', '--format', 'json'], {
    cwd: root,
    env: { ...process.env },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.ok(Array.isArray(payload.verbs), 'verbs array present');
  assert.ok(payload.verbs.length > 0, 'verbs array non-empty');
  for (const v of payload.verbs) {
    assert.equal(
      v.source,
      'core',
      `verb ${v.name}: built-in surface must report source="core" (got ${JSON.stringify(v.source)})`,
    );
  }
});

test('gate schema --format text: built-in verbs render without [plugin] tag', (t) => {
  // Voice budget: a [core] tag on every line would be noise. The
  // tag fires only for plugin verbs (none today), so the text
  // output stays compact for the built-in surface.
  const { root, cleanup } = bootstrapMinimal('gate-schema-source-text-');
  t.after(cleanup);

  const r = spawnSync(process.execPath, [GATE, 'schema', '--format', 'text'], {
    cwd: root,
    env: { ...process.env },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /\[plugin\]/, 'no built-in verb should render the [plugin] tag');
  assert.doesNotMatch(r.stdout, /\[core\]/, 'voice budget: [core] tag is suppressed for built-ins');
});
