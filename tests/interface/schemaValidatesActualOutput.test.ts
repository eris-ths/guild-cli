// Schema-as-contract: actual runtime output validates against the
// declared output schema. Closes the TS-implementation/schema-
// declaration drift gap that principle 10 (schema as contract)
// names: pre-this, the TS types and the JSON Schema lived in two
// separate places (voices.ts vs schema.ts) and a rename in one
// would silently drift from the other. With this test, the schema
// is unforgeable — the runtime's actual JSON output is the live
// witness.
//
// Mira's design suggestion (review on req 2026-05-01-0001 in the
// kiri/noir/mira three-voice session): the runtime validation test
// doubles as a snapshot of the schema. If the runtime emits a
// shape that doesn't match the schema, EITHER the runtime
// regressed OR the schema is wrong; either way, CI catches it
// at the boundary that matters (what an MCP wiring would
// actually receive).
//
// Scope: tail + voices, the two verbs whose output schema was
// fleshed out in this PR. The remaining bare-output read verbs
// (status, show, list, chain, pending, repair, issues *) get
// covered as their schemas are fleshed in follow-up PRs (per
// principle 10's tracked-follow-ups list).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-schema-validate-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, d));
  }
  for (const s of ['pending', 'approved', 'executing', 'completed', 'failed', 'denied']) {
    mkdirSync(join(root, 'requests', s));
  }
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  writeFileSync(
    join(root, 'members', 'bob.yaml'),
    'name: bob\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(
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

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  description?: string;
}

/**
 * Minimal JsonSchema validator covering the draft-07 subset gate
 * uses (type, properties, required, items, enum). Returns an
 * array of error strings; empty means valid. Hand-rolled because
 * the schema vocabulary in gate is small and pulling a full ajv
 * dependency for one test is overkill.
 *
 * The validator is strict on `required` and `enum` but permissive
 * on extra properties — additional fields don't fail (open-shape
 * convention, matches how schema descriptions read). If a future
 * test wants closed-shape validation, add `additionalProperties:
 * false` recognition here.
 */
function validate(value: unknown, schema: JsonSchema, path = '$'): string[] {
  const errs: string[] = [];
  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      errs.push(`${path}: expected array, got ${typeof value}`);
      return errs;
    }
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        errs.push(...validate(value[i], schema.items, `${path}[${i}]`));
      }
    }
    return errs;
  }
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      errs.push(`${path}: expected object, got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`);
      return errs;
    }
    const v = value as Record<string, unknown>;
    if (schema.required) {
      for (const k of schema.required) {
        if (!(k in v)) errs.push(`${path}.${k}: required field missing`);
      }
    }
    if (schema.properties) {
      for (const [k, subSchema] of Object.entries(schema.properties)) {
        if (k in v) errs.push(...validate(v[k], subSchema, `${path}.${k}`));
      }
    }
    return errs;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      errs.push(`${path}: expected string, got ${typeof value}`);
      return errs;
    }
    if (schema.enum && !schema.enum.includes(value)) {
      errs.push(`${path}: value "${value}" not in enum [${schema.enum.join(', ')}]`);
    }
    return errs;
  }
  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') {
      errs.push(`${path}: expected boolean, got ${typeof value}`);
    }
    return errs;
  }
  // Untyped schema (just description) accepts anything — treat as pass.
  return errs;
}

function getSchemaForVerb(root: string, verbName: string): JsonSchema {
  // Read gate schema --verb <name> → take the (single) verb entry's
  // output property. Done this way (subprocess) rather than
  // importing from src/ so the test exercises the actual contract
  // an MCP wiring would consume.
  const r = runGate(root, ['schema', '--verb', verbName]);
  if (r.status !== 0) {
    throw new Error(`gate schema --verb ${verbName} failed: ${r.stderr}`);
  }
  const payload = JSON.parse(r.stdout);
  const verb = (payload.verbs as Array<{ name: string; output: JsonSchema }>).find(
    (v) => v.name === verbName,
  );
  if (!verb) throw new Error(`verb "${verbName}" not in schema`);
  return verb.output;
}

test('schema/runtime: gate tail --format json output validates against declared schema', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  // Plant a mix of utterance kinds: authored (fast-track),
  // review (devil-rejected request), thank. The validator should
  // accept all three discriminator values without error.
  runGate(
    root,
    ['fast-track', '--from', 'alice', '--action', 'a', '--reason', 'r'],
    { GUILD_ACTOR: 'alice' },
  );
  runGate(
    root,
    ['request', '--from', 'alice', '--action', 'b', '--reason', 'r'],
    { GUILD_ACTOR: 'alice' },
  );
  runGate(
    root,
    [
      'review', '2026-05-01-0002',
      '--by', 'bob',
      '--lense', 'devil',
      '--verdict', 'concern',
      '--comment', 'sample devil comment',
    ],
    { GUILD_ACTOR: 'bob' },
  );

  const r = runGate(root, ['tail', '--format', 'json']);
  assert.equal(r.status, 0);
  const actual = JSON.parse(r.stdout);
  const schema = getSchemaForVerb(root, 'tail');
  const errs = validate(actual, schema);
  assert.deepEqual(errs, [], `runtime output failed schema:\n${errs.join('\n')}`);
});

test('schema/runtime: gate voices --format json output validates against declared schema', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  runGate(
    root,
    ['fast-track', '--from', 'alice', '--action', 'a', '--reason', 'r'],
    { GUILD_ACTOR: 'alice' },
  );

  const r = runGate(root, ['voices', 'alice', '--format', 'json']);
  assert.equal(r.status, 0);
  const actual = JSON.parse(r.stdout);
  const schema = getSchemaForVerb(root, 'voices');
  const errs = validate(actual, schema);
  assert.deepEqual(errs, [], `runtime output failed schema:\n${errs.join('\n')}`);
});

test('schema/runtime: utterance shape uses snake_case keys (no camelCase regression)', (t) => {
  // Belt-and-suspenders: the validator above checks declared
  // schema keys are populated, but doesn't catch a regression
  // where the runtime EMITS extra camelCase fields alongside
  // the snake_case ones. Pin that explicitly so a future
  // refactor that re-introduces requestId / invokedBy etc.
  // fails loud here.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  runGate(
    root,
    ['fast-track', '--from', 'alice', '--action', 'a', '--reason', 'r'],
    { GUILD_ACTOR: 'alice' },
  );

  const r = runGate(root, ['voices', 'alice', '--format', 'json']);
  const arr = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
  for (const u of arr) {
    for (const key of Object.keys(u)) {
      assert.ok(
        !/[A-Z]/.test(key),
        `utterance key "${key}" contains uppercase — camelCase regression?`,
      );
    }
  }
});

test('schema/runtime: validator catches a deliberately-mismatched output (sanity check)', () => {
  // Sanity check the validator itself: feed it a known-bad
  // payload and confirm it produces errors. Without this test,
  // a buggy validator could silently pass the suite by
  // returning [] for everything.
  const schema: JsonSchema = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['authored', 'review', 'thank'] },
      },
      required: ['kind'],
    },
  };
  // Missing required `kind`.
  let errs = validate([{ at: '2026' }], schema);
  assert.ok(errs.length > 0, 'validator should fail on missing required');
  // `kind` not in enum.
  errs = validate([{ kind: 'bogus' }], schema);
  assert.ok(errs.length > 0, 'validator should fail on enum violation');
  // Wrong type.
  errs = validate({ not: 'array' }, schema);
  assert.ok(errs.length > 0, 'validator should fail on type mismatch');
  // Valid passes.
  errs = validate([{ kind: 'authored' }], schema);
  assert.deepEqual(errs, [], 'validator should pass on valid input');
});
