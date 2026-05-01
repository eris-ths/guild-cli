// gate write verbs --dry-run: schema declares it + format-text notice.
//
// Pre-fix gaps:
//   1. The schema entries for approve/deny/execute/complete/fail/
//      review/thank did NOT declare 'dry-run' as a property — so an
//      MCP wiring reading `gate schema` saw a tool surface strictly
//      less capable than the runtime (which accepted --dry-run via
//      KNOWN_FLAGS). register declared it, but as `strOpt` (string),
//      not boolean — same misalignment in a different shape.
//   2. `--dry-run --format text` emitted JSON with no signal that
//      --format was overridden. Silent fail-open against an explicit
//      flag.
//
// This test pins the schema declarations (single shape across all
// eight verbs) and the stderr notice (named-why phrasing).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-dryrun-surface-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, d));
  }
  for (const name of ['alice', 'bob']) {
    writeFileSync(
      join(root, 'members', `${name}.yaml`),
      `name: ${name}\ncategory: professional\nactive: true\n`,
    );
  }
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

// ── schema declarations ──────────────────────────────────────────

const DRY_RUN_VERBS: readonly string[] = [
  'register',
  'approve',
  'deny',
  'execute',
  'complete',
  'fail',
  'review',
  'thank',
];

for (const verb of DRY_RUN_VERBS) {
  test(`schema: ${verb} declares dry-run as a boolean property`, (t) => {
    // The runtime KNOWN_FLAGS for each of these verbs already
    // accepts --dry-run; pre-fix the schema didn't say so, leaving
    // MCP wirings to either guess or stay strict (and lose access
    // to the preview envelope).
    const { root, cleanup } = bootstrap();
    t.after(cleanup);
    const r = runGate(root, ['schema', '--verb', verb, '--format', 'json']);
    assert.equal(r.status, 0);
    const payload = JSON.parse(r.stdout);
    const v = payload.verbs.find((x: { name: string }) => x.name === verb);
    assert.ok(v, `${verb} should be in the schema`);
    const props = v.input.properties;
    assert.ok(
      'dry-run' in props,
      `${verb} schema should declare 'dry-run' property`,
    );
    assert.equal(
      props['dry-run'].type,
      'boolean',
      `${verb}'s 'dry-run' should be {type: 'boolean'}, ` +
        `not '${props['dry-run'].type}' — single declaration shape ` +
        'across all dry-run verbs.',
    );
    // Sanity: the description names what the runtime actually does.
    assert.match(
      props['dry-run'].description,
      /preview/i,
      `${verb}'s dry-run description should name the preview semantic`,
    );
  });
}

// ── --dry-run + --format text → stderr notice ────────────────────

test('approve --dry-run --format text emits a one-line stderr notice', (t) => {
  // The notice names WHY the format is fixed (envelope is structured)
  // rather than just announcing the override. Pre-fix: silent JSON.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(
    root,
    ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'bob'],
    { GUILD_ACTOR: 'alice' },
  );
  const today = new Date().toISOString().slice(0, 10);
  const id = `${today}-0001`;
  const r = runGate(
    root,
    ['approve', id, '--by', 'human', '--dry-run', '--format', 'text'],
    { GUILD_ACTOR: 'human' },
  );
  assert.equal(r.status, 0);
  assert.match(r.stderr, /--dry-run preview is structured/);
  assert.match(r.stderr, /--format text/);
  assert.match(
    r.stderr,
    /would lose dry_run\/verb\/would_transition/,
    'notice should name what the json envelope carries that text would lose',
  );
  // Stdout still emits the json envelope regardless — the notice
  // does not block, only informs.
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.dry_run, true);
});

test('approve --dry-run --format json suppresses the stderr notice', (t) => {
  // The notice exists for format=text callers who would otherwise
  // not realise their format flag was overridden. JSON callers
  // already get what they asked for; pumping prose into stderr
  // would be noise for pipelines.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(
    root,
    ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'bob'],
    { GUILD_ACTOR: 'alice' },
  );
  const today = new Date().toISOString().slice(0, 10);
  const id = `${today}-0001`;
  const r = runGate(
    root,
    ['approve', id, '--by', 'human', '--dry-run', '--format', 'json'],
    { GUILD_ACTOR: 'human' },
  );
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /--dry-run preview is structured/);
});

test('review --dry-run --format text also emits the notice (annotation verb)', (t) => {
  // Annotation verbs (review, thank) share the preview envelope
  // shape — would_transition is omitted but the rest still emits
  // as JSON. The notice fires for the same reason: format=text
  // would lose the envelope keys.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(
    root,
    ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executor', 'bob'],
    { GUILD_ACTOR: 'alice' },
  );
  const today = new Date().toISOString().slice(0, 10);
  const id = `${today}-0001`;
  runGate(root, ['approve', id, '--by', 'human'], { GUILD_ACTOR: 'human' });
  runGate(root, ['execute', id, '--by', 'bob'], { GUILD_ACTOR: 'bob' });
  runGate(root, ['complete', id, '--by', 'bob'], { GUILD_ACTOR: 'bob' });
  const r = runGate(
    root,
    [
      'review', id,
      '--by', 'alice', '--lense', 'devil', '--verdict', 'ok',
      '--comment', 'fine', '--dry-run', '--format', 'text',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.match(r.stderr, /--dry-run preview is structured/);
});
