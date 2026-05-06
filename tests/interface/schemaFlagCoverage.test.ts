// Schema ↔ handler flag-coverage contract test.
//
// `<cli> schema --verb <name>` is the agent-dispatch reflection layer:
// agents read it to learn which flags a verb accepts. The handler's
// `*_KNOWN_FLAGS` set is what the CLI ACTUALLY accepts (via
// `rejectUnknownFlags`). If the two drift, agents see flags that
// don't work, or call working flags that aren't documented.
//
// Pre-test: there's no CI guard for this drift. A handler can grow
// a flag without anyone touching schema.ts; a schema entry can name
// a flag the handler never registered.
//
// What this test does:
//   For every verb across the 5 passages (read via
//   `<cli> schema --format json`), enumerate:
//     - schemaFlags  = Object.keys(verb.input.properties)
//     - handlerFlags = parsed from `<cli> <verb> --bogus-test x`
//                      stderr's "valid flags for '<verb>': ..." line
//   Assert set equality.
//
// Sub-dispatchers (`gate issues`, `gate message`) are skipped: their
// schema models a `subcommand` enum rather than a flag set, and the
// handler dispatches on positional rather than via rejectUnknownFlags
// at the parent level. The leaf verbs (`gate issues add` etc.) are
// not in the schema and aren't reachable as a single argv prefix
// either, so symmetrical drift would have to be caught by per-verb
// tests. Out of scope here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = resolve(here, '../../../bin');

const CLIS = ['gate', 'agora', 'devil'] as const;
type Cli = (typeof CLIS)[number];

interface PropSchema {
  description?: string;
  [key: string]: unknown;
}

interface VerbSchema {
  name: string;
  input?: {
    properties?: Record<string, PropSchema>;
  };
}

/**
 * Some passages (devil) document positional arguments inside
 * `input.properties` with a `description` starting with
 * "positional;". They're not flags — the handler doesn't accept
 * `--review_id <id>`, the user passes the id as argv[1]. Filter
 * them out before comparing against the handler's flag set.
 *
 * Other passages (agora) just omit positionals from the schema
 * entirely; that's also fine — the comparison stays clean.
 */
function isFlagProperty(prop: PropSchema): boolean {
  const desc = (prop.description ?? '').toString();
  return !/^positional\b/i.test(desc);
}

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'schema-coverage-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(
  cli: string,
  cwd: string,
  args: string[],
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(
    process.execPath,
    [join(BIN_DIR, `${cli}.mjs`), ...args],
    {
      cwd,
      env: { ...process.env, GUILD_ACTOR: 'alice' },
      encoding: 'utf8',
    },
  );
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

/** Return all verbs the given CLI's `schema --format json` enumerates. */
function loadSchemaVerbs(cli: Cli, root: string): VerbSchema[] {
  const r = run(cli, root, ['schema', '--format', 'json']);
  if (r.status !== 0) {
    throw new Error(`${cli} schema --format json failed: ${r.stderr}`);
  }
  const payload = JSON.parse(r.stdout) as { verbs?: VerbSchema[] };
  return payload.verbs ?? [];
}

/**
 * Probe the handler's known-flag set by passing a deliberately
 * unknown flag and parsing the "valid flags for '<verb>': ..."
 * line in stderr. Returns null when the verb doesn't follow the
 * standard rejectUnknownFlags pattern (sub-dispatchers, no-flags
 * verbs, etc.) — the caller decides whether to skip.
 */
function probeHandlerFlags(
  cli: Cli,
  root: string,
  verb: string,
): Set<string> | null {
  const r = run(cli, root, [verb, '--this-flag-does-not-exist', 'x']);
  // The error shape is `valid flags for '<verb>': --a, --b` (a comma
  // list), or absent for sub-dispatchers / verbs with no flag check.
  // The list may be empty (`valid flags for 'chain': `) — that's a
  // legitimate "no flags" answer, not a parse failure.
  const m = r.stderr.match(/valid flags for '[^']+':([^\n]*)/);
  if (!m) return null;
  const list = (m[1] ?? '').trim();
  if (list === '') return new Set();
  return new Set(
    list
      .split(',')
      .map((s) => s.trim().replace(/^--/, ''))
      .filter((s) => s.length > 0),
  );
}

/**
 * Skip verbs whose schema models a sub-dispatcher rather than a flag
 * set. Detection: `input.properties.subcommand` exists. The leaf
 * verbs (issues add, etc.) are out of scope here.
 */
function isSubDispatcher(v: VerbSchema): boolean {
  return v.input?.properties !== undefined && 'subcommand' in v.input.properties;
}

for (const cli of CLIS) {
  test(`schema ↔ handler flag coverage: ${cli}`, (t) => {
    const { root, cleanup } = bootstrap();
    t.after(cleanup);

    const verbs = loadSchemaVerbs(cli, root);
    assert.ok(verbs.length > 0, `${cli} schema returned zero verbs`);

    const drift: string[] = [];
    const skipped: string[] = [];

    for (const v of verbs) {
      if (isSubDispatcher(v)) {
        skipped.push(`${v.name} (sub-dispatcher)`);
        continue;
      }
      const handlerFlags = probeHandlerFlags(cli, root, v.name);
      if (handlerFlags === null) {
        skipped.push(`${v.name} (no rejectUnknownFlags surface)`);
        continue;
      }
      const props = v.input?.properties ?? {};
      const schemaFlags = new Set(
        Object.entries(props)
          .filter(([, p]) => isFlagProperty(p))
          .map(([k]) => k),
      );

      const onlyInHandler = [...handlerFlags].filter((f) => !schemaFlags.has(f));
      const onlyInSchema = [...schemaFlags].filter((f) => !handlerFlags.has(f));
      if (onlyInHandler.length > 0 || onlyInSchema.length > 0) {
        drift.push(
          `${cli} ${v.name}: ` +
            (onlyInHandler.length > 0
              ? `handler-only flags ${onlyInHandler.join(', ')}; `
              : '') +
            (onlyInSchema.length > 0
              ? `schema-only flags ${onlyInSchema.join(', ')}`
              : ''),
        );
      }
    }

    assert.equal(
      drift.length,
      0,
      `flag drift detected (${drift.length}):\n  ${drift.join('\n  ')}\n` +
        (skipped.length > 0
          ? `\nskipped (${skipped.length}): ${skipped.join(', ')}`
          : ''),
    );
  });
}

test('schema flag coverage: at least one verb checked per CLI', (t) => {
  // Sanity: ensure the loop above didn't skip every verb due to a
  // parse-shape regression in the unknown-flag error. If
  // `rejectUnknownFlags` ever changes its message format, every verb
  // would fall into the skip path and the per-CLI test above would
  // pass trivially. Pin a non-zero floor.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  for (const cli of CLIS) {
    const verbs = loadSchemaVerbs(cli, root);
    let checked = 0;
    for (const v of verbs) {
      if (isSubDispatcher(v)) continue;
      if (probeHandlerFlags(cli, root, v.name) !== null) checked += 1;
    }
    assert.ok(
      checked >= 3,
      `${cli}: only ${checked} verb(s) successfully checked — ` +
        `unknown-flag error shape may have regressed`,
    );
  }
});
