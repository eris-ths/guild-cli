// `gate templates` + `gate request --template` (#235).
//
// Coverage:
//   - templates list: dir present (sandbox fixtures) + dir absent
//   - templates show: known + unknown name
//   - request --template <known>: skeleton expansion populates
//     action/reason and stamps template/template_version/
//     gate_required_acknowledged on the record
//   - request --template <known> --action / --reason: explicit
//     overrides win, template stamp survives
//   - request --template <unknown>: exits 1, lists available
//   - frontmatter malformed: surfaces via onMalformed warn + skip
//   - profile=swarm + parallel executors without --template:
//     warning notice (phase-1 stub)
//   - byte-stable round-trip: a templated record reloads cleanly

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

interface Bootstrapped {
  root: string;
  templatesDir: string;
  cleanup: () => void;
}

function bootstrap(opts: { profile?: 'standard' | 'swarm' } = {}): Bootstrapped {
  const root = mkdtempSync(join(tmpdir(), 'guild-templates-'));
  const profileLine = opts.profile ? `profile: ${opts.profile}\n` : '';
  writeFileSync(
    join(root, 'guild.config.yaml'),
    `content_root: .\nhost_names: [eris]\n${profileLine}`,
  );
  mkdirSync(join(root, 'members'));
  const templatesDir = join(root, 'data', 'guild', 'templates', 'wave-brief');
  return {
    root,
    templatesDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function run(
  cwd: string,
  args: string[],
  actor?: string,
): { stdout: string; stderr: string; status: number } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (actor !== undefined) env['GUILD_ACTOR'] = actor;
  else delete env['GUILD_ACTOR'];
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env,
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

function registerAll(root: string, names: string[]): void {
  for (const n of names) {
    run(root, ['register', '--name', n]);
  }
}

function writeTemplate(
  templatesDir: string,
  name: string,
  body: { intendedUse?: string; gateRequired?: boolean; version?: number; markdown?: string },
): void {
  mkdirSync(templatesDir, { recursive: true });
  const ver = body.version ?? 1;
  const intended = body.intendedUse ?? `intended use of ${name}`;
  const gateReq = body.gateRequired ?? true;
  const md = body.markdown ?? `# Wave Brief: ${name}\n\nbody content for ${name}.\n`;
  // Quote intended_use defensively — prose may contain `:` which YAML
  // would parse as a nested mapping in flow-form.
  const intendedQuoted = JSON.stringify(intended);
  const content =
    `---\n` +
    `template_name: ${name}\n` +
    `template_version: ${ver}\n` +
    `intended_use: ${intendedQuoted}\n` +
    `gate_required: ${gateReq}\n` +
    `---\n` +
    md;
  writeFileSync(join(templatesDir, `${name}.md`), content);
}

// ---------------- templates list ----------------

test('gate templates list: empty content_root → built-in tier visible (#302)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['miki']);
  const r = run(root, ['templates', 'list']);
  assert.equal(r.status, 0, `list failed: ${r.stderr}`);
  // Built-in templates ship with guild-cli (#302). When no content_root
  // override exists, the catalogue shows only built-ins, each tagged
  // `[built-in]`. The 5 names shipped match `templates/wave-brief/`.
  assert.match(r.stdout, /single-impl.*\[built-in\]/);
  assert.match(r.stdout, /parallel-impl.*\[built-in\]/);
  assert.match(r.stdout, /verification.*\[built-in\]/);
});

test('gate templates list: content_root override shadows built-in (#302)', (t) => {
  const { root, templatesDir, cleanup } = bootstrap();
  t.after(cleanup);
  // Author a same-name override; the override should win and the
  // entry should be tagged `[content_root]` rather than `[built-in]`.
  writeTemplate(templatesDir, 'parallel-impl', {
    intendedUse: 'CUSTOM-PARALLEL-IMPL-OVERRIDE',
  });
  registerAll(root, ['miki']);
  const r = run(root, ['templates', 'list']);
  assert.equal(r.status, 0, `list failed: ${r.stderr}`);
  assert.match(r.stdout, /parallel-impl.*\[content_root\].*CUSTOM-PARALLEL-IMPL-OVERRIDE/);
  // Other built-ins still visible, untagged-as-override.
  assert.match(r.stdout, /verification.*\[built-in\]/);
});

test('gate templates list: dir with templates → catalogue', (t) => {
  const { root, templatesDir, cleanup } = bootstrap();
  t.after(cleanup);
  // Use names not present in built-in so the assertions don't rely on
  // override semantics.
  writeTemplate(templatesDir, 'custom-wave-a', {
    intendedUse: 'custom wave A',
  });
  writeTemplate(templatesDir, 'custom-wave-b', {
    intendedUse: 'custom wave B',
  });
  registerAll(root, ['miki']);
  const r = run(root, ['templates', 'list']);
  assert.equal(r.status, 0, `list failed: ${r.stderr}`);
  assert.match(r.stdout, /custom-wave-a.*\[content_root\]/);
  assert.match(r.stdout, /custom-wave-b.*\[content_root\]/);
  assert.match(r.stdout, /v1/);
  assert.match(r.stdout, /\[gate-required\]/);
});

test('gate templates list --format json: structured payload', (t) => {
  const { root, templatesDir, cleanup } = bootstrap();
  t.after(cleanup);
  writeTemplate(templatesDir, 'custom-single', { intendedUse: 'single' });
  registerAll(root, ['miki']);
  const r = run(root, ['templates', 'list', '--format', 'json']);
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout) as { templates: Array<Record<string, unknown>>; _meta: Record<string, unknown> };
  // Two tiers: 1 content_root + N built-in. Find the override entry
  // by name rather than asserting on count (built-in count can drift
  // as guild-cli ships more templates).
  const custom = j.templates.find((tpl) => tpl['name'] === 'custom-single');
  assert.ok(custom, 'custom-single missing from list');
  assert.equal(custom!['version'], 1);
  assert.equal(custom!['gate_required'], true);
  assert.equal(custom!['source'], 'content_root');
  assert.equal(j._meta['exists'], true);
  assert.equal(j._meta['builtin_exists'], true);
});

// ---------------- templates show ----------------

test('gate templates show <known>: emits markdown body', (t) => {
  const { root, templatesDir, cleanup } = bootstrap();
  t.after(cleanup);
  writeTemplate(templatesDir, 'parallel-impl', {
    markdown: '# Wave Brief: parallel-impl\n\nspecial-marker-XYZ\n',
  });
  registerAll(root, ['miki']);
  const r = run(root, ['templates', 'show', 'parallel-impl']);
  assert.equal(r.status, 0, `show failed: ${r.stderr}`);
  assert.match(r.stdout, /special-marker-XYZ/);
  assert.match(r.stdout, /^---/);
});

test('gate templates show <unknown>: exits 1, lists available', (t) => {
  const { root, templatesDir, cleanup } = bootstrap();
  t.after(cleanup);
  writeTemplate(templatesDir, 'single-impl', {});
  registerAll(root, ['miki']);
  const r = run(root, ['templates', 'show', 'no-such-template']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown template/);
  assert.match(r.stderr, /single-impl/);
});

test('gate templates show --format json: frontmatter + body', (t) => {
  const { root, templatesDir, cleanup } = bootstrap();
  t.after(cleanup);
  writeTemplate(templatesDir, 'verification', {
    intendedUse: 'verify the artefact',
    markdown: 'body line one\nbody line two\n',
  });
  registerAll(root, ['miki']);
  const r = run(root, ['templates', 'show', 'verification', '--format', 'json']);
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout) as Record<string, unknown>;
  assert.equal(j['name'], 'verification');
  assert.equal(j['intended_use'], 'verify the artefact');
  assert.match(String(j['body']), /body line one/);
  assert.equal(typeof j['frontmatter'], 'object');
});

// ---------------- request --template ----------------

test('gate request --template <known>: skeleton expansion + record stamp', (t) => {
  const { root, templatesDir, cleanup } = bootstrap();
  t.after(cleanup);
  writeTemplate(templatesDir, 'parallel-impl', {
    intendedUse: 'parallel implementation: 2+ executors',
  });
  registerAll(root, ['miki', 'leysia']);
  const r = run(root, [
    'request',
    '--from', 'miki',
    '--template', 'parallel-impl',
    '--format', 'json',
  ]);
  assert.equal(r.status, 0, `request failed: ${r.stderr}`);
  const id = (JSON.parse(r.stdout) as { id: string }).id;
  // Inspect the persisted record.
  const show = run(root, ['show', id, '--format', 'json']);
  const j = JSON.parse(show.stdout) as Record<string, unknown>;
  assert.equal(j['template'], 'parallel-impl');
  assert.equal(j['template_version'], 1);
  assert.equal(j['gate_required_acknowledged'], true);
  assert.match(String(j['action']), /parallel-impl/);
  assert.match(String(j['reason']), /parallel implementation/);
  // Asteria #8: text mode must surface the template stamp too,
  // not only json. Renders on the claim/witness axis as
  // `template: <name> (vN) [gate-ack]`.
  const showText = run(root, ['show', id, '--format', 'text']);
  assert.match(showText.stdout, /template: parallel-impl \(v1\) \[gate-ack\]/);
});

test('gate request --template <known> --action --reason: overrides survive, stamp persists', (t) => {
  const { root, templatesDir, cleanup } = bootstrap();
  t.after(cleanup);
  writeTemplate(templatesDir, 'parallel-impl', {
    intendedUse: 'parallel implementation',
  });
  registerAll(root, ['miki']);
  const r = run(root, [
    'request',
    '--from', 'miki',
    '--template', 'parallel-impl',
    '--action', 'custom-action-XYZ',
    '--reason', 'custom-reason-ABC',
    '--format', 'json',
  ]);
  assert.equal(r.status, 0, `request failed: ${r.stderr}`);
  const id = (JSON.parse(r.stdout) as { id: string }).id;
  const show = run(root, ['show', id, '--format', 'json']);
  const j = JSON.parse(show.stdout) as Record<string, unknown>;
  assert.equal(j['action'], 'custom-action-XYZ');
  assert.equal(j['reason'], 'custom-reason-ABC');
  // Stamp survives.
  assert.equal(j['template'], 'parallel-impl');
  assert.equal(j['template_version'], 1);
});

test('gate request --template <unknown>: exits 1, surfaces available list', (t) => {
  const { root, templatesDir, cleanup } = bootstrap();
  t.after(cleanup);
  writeTemplate(templatesDir, 'single-impl', {});
  registerAll(root, ['miki']);
  const r = run(root, [
    'request',
    '--from', 'miki',
    '--template', 'no-such',
    '--action', 'a', '--reason', 'b',
  ]);
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}: ${r.stdout}`);
  assert.match(r.stderr, /unknown template/);
  assert.match(r.stderr, /single-impl/);
});

test('templates: malformed frontmatter → onMalformed warn, skip in list', (t) => {
  const { root, templatesDir, cleanup } = bootstrap();
  t.after(cleanup);
  // Write a good template, then a bad one with no closing delimiter.
  writeTemplate(templatesDir, 'good', {});
  mkdirSync(templatesDir, { recursive: true });
  writeFileSync(
    join(templatesDir, 'bad.md'),
    '---\ntemplate_name: bad\n(no closing delimiter)\n',
  );
  registerAll(root, ['miki']);
  const r = run(root, ['templates', 'list']);
  assert.equal(r.status, 0, `list failed: ${r.stderr}`);
  // Good template is listed; bad one is dropped (malformed → skipped).
  assert.match(r.stdout, /good/);
  // The malformed warning routes through onMalformed (stderr).
  assert.match(r.stderr, /missing closing frontmatter|template/i);
});

// ---------------- profile=swarm gating (phase-1 stub) ----------------

test('profile=swarm + parallel executors without --template: warning notice', (t) => {
  const { root, templatesDir, cleanup } = bootstrap({ profile: 'swarm' });
  t.after(cleanup);
  writeTemplate(templatesDir, 'parallel-impl', {});
  registerAll(root, ['miki', 'leysia']);
  const r = run(root, [
    'request',
    '--from', 'miki',
    '--executors', 'miki,leysia',
    '--target', 'sometarget',
    '--action', 'do parallel work',
    '--reason', 'reason',
    '--format', 'json',
  ]);
  // Phase-1 stub: warning only, the request still lands.
  assert.equal(r.status, 0, `request failed: ${r.stderr}`);
  assert.match(
    r.stderr,
    /parallel executors under profile=swarm without --template/,
  );
});

test('profile=swarm + parallel executors WITH --template: no swarm-template warning', (t) => {
  const { root, templatesDir, cleanup } = bootstrap({ profile: 'swarm' });
  t.after(cleanup);
  writeTemplate(templatesDir, 'parallel-impl', {});
  registerAll(root, ['miki', 'leysia']);
  const r = run(root, [
    'request',
    '--from', 'miki',
    '--executors', 'miki,leysia',
    '--target', 'sometarget',
    '--template', 'parallel-impl',
    '--format', 'json',
  ]);
  assert.equal(r.status, 0, `request failed: ${r.stderr}`);
  assert.doesNotMatch(
    r.stderr,
    /parallel executors under profile=swarm without --template/,
  );
});

// ---------------- byte-stable round-trip ----------------

test('templated record: pre-#235 record (no template fields) round-trips clean', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['miki']);
  // Hand-write a pre-#235 record (no template fields).
  const reqDir = join(root, 'requests', 'pending');
  mkdirSync(reqDir, { recursive: true });
  const id = '2026-05-08-9999';
  const yaml =
    `id: ${id}\n` +
    `from: miki\n` +
    `action: pre-235 action\n` +
    `reason: pre-235 reason\n` +
    `state: pending\n` +
    `created_at: 2026-05-08T00:00:00.000Z\n` +
    `status_log:\n` +
    `  - state: pending\n` +
    `    by: miki\n` +
    `    at: 2026-05-08T00:00:00.000Z\n` +
    `    note: created\n` +
    `reviews: []\n`;
  writeFileSync(join(reqDir, `${id}.yaml`), yaml);
  const show = run(root, ['show', id, '--format', 'json']);
  assert.equal(show.status, 0, `show failed: ${show.stderr}`);
  const j = JSON.parse(show.stdout) as Record<string, unknown>;
  // No template fields surface.
  assert.equal(j['template'], undefined);
  assert.equal(j['template_version'], undefined);
  assert.equal(j['gate_required_acknowledged'], undefined);
});

// ---------------- mutex with --from-agora (#232 ↔ #235) ----------------

// `--template` (#235) and `--from-agora` (#232) both supply default
// action/reason. Combining them would make precedence ambiguous (does
// the play's invitation win, or the template's wave-brief stub?). The
// interface layer rejects up-front rather than silently picking one —
// same fail-open class rejectUnknownFlags is built to prevent. The
// error mentions both flags so the operator sees which combination
// tripped, and the request is NOT created (no record on disk).
test('gate request --template + --from-agora: mutex, exits 1, no record written', (t) => {
  const { root, templatesDir, cleanup } = bootstrap();
  t.after(cleanup);
  writeTemplate(templatesDir, 'parallel-impl', { intendedUse: 'parallel impl' });
  registerAll(root, ['miki']);
  const r = run(root, [
    'request',
    '--from', 'miki',
    '--template', 'parallel-impl',
    '--from-agora', '2026-05-08-001',
  ]);
  assert.notEqual(r.status, 0, `expected non-zero exit, got ${r.status}`);
  assert.match(
    r.stderr,
    /--template and --from-agora are mutually exclusive/,
    `expected mutex error, got: ${r.stderr}`,
  );
  // Confirm the request was not created (no .yaml under requests/).
  const list = run(root, ['list', '--state', 'pending', '--format', 'json']);
  assert.equal(list.status, 0);
  const lj = JSON.parse(list.stdout) as { requests: unknown[] };
  assert.equal(lj.requests.length, 0, 'mutex error must not create a record');
});
