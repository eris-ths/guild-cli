// `<cli> <verb> --help` — universal escape valve.
//
// Pre-fix, `--help` was rejected as an unknown flag on every verb of
// every CLI (gate / agora / devil / ctx). Fresh agents typing `gate
// whoami --help` to discover the verb's flag surface hit a soft error
// instead of help. This file pins the new behaviour: rejectUnknownFlags
// throws a typed `HelpRequested` signal carrying the verb name +
// known flag set; each binary's main() catches it, renders verb help,
// and exits 0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseArgs,
  rejectUnknownFlags,
  HelpRequested,
} from '../../src/interface/shared/parseArgs.js';
import { renderVerbHelp } from '../../src/interface/shared/verbHelp.js';
import { VERB_EXAMPLES } from '../../src/interface/shared/verbExamples.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');
const AGORA = resolve(here, '../../../bin/agora.mjs');
const DEVIL = resolve(here, '../../../bin/devil.mjs');
const CTX = resolve(here, '../../../bin/ctx.mjs');
const GUILD = resolve(here, '../../../bin/guild.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-verb-help-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  mkdirSync(join(root, 'members'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(
  bin: string,
  cwd: string,
  args: string[],
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    env: { ...process.env },
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

// --- unit tests for the throw-typed signal ---

test('rejectUnknownFlags: --help throws HelpRequested with verb + known flags', () => {
  const args = parseArgs(['--help']);
  try {
    rejectUnknownFlags(args, new Set(['limit', 'format']), 'tail');
    assert.fail('expected HelpRequested');
  } catch (e) {
    assert.ok(e instanceof HelpRequested, 'should throw HelpRequested');
    const h = e as HelpRequested;
    assert.equal(h.verb, 'tail');
    assert.deepEqual(h.knownFlags, ['format', 'limit'], 'flags sorted');
  }
});

test('rejectUnknownFlags: --help short-circuits even when other flags are present', () => {
  // --help wins over `--bogus`; the user asked for help, not an error.
  const args = parseArgs(['--bogus', '--help']);
  try {
    rejectUnknownFlags(args, new Set(['limit']), 'tail');
    assert.fail('expected HelpRequested');
  } catch (e) {
    assert.ok(e instanceof HelpRequested);
  }
});

test('rejectUnknownFlags: HelpRequested carries empty array when verb has no known flags', () => {
  const args = parseArgs(['--help']);
  try {
    rejectUnknownFlags(args, new Set(), 'register');
    assert.fail('expected HelpRequested');
  } catch (e) {
    assert.ok(e instanceof HelpRequested);
    assert.deepEqual((e as HelpRequested).knownFlags, []);
  }
});

test('rejectUnknownFlags: --help is never reported as an unknown flag', () => {
  // Sanity guard: even if a future caller forgot to handle HelpRequested,
  // --help should not surface as "unknown flag: --help" in the error.
  // (The throw branch is HelpRequested; the unknown-flag branch skips it.)
  const args = parseArgs(['--help']);
  assert.throws(
    () => rejectUnknownFlags(args, new Set(['limit']), 'tail'),
    (e: unknown) => e instanceof HelpRequested,
    'should be HelpRequested, not generic Error',
  );
});

// --- unit tests for the renderer + example map ---

function captureStdout(fn: () => void): string {
  const original = process.stdout.write.bind(process.stdout);
  let captured = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: string | Uint8Array): boolean => {
    captured += typeof chunk === 'string' ? chunk : chunk.toString();
    return true;
  };
  try {
    fn();
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = original;
  }
  return captured;
}

test('renderVerbHelp: prints flag list, e.g. example, and footer', () => {
  const e = new HelpRequested('request', ['from', 'action', 'reason']);
  const out = captureStdout(() => renderVerbHelp('gate', e));
  assert.match(out, /^gate request: --from, --action, --reason\n/);
  assert.match(out, /\n {2}e\.g\. gate request --action /);
  assert.match(out, /\n {2}see `gate --help` for the full verb catalog\.\n$/);
});

test('renderVerbHelp: omits e.g. line when the verb has no example mapping', () => {
  // Deliberately use a verb name that is NOT in VERB_EXAMPLES.gate.
  // The renderer should still produce the flag list and footer.
  const e = new HelpRequested('not-a-real-verb-xyz', ['flag']);
  const out = captureStdout(() => renderVerbHelp('gate', e));
  assert.match(out, /^gate not-a-real-verb-xyz: --flag\n/);
  assert.equal(/e\.g\./.test(out), false, 'no example line for unknown verb');
  assert.match(out, /see `gate --help`/);
});

test('renderVerbHelp: handles a verb with zero known flags', () => {
  // `(no flags)` placeholder + still reaches example lookup. Example
  // map is keyed by verb name, not flag count, so a flagless verb like
  // `whoami` still gets its example printed.
  const e = new HelpRequested('whoami', []);
  const out = captureStdout(() => renderVerbHelp('gate', e));
  assert.match(out, /^gate whoami: \(no flags\)\n/);
  assert.match(out, /\n {2}e\.g\. gate whoami\n/);
});

// --- coverage: every (cli, verb) reachable through rejectUnknownFlags
//     should have an example. Failure means a new verb was added without
//     pulling its canonical example from AGENT.md / docs/verbs.md. ---

test('VERB_EXAMPLES: every documented verb is mapped to a runnable example', () => {
  // Source of truth: the verb names passed as the third arg to
  // rejectUnknownFlags across the interface layer. Extracted here as a
  // pinned list rather than re-grepped at test time, so a careless rename
  // breaks the test (drawing attention) instead of silently passing.
  const expected: Record<string, string[]> = {
    gate: [
      'register', 'request', 'approve', 'deny', 'execute', 'complete', 'fail',
      'fast-track', 'review', 'thank', 'message', 'broadcast', 'inbox',
      'inbox mark-read', 'issues add', 'issues list', 'issues note',
      'issues promote', 'issues resolve', 'issues defer', 'issues start',
      'issues reopen', 'show', 'list', 'board', 'tail', 'chain', 'transcript',
      'voices', 'whoami', 'boot', 'status', 'suggest', 'resume', 'summarize',
      'why', 'unresponded', 'schema', 'doctor', 'repair',
    ],
    agora: [
      'new', 'play', 'move', 'suspend', 'resume', 'conclude',
      'list', 'show', 'last', 'cliff', 'schema',
    ],
    devil: [
      'open', 'entry', 'list', 'show', 'conclude', 'dismiss', 'resolve',
      'suspend', 'resume', 'ingest', 'schema',
    ],
    ctx: ['record'],
    guild: ['list', 'show', 'new', 'validate'],
  };
  for (const [cli, verbs] of Object.entries(expected)) {
    const map = VERB_EXAMPLES[cli];
    assert.ok(map, `VERB_EXAMPLES.${cli} must exist`);
    for (const verb of verbs) {
      assert.ok(
        typeof map[verb] === 'string' && map[verb]!.length > 0,
        `VERB_EXAMPLES.${cli}["${verb}"] missing or empty`,
      );
    }
  }
});

test('VERB_EXAMPLES: each example begins with its own verb (catches copy/paste typos)', () => {
  // The renderer prefixes each example with `<cli> `. If an example
  // accidentally starts with a different verb (`register --name <you>`
  // mapped to `request`), `<cli> request register --name <you>` would
  // print and a copy/paster would run the wrong verb. Pin the invariant
  // so that class of typo can't slip in.
  for (const [cli, map] of Object.entries(VERB_EXAMPLES)) {
    for (const [verb, example] of Object.entries(map)) {
      assert.ok(
        example.startsWith(verb),
        `${cli}.${verb}: example "${example}" should start with "${verb}"`,
      );
    }
  }
});

test('rejectUnknownFlags: still throws plain Error for non-help unknown flags', () => {
  // Regression guard for the non-help path.
  const args = parseArgs(['--bogus']);
  assert.throws(
    () => rejectUnknownFlags(args, new Set(['limit']), 'tail'),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.ok(!(e instanceof HelpRequested));
      assert.match(e.message, /unknown flag.*--bogus/);
      return true;
    },
  );
});

// --- E2E: `<cli> <verb> --help` exits 0 across all four CLIs ---

test('gate <verb> --help: exits 0 and renders the flag catalog', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice', '--category', 'professional']);
  const r = run(GATE, root, ['whoami', '--help']);
  assert.equal(r.status, 0, 'whoami --help should exit 0');
  assert.match(r.stdout, /gate whoami: --limit/);
  assert.match(r.stdout, /see `gate --help`/);
});

test('gate <verb> --help: includes a usage example line for documented verbs', (t) => {
  // The example line is the touch-feel improvement on top of the flag list:
  // a fresh agent can copy/paste a runnable invocation without bouncing to
  // `gate --help` or AGENT.md. Missing verbs skip the line silently, so the
  // assertion is presence (not exact prose) on a verb we know is in the map.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice', '--category', 'professional']);
  const r = run(GATE, root, ['request', '--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /e\.g\. gate request --action/);
});

test('gate tail --help: works on a verb with a richer flag set', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice', '--category', 'professional']);
  const r = run(GATE, root, ['tail', '--help']);
  assert.equal(r.status, 0);
  // tail accepts --limit, --format, etc. — pin two we know are documented.
  assert.match(r.stdout, /gate tail:/);
  assert.match(r.stdout, /--format/);
  assert.match(r.stdout, /--limit/);
});

test('agora <verb> --help: exits 0 and uses the agora prefix', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice', '--category', 'professional']);
  const r = run(AGORA, root, ['list', '--help']);
  assert.equal(r.status, 0, 'agora list --help should exit 0');
  assert.match(r.stdout, /agora list:/);
  assert.match(r.stdout, /see `agora --help`/);
});

test('agora new --help: example uses the agora prefix (not gate)', (t) => {
  // Same-named verbs across CLIs (`new` is agora-only, but `list` /
  // `show` / `resume` exist in multiple); pin that the example renders
  // with the right CLI prefix so a copy/paste from agora's help doesn't
  // produce a `gate ...` command.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice', '--category', 'professional']);
  const r = run(AGORA, root, ['new', '--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /e\.g\. agora new --slug/);
});

test('devil <verb> --help: exits 0 and uses the devil prefix', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice', '--category', 'professional']);
  const r = run(DEVIL, root, ['list', '--help']);
  assert.equal(r.status, 0, 'devil list --help should exit 0');
  assert.match(r.stdout, /devil list:/);
  assert.match(r.stdout, /see `devil --help`/);
});

test('devil open --help: example shows the rev-id-shaped first arg', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice', '--category', 'professional']);
  const r = run(DEVIL, root, ['open', '--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /e\.g\. devil open .*--type pr/);
});

test('ctx record --help: exits 0 and uses the ctx prefix', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice', '--category', 'professional']);
  const r = run(CTX, root, ['record', '--help']);
  assert.equal(r.status, 0, 'ctx record --help should exit 0');
  assert.match(r.stdout, /ctx record:/);
  assert.match(r.stdout, /--fact/);
  assert.match(r.stdout, /--tag/);
  assert.match(r.stdout, /e\.g\. ctx record --fact/);
});

test('guild <verb> --help: exits 0 across list / show / new / validate', (t) => {
  // #148 rolled out the universal --help mechanism for gate / agora / devil /
  // ctx but the operator-helper `guild` was out of scope. This pins the
  // follow-up: all four guild verbs honour --help with the same shape.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  for (const verb of ['list', 'show', 'new', 'validate']) {
    const r = run(GUILD, root, [verb, '--help']);
    assert.equal(r.status, 0, `guild ${verb} --help should exit 0`);
    assert.match(r.stdout, new RegExp(`guild ${verb}:`));
    assert.match(r.stdout, /see `guild --help`/);
    assert.match(r.stdout, new RegExp(`e\\.g\\. guild ${verb}`));
  }
});

test('guild new --bogus: error message uses verb-only prefix (no "guild" hardcode)', (t) => {
  // Mirrors the cross-CLI sanity below — the verb name + invocation are
  // enough; the CLI prefix in the error is misleading.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = run(GUILD, root, ['new', '--bogus-flag-xyz']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /new: unknown flag.*--bogus-flag-xyz/);
  assert.equal(
    /guild new: unknown flag/.test(r.stderr),
    false,
    'guild errors should not say "guild" in the unknown-flag prefix',
  );
});

test('non-help unknown flag still errors with verb-only prefix (no "gate" hardcode)', (t) => {
  // Cross-CLI sanity: agora's error message should NOT say "gate" anymore.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice', '--category', 'professional']);
  const r = run(AGORA, root, ['list', '--bogus-flag-xyz']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /list: unknown flag.*--bogus-flag-xyz/);
  assert.equal(
    /gate list: unknown flag/.test(r.stderr),
    false,
    'agora errors should not say "gate"',
  );
});
