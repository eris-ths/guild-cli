// Hook plugin loader (issue #36 Phase 1 step 5).
//
// End-to-end tests via the gate CLI:
//   - subscription: an after-hook fires after a successful approve
//   - veto: a before-hook returning { allow: false } blocks the
//     transition (exit 1, stderr message, no record mutation)
//   - multi-event: one plugin subscribing to multiple events fires
//     for each
//   - after-error: a throwing after-hook is logged but doesn't
//     break the handler
//   - before-error: a throwing before-hook is treated as a veto
//     (fail-closed)
//   - missing file / broken shape: surface as gate doctor findings
//   - plugins.trusted absent: hooks dropped with onMalformed notice
//   - first-veto-wins: a second before-hook is not invoked after a
//     first one already vetoed

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function runGate(cwd: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
}

interface Bootstrap {
  root: string;
  pluginDir: string;
  cleanup: () => void;
}

function bootstrap(extraConfig = ''): Bootstrap {
  const root = makeTempRoot('gate-hp-');
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n' + extraConfig,
  );
  mkdirSync(join(root, 'members'));
  // Two members so we can approve as a different actor than --from.
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  writeFileSync(
    join(root, 'members', 'bob.yaml'),
    'name: bob\ncategory: professional\nactive: true\n',
  );
  mkdirSync(join(root, 'plugins'));
  return {
    root,
    pluginDir: join(root, 'plugins'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function makeRequest(root: string): string {
  const r = runGate(root, [
    'request',
    '--from', 'alice',
    '--action', 'do thing',
    '--reason', 'because',
    '--format', 'json',
  ]);
  if (r.status !== 0) throw new Error(`request failed: ${r.stderr}`);
  return JSON.parse(r.stdout).id;
}

test('hook plugin: after:approve fires once on a successful approve', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  hooks:\n    - plugins/audit.mjs\n',
  );
  t.after(cleanup);
  // Hook writes one line to a side-effect file in cwd. Using an
  // absolute path under root keeps the test self-contained.
  const trace = join(root, 'trace.log');
  writeFileSync(
    join(pluginDir, 'audit.mjs'),
    `import { appendFileSync } from 'node:fs';
     export default {
       on: 'after:approve',
       run: async (ctx) => {
         appendFileSync(${JSON.stringify(trace)}, ctx.event + ':' + ctx.actor + ':' + ctx.request.state + '\\n');
       },
     };`,
  );

  const id = makeRequest(root);
  const r = runGate(root, ['approve', id, '--by', 'bob']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(trace), 'hook should have written to trace');
  assert.equal(readFileSync(trace, 'utf8'), 'after:approve:bob:approved\n');
});

test('hook plugin: before:approve veto blocks the transition', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  hooks:\n    - plugins/policy.mjs\n',
  );
  t.after(cleanup);
  writeFileSync(
    join(pluginDir, 'policy.mjs'),
    `export default {
       on: 'before:approve',
       run: async (ctx) => ({ allow: false, reason: 'org policy: bob cannot approve' }),
     };`,
  );

  const id = makeRequest(root);
  const r = runGate(root, ['approve', id, '--by', 'bob']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /hook vetoed approve on .+ org policy: bob cannot approve/);

  // Record stays pending — no mutation occurred.
  const show = runGate(root, ['show', id, '--format', 'json']);
  const payload = JSON.parse(show.stdout);
  assert.equal(payload.state, 'pending');
});

test('hook plugin: multi-event subscription fires for each registered event', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  hooks:\n    - plugins/audit-multi.mjs\n',
  );
  t.after(cleanup);
  const trace = join(root, 'trace.log');
  writeFileSync(
    join(pluginDir, 'audit-multi.mjs'),
    `import { appendFileSync } from 'node:fs';
     export default {
       on: ['after:approve', 'after:execute', 'after:complete'],
       run: async (ctx) => {
         appendFileSync(${JSON.stringify(trace)}, ctx.event + '\\n');
       },
     };`,
  );

  const id = makeRequest(root);
  assert.equal(runGate(root, ['approve', id, '--by', 'bob']).status, 0);
  assert.equal(runGate(root, ['execute', id, '--by', 'alice']).status, 0);
  assert.equal(runGate(root, ['complete', id, '--by', 'alice', '--note', 'done']).status, 0);

  assert.equal(
    readFileSync(trace, 'utf8'),
    'after:approve\nafter:execute\nafter:complete\n',
  );
});

test('hook plugin: throwing after-hook is logged but does not break the handler', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  hooks:\n    - plugins/throwy.mjs\n',
  );
  t.after(cleanup);
  writeFileSync(
    join(pluginDir, 'throwy.mjs'),
    `export default {
       on: 'after:approve',
       run: async () => { throw new Error('boom'); },
     };`,
  );

  const id = makeRequest(root);
  const r = runGate(root, ['approve', id, '--by', 'bob']);
  assert.equal(r.status, 0, 'after-hook error must NOT break the handler');
  assert.match(r.stderr, /warning: hook threw on after:approve.*boom/);
  // Transition still happened.
  const show = runGate(root, ['show', id, '--format', 'json']);
  assert.equal(JSON.parse(show.stdout).state, 'approved');
});

test('hook plugin: throwing before-hook is treated as a veto (fail-closed)', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  hooks:\n    - plugins/buggy.mjs\n',
  );
  t.after(cleanup);
  writeFileSync(
    join(pluginDir, 'buggy.mjs'),
    `export default {
       on: 'before:approve',
       run: async () => { throw new Error('plugin bug'); },
     };`,
  );

  const id = makeRequest(root);
  const r = runGate(root, ['approve', id, '--by', 'bob']);
  assert.equal(r.status, 1, 'fail-closed: a buggy before-hook must block');
  assert.match(r.stderr, /hook vetoed approve on .+plugin bug/);
  const show = runGate(root, ['show', id, '--format', 'json']);
  assert.equal(JSON.parse(show.stdout).state, 'pending');
});

test('hook plugin: first veto wins — later before-hooks do not run', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  hooks:\n' +
      '    - plugins/first-veto.mjs\n' +
      '    - plugins/second-trace.mjs\n',
  );
  t.after(cleanup);
  const trace = join(root, 'trace.log');
  writeFileSync(
    join(pluginDir, 'first-veto.mjs'),
    `export default {
       on: 'before:approve',
       run: async () => ({ allow: false, reason: 'first' }),
     };`,
  );
  writeFileSync(
    join(pluginDir, 'second-trace.mjs'),
    `import { appendFileSync } from 'node:fs';
     export default {
       on: 'before:approve',
       run: async () => { appendFileSync(${JSON.stringify(trace)}, 'second\\n'); },
     };`,
  );

  const id = makeRequest(root);
  const r = runGate(root, ['approve', id, '--by', 'bob']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /first/);
  // Second hook never ran.
  assert.ok(!existsSync(trace), 'first veto must short-circuit subsequent hooks');
});

test('hook plugin: missing file surfaces as gate doctor finding', (t) => {
  const { root, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  hooks:\n    - plugins/does-not-exist.mjs\n',
  );
  t.after(cleanup);

  // Read verbs still work — broken hook plugin is non-fatal.
  assert.equal(runGate(root, ['status']).status, 0);

  const doctor = runGate(root, ['doctor', '--format', 'json']);
  const report = JSON.parse(doctor.stdout);
  const finding = report.findings.find(
    (f: { area: string; message: string }) =>
      f.area === 'plugin' && /hook plugin.*import failed/.test(f.message),
  );
  assert.ok(finding, `expected hook-plugin import-failed finding in:\n${JSON.stringify(report.findings, null, 2)}`);
});

test('hook plugin: broken shape (no `on`) is rejected with a finding', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  hooks:\n    - plugins/no-on.mjs\n',
  );
  t.after(cleanup);
  writeFileSync(join(pluginDir, 'no-on.mjs'), `export default { run: () => {} };`);

  const doctor = runGate(root, ['doctor', '--format', 'json']);
  const report = JSON.parse(doctor.stdout);
  const finding = report.findings.find(
    (f: { area: string; message: string }) =>
      f.area === 'plugin' &&
      /must be an event name or an array of event names/.test(f.message),
  );
  assert.ok(finding, `expected shape-error finding in:\n${JSON.stringify(report.findings, null, 2)}`);
});

test('hook plugin: unknown event name is rejected with a finding', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  hooks:\n    - plugins/bogus-event.mjs\n',
  );
  t.after(cleanup);
  writeFileSync(
    join(pluginDir, 'bogus-event.mjs'),
    `export default { on: 'before:not-a-real-event', run: () => {} };`,
  );

  const doctor = runGate(root, ['doctor', '--format', 'json']);
  const report = JSON.parse(doctor.stdout);
  const finding = report.findings.find(
    (f: { area: string; message: string }) =>
      f.area === 'plugin' && /unknown event "before:not-a-real-event"/.test(f.message),
  );
  assert.ok(finding, `expected unknown-event finding in:\n${JSON.stringify(report.findings, null, 2)}`);
});

test('hook plugin: plugins.trusted absent → hooks skipped + onMalformed notice', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  hooks:\n    - plugins/audit.mjs\n',
  );
  t.after(cleanup);
  writeFileSync(
    join(pluginDir, 'audit.mjs'),
    `export default { on: 'after:approve', run: async () => {} };`,
  );

  const status = runGate(root, ['status']);
  assert.equal(status.status, 0);
  assert.match(status.stderr, /plugins\.hooks present but plugins\.trusted is not true/);
});

test('hook plugin: before:review veto blocks review append', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  hooks:\n    - plugins/review-policy.mjs\n',
  );
  t.after(cleanup);
  writeFileSync(
    join(pluginDir, 'review-policy.mjs'),
    `export default {
       on: 'before:review',
       run: async (ctx) => ({ allow: false, reason: 'review locked while pending host approval' }),
     };`,
  );

  const id = makeRequest(root);
  const r = runGate(root, ['review', id, '--by', 'bob', '--lense', 'devil', '--verdict', 'concern', '--note', 'should be blocked']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /hook vetoed review on .+review locked/);

  const show = runGate(root, ['show', id, '--format', 'json']);
  assert.equal(JSON.parse(show.stdout).reviews?.length ?? 0, 0);
});
