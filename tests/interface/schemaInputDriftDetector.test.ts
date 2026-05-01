// Schema-as-contract: input-side drift detector.
//
// Principle 10 (lore/principles/10-schema-as-contract.md) names the
// rule that `gate schema` is the agent dispatch contract. PRs #103
// (--dry-run), #105 (--with-calibration), #111 (tail --format) all
// hit the same drift after-the-fact: the runtime accepted a flag
// that the schema didn't advertise, so MCP wirings reading the
// schema couldn't see it. Each PR was caught manually during
// fresh-agent dogfood. This test catches it mechanically.
//
// What this test does:
//   1. Walks every `*_KNOWN_FLAGS: ReadonlySet<string> = new Set([...])`
//      declaration in src/interface/gate/handlers/.
//   2. Walks every `rejectUnknownFlags(args, X, 'verb-name')` call,
//      to map KNOWN_FLAGS const → verb name.
//   3. For each verb in the compiled schema, looks up its declared
//      input.properties (minus positionals identified by description
//      prefix), and asserts equivalence with the runtime KNOWN_FLAGS
//      for that verb.
//
// What this test does NOT do:
//   - Subcommand-umbrella verbs (`issues`, `inbox` mark-read) where
//     the schema collapses multiple sub-handlers into one entry.
//     Those are listed in SUBCOMMAND_UMBRELLAS and skipped — the
//     schema model for those is structurally different (the
//     subcommand discriminator is itself an input.properties key)
//     and aligning them is a follow-up redesign, not drift in this
//     test's sense.
//
// When this test fails:
//   - Either the schema lacks a property the runtime accepts (most
//     common — add it), or
//   - The schema declares a property the runtime doesn't accept
//     (less common — usually a renamed/removed flag, fix one
//     direction).
//
// The test reads source files directly (via fs.readFileSync) rather
// than importing handler modules, so it doesn't need every
// KNOWN_FLAGS const to be exported — keeps the runtime surface
// clean while still enforcing the contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
// Walk up: dist/tests/interface → repo root, then into src/.
const HANDLERS_DIR = resolve(
  here,
  '../../../src/interface/gate/handlers',
);
const GATE = resolve(here, '../../../bin/gate.mjs');

// Subcommand umbrellas: schema collapses these into one entry with
// a `subcommand` discriminator, but runtime breaks them into per-
// subcommand KNOWN_FLAGS sets. Aligning the schema model with the
// runtime here would require either (a) emitting separate verb
// entries per subcommand, or (b) declaring per-subcommand
// input.properties via JsonSchema's `oneOf` (which gate's schema
// subset doesn't include). Either is a redesign, not drift; track
// as a follow-up.
const SUBCOMMAND_UMBRELLAS: ReadonlySet<string> = new Set([
  'issues',
  'inbox', // inbox umbrella has mark-read sub-handler with separate flags
]);

// `gate help` and the very top-level positional verb dispatcher
// don't have schema entries; they're not callable as MCP tools.
// Verbs that the schema declares but the runtime intentionally
// doesn't enforce via rejectUnknownFlags go here.
const SCHEMA_ONLY_VERBS: ReadonlySet<string> = new Set([
  // (none currently — placeholder for future)
]);

// Verbs whose runtime KNOWN_FLAGS resolution is too dynamic for the
// regex parser to follow — typically because the third arg of
// rejectUnknownFlags is a variable, not a string literal. We hard-
// code the const-name mapping here so the test still enforces
// equivalence; if the indirection ever changes (e.g. a new verb
// joins the conditional), update both runtime and this map.
//
// list/pending: src/interface/gate/handlers/request.ts:reqList uses
//   `verb === 'pending' ? PENDING_KNOWN_FLAGS : LIST_KNOWN_FLAGS`
//   with the verb name passed in as a function parameter.
const INDIRECT_VERB_TO_CONST: Record<string, string> = {
  list: 'LIST_KNOWN_FLAGS',
  pending: 'PENDING_KNOWN_FLAGS',
};

interface ParsedHandler {
  /** const name → set of declared flag names */
  knownFlagSets: Map<string, Set<string>>;
  /** const name → verb name (from rejectUnknownFlags third arg) */
  constToVerb: Map<string, string[]>;
}

/**
 * Parse one handler source file. Extracts:
 *   - `const X_KNOWN_FLAGS: ReadonlySet<string> = new Set([...])`
 *     declarations (multi-line or single-line)
 *   - `rejectUnknownFlags(args, X_KNOWN_FLAGS, 'verb-name')` calls
 */
function parseHandler(source: string): ParsedHandler {
  const knownFlagSets = new Map<string, Set<string>>();
  const constToVerb = new Map<string, string[]>();

  // Match `const NAME_KNOWN_FLAGS: ... = new Set(<args>);` where
  // <args> is either `[...flags...]`, `<string>([...flags...])`, or
  // empty `()`. Captures the body so we can extract string literals.
  const declRe =
    /const\s+(\w+_KNOWN_FLAGS)\s*:[^=]*=\s*new\s+Set\s*(?:<[^>]+>)?\s*\(\s*(?:\[([\s\S]*?)\])?\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(source)) !== null) {
    const constName = m[1]!;
    const body = m[2] ?? '';
    const flags = new Set<string>();
    // Match string literals — single, double, or backtick-quoted.
    const strRe = /['"`]([^'"`]+)['"`]/g;
    let s: RegExpExecArray | null;
    while ((s = strRe.exec(body)) !== null) {
      flags.add(s[1]!);
    }
    knownFlagSets.set(constName, flags);
  }

  // Match `rejectUnknownFlags(args, NAME_KNOWN_FLAGS, 'verb')` —
  // simple call with a literal verb name as the third argument.
  // Allows multi-line whitespace between args.
  const callRe =
    /rejectUnknownFlags\s*\(\s*args\s*,\s*(\w+_KNOWN_FLAGS)\s*,\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = callRe.exec(source)) !== null) {
    const constName = m[1]!;
    const verbName = m[2]!;
    if (!constToVerb.has(constName)) constToVerb.set(constName, []);
    constToVerb.get(constName)!.push(verbName);
  }

  return { knownFlagSets, constToVerb };
}

/** Build the verb-name → flag-set map across all handler files. */
function buildVerbFlagMap(): Map<string, Set<string>> {
  const verbFlags = new Map<string, Set<string>>();
  // First pass: collect every const declaration across files.
  const allDecls = new Map<string, Set<string>>();
  const files = readdirSync(HANDLERS_DIR).filter((f) => f.endsWith('.ts'));
  for (const f of files) {
    const source = readFileSync(join(HANDLERS_DIR, f), 'utf8');
    const { knownFlagSets, constToVerb } = parseHandler(source);
    for (const [k, v] of knownFlagSets) allDecls.set(k, v);
    for (const [constName, verbs] of constToVerb) {
      const flags = knownFlagSets.get(constName);
      if (!flags) continue;
      for (const verb of verbs) {
        verbFlags.set(verb, flags);
      }
    }
  }
  // Second pass: apply the indirect-verb allowlist for verbs whose
  // rejectUnknownFlags call passes the const via a conditional.
  for (const [verb, constName] of Object.entries(INDIRECT_VERB_TO_CONST)) {
    const flags = allDecls.get(constName);
    if (flags) verbFlags.set(verb, flags);
  }
  return verbFlags;
}

interface VerbSchema {
  name: string;
  input?: { properties?: Record<string, { description?: string }> };
}

function loadSchema(): VerbSchema[] {
  // Spawn `gate schema` so we exercise the actual contract, not an
  // imported in-process copy. Keeps the test honest about what an
  // MCP wiring would see.
  const cwd = mkdtempSync(join(tmpdir(), 'guild-driftcheck-'));
  try {
    writeFileSync(
      join(cwd, 'guild.config.yaml'),
      'content_root: .\nhost_names: [human]\n',
    );
    mkdirSync(join(cwd, 'members'));
    const r = spawnSync(process.execPath, [GATE, 'schema'], {
      cwd,
      env: { ...process.env },
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(`gate schema failed: ${r.stderr}`);
    const payload = JSON.parse(r.stdout);
    return payload.verbs as VerbSchema[];
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function isPositional(propKey: string, prop: { description?: string }): boolean {
  // Convention: positionals declare `description: 'positional; ...'`
  // (lowercase, semicolon-separated). Matches existing schema entries
  // for show.id, voices.name, etc.
  return Boolean(prop.description?.startsWith('positional;'));
}

test('schema/runtime drift detector: schema.input.properties matches handler KNOWN_FLAGS', () => {
  const verbFlags = buildVerbFlagMap();
  const schema = loadSchema();

  const failures: string[] = [];

  for (const verb of schema) {
    if (SUBCOMMAND_UMBRELLAS.has(verb.name)) continue;
    if (SCHEMA_ONLY_VERBS.has(verb.name)) continue;

    const runtimeFlags = verbFlags.get(verb.name);
    if (!runtimeFlags) {
      failures.push(
        `verb "${verb.name}": schema declares it but no rejectUnknownFlags(args, X, '${verb.name}') call found in handlers — runtime accepts arbitrary flags?`,
      );
      continue;
    }

    const declaredProps = verb.input?.properties ?? {};
    const schemaFlags = new Set<string>();
    for (const [key, prop] of Object.entries(declaredProps)) {
      if (isPositional(key, prop)) continue;
      schemaFlags.add(key);
    }

    // schema → runtime: every advertised flag must be runtime-accepted
    for (const f of schemaFlags) {
      if (!runtimeFlags.has(f)) {
        failures.push(
          `verb "${verb.name}": schema advertises --${f} but runtime KNOWN_FLAGS lacks it (runtime would reject the very flag the schema sells)`,
        );
      }
    }
    // runtime → schema: every accepted flag must be advertised
    for (const f of runtimeFlags) {
      if (!schemaFlags.has(f)) {
        failures.push(
          `verb "${verb.name}": runtime accepts --${f} but schema doesn't advertise it (MCP wirings read schema and miss this flag)`,
        );
      }
    }
  }

  if (failures.length > 0) {
    assert.fail(
      `schema/runtime drift detected (principle 10):\n  ${failures.join('\n  ')}`,
    );
  }
});

test('schema/runtime drift detector: parser sanity — recognises the canonical declaration shape', () => {
  // Sanity check the parser itself. Without this, a regex regression
  // could silently make the main test pass with empty input.
  const sample = `
    const FOO_KNOWN_FLAGS: ReadonlySet<string> = new Set([
      'a',
      'b',
      'c',
    ]);
    const BAR_KNOWN_FLAGS: ReadonlySet<string> = new Set(['x']);

    export async function reqFoo(c: C, args: ParsedArgs): Promise<number> {
      rejectUnknownFlags(args, FOO_KNOWN_FLAGS, 'foo');
    }
    export async function reqBar(c: C, args: ParsedArgs): Promise<number> {
      rejectUnknownFlags(args, BAR_KNOWN_FLAGS, 'bar-verb');
    }
  `;
  const parsed = parseHandler(sample);
  assert.deepEqual(
    [...(parsed.knownFlagSets.get('FOO_KNOWN_FLAGS') ?? new Set())].sort(),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    [...(parsed.knownFlagSets.get('BAR_KNOWN_FLAGS') ?? new Set())],
    ['x'],
  );
  assert.deepEqual(parsed.constToVerb.get('FOO_KNOWN_FLAGS'), ['foo']);
  assert.deepEqual(parsed.constToVerb.get('BAR_KNOWN_FLAGS'), ['bar-verb']);
});
