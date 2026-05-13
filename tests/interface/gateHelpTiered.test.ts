// gate --help — tiered output (issue #324, axis 2 of solo/swarm
// coexistence).
//
// Pre-#324, `gate --help` printed every verb in one flat catalog.
// Solo users on profile=standard saw cross-session coordination
// surface (claim/witness/wave-status) they had no use for; swarm
// users saw alpha utilities buried alongside the verbs they actually
// reach for. The fix is profile-aware tiering with a `--all`
// override.
//
// Coverage:
//   - profile=standard prints BASE only (no claim/witness/...)
//   - profile=swarm prints BASE + COORDINATION (claim/witness/
//     wave-status appear; transcript/voices/rest/... still hidden)
//   - --all flag prints everything regardless of profile (both
//     standard and swarm should produce the same superset)
//   - schema --format json is exhaustive irrespective of profile
//     or --all (orchestrator contract — principle 11: AI-first)

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

interface Bootstrap {
  readonly root: string;
  readonly cleanup: () => void;
}

function bootstrap(profile: 'standard' | 'swarm'): Bootstrap {
  const root = mkdtempSync(join(tmpdir(), `guild-help-${profile}-`));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    `content_root: .\nhost_names: [eris]\nprofile: ${profile}\n`,
  );
  mkdirSync(join(root, 'members'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function run(
  cwd: string,
  args: string[],
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

// Verb tokens (the first word after `gate `) we expect to find on a
// usage-line. Matching against `^  gate <verb>` rather than free-text
// search avoids false positives from prose ("see `gate witness`" in
// some explanatory paragraph).
const BASE_VERBS = [
  'request',
  'approve',
  // `deny` is BASE symmetric with the terminal-state vocab (pending
  // → denied is listed alongside completed/failed in help). Pre-fix
  // it was --all-only, leaving cold-session callers to misroute
  // through `fail` (illegal pending → failed) before finding deny.
  'deny',
  'execute',
  'complete',
  'fail',
  'review',
  'show',
  'list',
  'tail',
  'boot',
  'register',
  'doctor',
  'fast-track',
  'schema',
];

const COORDINATION_VERBS = ['claim', 'witness', 'unwitness', 'wave-status'];

// Sample of EXTRA verbs — any one of these appearing in non-`--all`
// output under profile=standard|swarm would mean the tier filter
// leaked.
const EXTRA_SAMPLE = ['transcript', 'voices', 'rest', 'wake', 'farewell'];

function hasUsageLine(text: string, verb: string): boolean {
  // Match "  gate <verb>" at the start of a line, with the verb
  // followed by a non-letter (space, end-of-line, or '<arg>').
  const re = new RegExp(`^ {2}gate ${verb}(?:[^a-z-]|$)`, 'm');
  return re.test(text);
}

test('#324: gate --help under profile=standard shows BASE only', (t) => {
  const b = bootstrap('standard');
  t.after(() => b.cleanup());
  const r = run(b.root, ['--help']);
  assert.equal(r.status, 0);
  for (const v of BASE_VERBS) {
    assert.ok(
      hasUsageLine(r.stdout, v),
      `expected BASE verb '${v}' in standard --help; got:\n${r.stdout}`,
    );
  }
  for (const v of COORDINATION_VERBS) {
    assert.ok(
      !hasUsageLine(r.stdout, v),
      `coordination verb '${v}' should be hidden under profile=standard`,
    );
  }
  for (const v of EXTRA_SAMPLE) {
    assert.ok(
      !hasUsageLine(r.stdout, v),
      `extra verb '${v}' should be hidden under profile=standard`,
    );
  }
  // Banner reflects the active tier so the operator knows what they
  // are seeing.
  assert.match(r.stdout, /profile=standard/);
});

test('#324: gate --help under profile=swarm shows BASE + COORDINATION', (t) => {
  const b = bootstrap('swarm');
  t.after(() => b.cleanup());
  const r = run(b.root, ['--help']);
  assert.equal(r.status, 0);
  for (const v of BASE_VERBS) {
    assert.ok(
      hasUsageLine(r.stdout, v),
      `expected BASE verb '${v}' in swarm --help`,
    );
  }
  for (const v of COORDINATION_VERBS) {
    assert.ok(
      hasUsageLine(r.stdout, v),
      `expected COORDINATION verb '${v}' in swarm --help`,
    );
  }
  for (const v of EXTRA_SAMPLE) {
    assert.ok(
      !hasUsageLine(r.stdout, v),
      `extra verb '${v}' should be hidden under profile=swarm (use --all)`,
    );
  }
  assert.match(r.stdout, /profile=swarm/);
});

test('#324: gate --help --all shows everything regardless of profile', (t) => {
  for (const profile of ['standard', 'swarm'] as const) {
    const b = bootstrap(profile);
    t.after(() => b.cleanup());
    const r = run(b.root, ['--help', '--all']);
    assert.equal(r.status, 0, `--all under ${profile} should exit 0`);
    for (const v of [...BASE_VERBS, ...COORDINATION_VERBS, ...EXTRA_SAMPLE]) {
      assert.ok(
        hasUsageLine(r.stdout, v),
        `expected verb '${v}' in --all output under profile=${profile}`,
      );
    }
    assert.match(r.stdout, /full catalog/);
  }
});

test('#324: gate schema --format json is exhaustive regardless of profile', (t) => {
  for (const profile of ['standard', 'swarm'] as const) {
    const b = bootstrap(profile);
    t.after(() => b.cleanup());
    const r = run(b.root, ['schema', '--format', 'json']);
    assert.equal(r.status, 0, `schema under ${profile} should exit 0`);
    const payload = JSON.parse(r.stdout) as { verbs: { name: string }[] };
    const names = new Set(payload.verbs.map((v) => v.name));
    // Every BASE + COORDINATION + at least one EXTRA verb must be
    // present in the schema payload under both profiles. The
    // orchestrator contract is "schema sees everything" — tiering
    // is a human-readable surface only.
    for (const v of [...BASE_VERBS, ...COORDINATION_VERBS, ...EXTRA_SAMPLE]) {
      assert.ok(
        names.has(v),
        `schema must list verb '${v}' under profile=${profile}`,
      );
    }
  }
});

test('#324: gate schema --format json output is identical across profiles', (t) => {
  const standard = bootstrap('standard');
  const swarm = bootstrap('swarm');
  t.after(() => standard.cleanup());
  t.after(() => swarm.cleanup());
  const a = run(standard.root, ['schema', '--format', 'json']);
  const b = run(swarm.root, ['schema', '--format', 'json']);
  assert.equal(a.status, 0);
  assert.equal(b.status, 0);
  const aNames = (JSON.parse(a.stdout) as { verbs: { name: string }[] }).verbs
    .map((v) => v.name)
    .sort();
  const bNames = (JSON.parse(b.stdout) as { verbs: { name: string }[] }).verbs
    .map((v) => v.name)
    .sort();
  assert.deepEqual(
    aNames,
    bNames,
    'schema verb list must not vary by profile',
  );
});
