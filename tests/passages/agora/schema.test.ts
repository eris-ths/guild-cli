// agora schema — agent dispatch contract for the second passage.
//
// Pins the principle 10 obligations specifically for agora:
//   - schema lists all 9 verbs (new/play/move/suspend/resume/
//     conclude/list/show/schema)
//   - JSON envelope shape: {$schema, passage: "agora", version, verbs}
//   - --verb filter narrows to one verb
//   - input completeness: every flag the runtime accepts via
//     KNOWN_FLAGS appears in schema.input.properties (drift
//     detector)
//   - text mode renders agent-readable summary per verb

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const AGORA = resolve(here, '../../../../bin/agora.mjs');
const HANDLERS_DIR = resolve(here, '../../../../src/passages/agora/interface/handlers');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'agora-schema-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  mkdirSync(join(root, 'members'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runAgora(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [AGORA, ...args], {
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

test('agora schema: JSON envelope contains every verb', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(root, ['schema'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.passage, 'agora');
  assert.equal(payload.$schema, 'http://json-schema.org/draft-07/schema#');
  const names = (payload.verbs as Array<{ name: string }>).map((v) => v.name).sort();
  assert.deepEqual(names, [
    'conclude', 'list', 'move', 'new', 'play',
    'resume', 'schema', 'show', 'suspend',
  ]);
});

test('agora schema: --verb narrows to one entry', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(root, ['schema', '--verb', 'suspend'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.verbs.length, 1);
  assert.equal(payload.verbs[0].name, 'suspend');
  // suspend declares cliff + invitation as required (the substrate-
  // side Zeigarnik prose) — pin this so a future "make it optional"
  // refactor surfaces here.
  assert.deepEqual(
    payload.verbs[0].input.required.sort(),
    ['cliff', 'invitation'],
  );
});

test('agora schema: --verb with unknown name fails clearly', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(root, ['schema', '--verb', 'bogus'], { GUILD_ACTOR: 'alice' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no agora verb named "bogus"/);
});

test('agora schema: text mode renders one summary per verb', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(root, ['schema', '--format', 'text'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /agora — 9 verb\(s\):/);
  assert.match(r.stdout, /^new\s+\[write\]/m);
  assert.match(r.stdout, /^suspend\s+\[write\]/m);
  assert.match(r.stdout, /^schema\s+\[meta\]/m);
});

// ---------------------------------------------------------------
// Drift detector — principle 10's input-side enforcement for
// agora's KNOWN_FLAGS. Same shape as gate's
// schemaInputDriftDetector.test.ts (which doesn't touch agora's
// handlers because it walks src/interface/gate/handlers/ only).
// Without this test, agora's schema.input.properties could drift
// silently from the runtime's KNOWN_FLAGS.
// ---------------------------------------------------------------

interface ParsedHandler {
  knownFlagSets: Map<string, Set<string>>;
  constToVerb: Map<string, string[]>;
}

function parseHandler(source: string): ParsedHandler {
  const knownFlagSets = new Map<string, Set<string>>();
  const constToVerb = new Map<string, string[]>();
  const declRe =
    /const\s+(\w+_KNOWN_FLAGS)\s*:[^=]*=\s*new\s+Set\s*(?:<[^>]+>)?\s*\(\s*(?:\[([\s\S]*?)\])?\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(source)) !== null) {
    const constName = m[1]!;
    const body = m[2] ?? '';
    const flags = new Set<string>();
    const strRe = /['"`]([^'"`]+)['"`]/g;
    let s: RegExpExecArray | null;
    while ((s = strRe.exec(body)) !== null) flags.add(s[1]!);
    knownFlagSets.set(constName, flags);
  }
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

function buildVerbFlagMap(): Map<string, Set<string>> {
  const verbFlags = new Map<string, Set<string>>();
  const files = readdirSync(HANDLERS_DIR).filter((f) => f.endsWith('.ts'));
  for (const f of files) {
    const source = readFileSync(join(HANDLERS_DIR, f), 'utf8');
    const { knownFlagSets, constToVerb } = parseHandler(source);
    for (const [constName, verbs] of constToVerb) {
      const flags = knownFlagSets.get(constName);
      if (!flags) continue;
      for (const verb of verbs) verbFlags.set(verb, flags);
    }
  }
  return verbFlags;
}

function isPositional(propKey: string, prop: { description?: string }): boolean {
  return Boolean(prop.description?.startsWith('positional;'));
}

test('agora schema/runtime drift detector: schema.input.properties matches handler KNOWN_FLAGS', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r = runAgora(root, ['schema', '--format', 'json'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  const verbFlags = buildVerbFlagMap();

  const failures: string[] = [];
  for (const verb of payload.verbs as Array<{ name: string; input?: { properties?: Record<string, { description?: string }> } }>) {
    const runtimeFlags = verbFlags.get(verb.name);
    if (!runtimeFlags) {
      failures.push(`verb "${verb.name}" in schema but no runtime KNOWN_FLAGS`);
      continue;
    }
    const props = verb.input?.properties ?? {};
    const schemaFlags = new Set<string>();
    for (const [k, p] of Object.entries(props)) {
      if (isPositional(k, p)) continue;
      schemaFlags.add(k);
    }
    for (const f of schemaFlags) {
      if (!runtimeFlags.has(f)) {
        failures.push(
          `verb "${verb.name}": schema advertises --${f} but runtime KNOWN_FLAGS lacks it`,
        );
      }
    }
    for (const f of runtimeFlags) {
      if (!schemaFlags.has(f)) {
        failures.push(
          `verb "${verb.name}": runtime accepts --${f} but schema doesn't advertise it`,
        );
      }
    }
  }
  if (failures.length > 0) {
    assert.fail(
      `agora schema/runtime drift (principle 10):\n  ${failures.join('\n  ')}`,
    );
  }
});
