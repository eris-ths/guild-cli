// gate request --from-agora <play_id> — bridge from agora play
// suspension cliff/invitation into request action/reason (issue #232).
//
// Pins the substrate-level contract:
//   1. Plain bridge: action ← invitation, reason ← cliff. The
//      structural source_agora_play stamp lands on the YAML record.
//   2. --action override: explicit --action wins; cliff still lifts
//      into reason; structural stamp still lands.
//   3. --reason override: explicit --reason wins; invitation still
//      lifts into action; structural stamp still lands.
//   4. State refusal: concluded plays refuse with an actionable hint
//      (next: open a fresh play, or file without --from-agora).
//   5. State refusal: a playing-but-never-suspended play refuses with
//      a hint pointing at agora suspend.
//   6. Not-found refusal: unknown play id surfaces the agora root the
//      bridge consulted, so a multi-root operator sees which one
//      rejected the lookup.
//   7. Byte-stable YAML: the field is omitted when --from-agora is
//      not used (no source_agora_play key on plain requests).
//   8. Hydrate tolerance: a request YAML written before #232 (no
//      source_agora_play field) loads cleanly.
//   9. JSON show surface: source_agora_play is exposed under the
//      same key in the JSON payload.
//  10. --game without --from-agora: refused with a flag-shaped error
//      (no silent ignore — same fail-open class rejectUnknownFlags
//      exists to prevent).
//
// What this test does NOT pin: the agora handler's own behaviour
// (suspend / resume / conclude). Those contracts live in their own
// passage tests; here we only set up plays as fixture YAML and
// exercise the gate-side bridge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

interface Fixture {
  root: string;
  cleanup: () => void;
}

function bootstrap(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'gate-fromagora-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  // Agora layout: plays live under <content_root>/agora/plays/<game-slug>/
  mkdirSync(join(root, 'agora', 'games'), { recursive: true });
  mkdirSync(join(root, 'agora', 'plays', 'quest-1'), { recursive: true });
  writeFileSync(
    join(root, 'agora', 'games', 'quest-1.yaml'),
    [
      'slug: quest-1',
      'kind: quest',
      'title: smoke quest',
      'created_at: 2026-05-01T00:00:00.000Z',
      'created_by: alice',
      '',
    ].join('\n'),
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writePlay(root: string, opts: {
  id: string;
  state: 'playing' | 'suspended' | 'concluded';
  suspensions?: Array<{ cliff: string; invitation: string; at?: string; by?: string }>;
  resumes?: Array<{ at?: string; by?: string }>;
  concluded?: { at?: string; by?: string; note?: string };
}): void {
  const lines: string[] = [
    `id: ${opts.id}`,
    'game: quest-1',
    `state: ${opts.state}`,
    'started_at: 2026-05-08T00:00:00.000Z',
    'started_by: alice',
    'moves: []',
  ];
  if (opts.suspensions && opts.suspensions.length > 0) {
    lines.push('suspensions:');
    for (const s of opts.suspensions) {
      lines.push(`  - at: ${s.at ?? '2026-05-08T01:00:00.000Z'}`);
      lines.push(`    by: ${s.by ?? 'alice'}`);
      lines.push(`    cliff: ${s.cliff}`);
      lines.push(`    invitation: ${s.invitation}`);
    }
  } else {
    lines.push('suspensions: []');
  }
  if (opts.resumes && opts.resumes.length > 0) {
    lines.push('resumes:');
    for (const r of opts.resumes) {
      lines.push(`  - at: ${r.at ?? '2026-05-08T02:00:00.000Z'}`);
      lines.push(`    by: ${r.by ?? 'alice'}`);
    }
  } else {
    lines.push('resumes: []');
  }
  if (opts.concluded) {
    lines.push(`concluded_at: ${opts.concluded.at ?? '2026-05-08T03:00:00.000Z'}`);
    lines.push(`concluded_by: ${opts.concluded.by ?? 'alice'}`);
    lines.push(`concluded_note: ${opts.concluded.note ?? 'done'}`);
  }
  lines.push('');
  writeFileSync(
    join(root, 'agora', 'plays', 'quest-1', `${opts.id}.yaml`),
    lines.join('\n'),
  );
}

function run(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, GUILD_ACTOR: 'alice', ...env },
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

function extractRequestId(out: string): string {
  const m = out.match(/(\d{4}-\d{2}-\d{2}-\d{4})/);
  if (!m) throw new Error(`no request id in output: ${out}`);
  return m[0] as string;
}

function readPendingYaml(root: string, id: string): string {
  return readFileSync(join(root, 'requests', 'pending', `${id}.yaml`), 'utf8');
}

test('--from-agora: lifts invitation→action and cliff→reason; stamps source_agora_play', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  writePlay(root, {
    id: '2026-05-08-001',
    state: 'suspended',
    suspensions: [
      {
        cliff: 'noir contradicted herself about the substrate purpose',
        invitation: 'pick up the contradiction and either reconcile or escalate',
      },
    ],
  });
  const r = run(root, [
    'request',
    '--from',
    'alice',
    '--from-agora',
    '2026-05-08-001',
  ]);
  assert.equal(r.status, 0, `expected success; stderr=${r.stderr}`);
  const id = extractRequestId(r.stdout);
  const yaml = readPendingYaml(root, id);
  assert.match(yaml, /^action: pick up the contradiction/m);
  assert.match(yaml, /^reason: noir contradicted herself/m);
  assert.match(yaml, /^source_agora_play: 2026-05-08-001$/m);
});

test('--from-agora + --action: action overrides invitation; cliff still lifts into reason; stamp lands', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  writePlay(root, {
    id: '2026-05-08-001',
    state: 'suspended',
    suspensions: [
      { cliff: 'cliff prose here', invitation: 'invitation prose here' },
    ],
  });
  const r = run(root, [
    'request',
    '--from',
    'alice',
    '--from-agora',
    '2026-05-08-001',
    '--action',
    'do this exact thing instead',
  ]);
  assert.equal(r.status, 0, `expected success; stderr=${r.stderr}`);
  const id = extractRequestId(r.stdout);
  const yaml = readPendingYaml(root, id);
  assert.match(yaml, /^action: do this exact thing instead$/m);
  assert.match(yaml, /^reason: cliff prose here$/m);
  assert.match(yaml, /^source_agora_play: 2026-05-08-001$/m);
});

test('--from-agora + --reason: reason overrides cliff; invitation still lifts into action; stamp lands', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  writePlay(root, {
    id: '2026-05-08-001',
    state: 'suspended',
    suspensions: [
      { cliff: 'cliff prose here', invitation: 'invitation prose here' },
    ],
  });
  const r = run(root, [
    'request',
    '--from',
    'alice',
    '--from-agora',
    '2026-05-08-001',
    '--reason',
    'a fresh reason that overrides the cliff',
  ]);
  assert.equal(r.status, 0, `expected success; stderr=${r.stderr}`);
  const id = extractRequestId(r.stdout);
  const yaml = readPendingYaml(root, id);
  assert.match(yaml, /^action: invitation prose here$/m);
  assert.match(yaml, /^reason: a fresh reason that overrides the cliff$/m);
  assert.match(yaml, /^source_agora_play: 2026-05-08-001$/m);
});

test('--from-agora: concluded play refused with actionable hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  writePlay(root, {
    id: '2026-05-08-001',
    state: 'concluded',
    suspensions: [{ cliff: 'c', invitation: 'i' }],
    concluded: { note: 'wrapped up' },
  });
  const r = run(root, [
    'request',
    '--from',
    'alice',
    '--from-agora',
    '2026-05-08-001',
  ]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /play is concluded/);
  assert.match(r.stderr, /next:/);
  assert.match(r.stderr, /game=quest-1/);
});

test('--from-agora: playing-but-never-suspended play refused with suspend-first hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  writePlay(root, {
    id: '2026-05-08-002',
    state: 'playing',
    // no suspensions
  });
  const r = run(root, [
    'request',
    '--from',
    'alice',
    '--from-agora',
    '2026-05-08-002',
  ]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no suspension on record/);
  assert.match(r.stderr, /agora suspend 2026-05-08-002/);
});

test('--from-agora: not-found play surfaces the agora root the bridge consulted', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // No plays written.
  const r = run(root, [
    'request',
    '--from',
    'alice',
    '--from-agora',
    '2026-05-08-999',
  ]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /play not found/);
  // The bridge surfaces the resolved content_root so the operator
  // can verify they pointed at the right tree. realpath canonicalises
  // /tmp → /private/tmp on darwin, so we just check the basename.
  assert.match(r.stderr, /agora/);
});

test('byte-stable: plain gate request omits source_agora_play from YAML', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = run(root, [
    'request',
    '--from',
    'alice',
    '--action',
    'plain action',
    '--reason',
    'plain reason',
  ]);
  assert.equal(r.status, 0, `expected success; stderr=${r.stderr}`);
  const id = extractRequestId(r.stdout);
  const yaml = readPendingYaml(root, id);
  assert.doesNotMatch(yaml, /source_agora_play/);
});

test('hydrate tolerance: pre-#232 YAML (no source_agora_play) loads without error', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Hand-write a request YAML in the legacy shape — no
  // source_agora_play field at all. `gate show` must read it cleanly.
  mkdirSync(join(root, 'requests', 'pending'), { recursive: true });
  writeFileSync(
    join(root, 'requests', 'pending', '2026-05-01-0001.yaml'),
    [
      'id: 2026-05-01-0001',
      'from: alice',
      'action: legacy action',
      'reason: legacy reason',
      'state: pending',
      'created_at: 2026-05-01T00:00:00.000Z',
      'status_log:',
      '  - state: pending',
      '    by: alice',
      '    at: 2026-05-01T00:00:00.000Z',
      '    note: created',
      'reviews: []',
      '',
    ].join('\n'),
  );
  const r = run(root, ['show', '2026-05-01-0001', '--format', 'json']);
  assert.equal(r.status, 0, `expected success; stderr=${r.stderr}`);
  const payload = JSON.parse(r.stdout) as Record<string, unknown>;
  assert.equal(payload['id'], '2026-05-01-0001');
  // Field is absent on the JSON payload too — undefined means the
  // hydrate path saw "no field" and the toJSON serialiser preserved
  // that absence end-to-end.
  assert.equal(payload['source_agora_play'], undefined);
});

test('JSON show surface: source_agora_play exposed under the same key', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  writePlay(root, {
    id: '2026-05-08-001',
    state: 'suspended',
    suspensions: [{ cliff: 'c', invitation: 'i' }],
  });
  const created = run(root, [
    'request',
    '--from',
    'alice',
    '--from-agora',
    '2026-05-08-001',
  ]);
  assert.equal(created.status, 0, `expected success; stderr=${created.stderr}`);
  const id = extractRequestId(created.stdout);
  const shown = run(root, ['show', id, '--format', 'json']);
  assert.equal(shown.status, 0, `expected success; stderr=${shown.stderr}`);
  const payload = JSON.parse(shown.stdout) as Record<string, unknown>;
  assert.equal(payload['source_agora_play'], '2026-05-08-001');
});

test('--game without --from-agora: refused with flag-shaped error', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = run(root, [
    'request',
    '--from',
    'alice',
    '--action',
    'a',
    '--reason',
    'b',
    '--game',
    'quest-1',
  ]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--game requires --from-agora/);
});

test('text show surface: source_agora_play rendered next to created line', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  writePlay(root, {
    id: '2026-05-08-001',
    state: 'suspended',
    suspensions: [{ cliff: 'c', invitation: 'i' }],
  });
  const created = run(root, [
    'request',
    '--from',
    'alice',
    '--from-agora',
    '2026-05-08-001',
  ]);
  assert.equal(created.status, 0);
  const id = extractRequestId(created.stdout);
  const shown = run(root, ['show', id, '--format', 'text']);
  assert.equal(shown.status, 0);
  assert.match(shown.stdout, /source_agora_play: 2026-05-08-001/);
});
