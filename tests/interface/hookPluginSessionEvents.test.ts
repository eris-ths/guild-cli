// Hook bus extension for session-boundary events (#290).
//
// Pins:
//   - after:rest fires on a successful `gate rest` and the hook sees
//     `ctx.sessionEvent` (id, kind, by, at) with `ctx.request` undefined
//   - same for after:wake and after:farewell
//   - before:rest veto blocks the YAML write entirely (substrate clean)
//   - a multi-axis plugin (subscribed to after:approve AND after:rest)
//     can branch on which subject is populated
//   - the existing request-lifecycle plugins keep working unchanged
//     (backward compat — `ctx.request` still populated for those events)
//   - throwing before:rest hook fails closed (treated as veto)
//   - throwing after:rest hook is logged but doesn't break the verb

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

interface RunResult { stdout: string; stderr: string; status: number; }
function runGate(cwd: string, args: string[], env: Record<string, string> = {}): RunResult {
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
  const root = makeTempRoot('gate-hp-sess-');
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n' + extraConfig,
  );
  mkdirSync(join(root, 'members'));
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

test('hook plugin: after:rest fires once on a successful gate rest', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  hooks:\n    - plugins/audit-rest.mjs\n',
  );
  t.after(cleanup);
  const trace = join(root, 'trace.log');
  // The hook reads ctx.sessionEvent (the new #290 field) and writes
  // the kind+id+by triple to assert that the subject is populated.
  // ctx.request must be undefined for session-boundary events; the
  // assertion `request_set:no` pins that contract.
  writeFileSync(
    join(pluginDir, 'audit-rest.mjs'),
    `import { appendFileSync } from 'node:fs';
     export default {
       on: 'after:rest',
       run: async (ctx) => {
         const requestSet = ctx.request !== undefined ? 'yes' : 'no';
         appendFileSync(${JSON.stringify(trace)},
           ctx.event + ':' + ctx.sessionEvent.kind + ':' + ctx.sessionEvent.by.value +
           ':request_set=' + requestSet + ':id=' + ctx.sessionEvent.id + '\\n');
       },
     };`,
  );

  const r = runGate(root, ['rest', '--by', 'alice']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(trace), 'after:rest hook should have written to trace');
  const line = readFileSync(trace, 'utf8');
  assert.match(line, /^after:rest:rest:alice:request_set=no:id=\d{4}-\d{2}-\d{2}-\d{3,4}\n$/);
});

test('hook plugin: after:wake fires once on a successful gate wake', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  hooks:\n    - plugins/audit-wake.mjs\n',
  );
  t.after(cleanup);
  const trace = join(root, 'trace.log');
  writeFileSync(
    join(pluginDir, 'audit-wake.mjs'),
    `import { appendFileSync } from 'node:fs';
     export default {
       on: 'after:wake',
       run: async (ctx) => {
         appendFileSync(${JSON.stringify(trace)},
           ctx.event + ':' + ctx.sessionEvent.kind + ':' + ctx.sessionEvent.by.value + '\\n');
       },
     };`,
  );

  const r = runGate(root, ['wake', '--by', 'alice']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(trace, 'utf8'), 'after:wake:wake:alice\n');
});

test('hook plugin: after:farewell fires once on a successful gate farewell', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  hooks:\n    - plugins/audit-farewell.mjs\n',
  );
  t.after(cleanup);
  const trace = join(root, 'trace.log');
  writeFileSync(
    join(pluginDir, 'audit-farewell.mjs'),
    `import { appendFileSync } from 'node:fs';
     export default {
       on: 'after:farewell',
       run: async (ctx) => {
         appendFileSync(${JSON.stringify(trace)},
           ctx.event + ':' + ctx.sessionEvent.kind + ':' + (ctx.sessionEvent.note ?? '_') + '\\n');
       },
     };`,
  );

  const r = runGate(root, ['farewell', '--by', 'alice', '--note', 'see you']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(trace, 'utf8'), 'after:farewell:farewell:see you\n');
});

test('hook plugin: before:rest veto blocks the YAML write (no record on disk)', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  hooks:\n    - plugins/policy-rest.mjs\n',
  );
  t.after(cleanup);
  writeFileSync(
    join(pluginDir, 'policy-rest.mjs'),
    `export default {
       on: 'before:rest',
       run: async () => ({ allow: false, reason: 'no rest during incident response' }),
     };`,
  );

  const r = runGate(root, ['rest', '--by', 'alice']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /hook vetoed rest on .+no rest during incident/);
  // Substrate is clean — no sessions/ dir was created since the
  // veto fires before the YAML write.
  assert.ok(
    !existsSync(join(root, 'sessions')) ||
      readdirSync(join(root, 'sessions')).length === 0,
    'vetoed gate rest must not write any session record',
  );
});

test('hook plugin: throwing before:rest is a veto (fail-closed) and blocks the write', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  hooks:\n    - plugins/buggy-rest.mjs\n',
  );
  t.after(cleanup);
  writeFileSync(
    join(pluginDir, 'buggy-rest.mjs'),
    `export default {
       on: 'before:rest',
       run: async () => { throw new Error('plugin bug'); },
     };`,
  );

  const r = runGate(root, ['rest', '--by', 'alice']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /hook vetoed rest on .+plugin bug/);
  assert.ok(
    !existsSync(join(root, 'sessions')) ||
      readdirSync(join(root, 'sessions')).length === 0,
    'fail-closed: thrown before-hook must not let the write through',
  );
});

test('hook plugin: throwing after:rest is logged but does not break the verb', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  hooks:\n    - plugins/throwy-rest.mjs\n',
  );
  t.after(cleanup);
  writeFileSync(
    join(pluginDir, 'throwy-rest.mjs'),
    `export default {
       on: 'after:rest',
       run: async () => { throw new Error('boom'); },
     };`,
  );

  const r = runGate(root, ['rest', '--by', 'alice']);
  assert.equal(r.status, 0, 'after-hook error must NOT break the handler');
  assert.match(r.stderr, /warning: hook threw on after:rest.*boom/);
  // Record landed on disk.
  const files = readdirSync(join(root, 'sessions'));
  assert.equal(files.length, 1, 'after-hook error must not block the write');
});

test('hook plugin: multi-axis plugin discriminates by which subject is populated', (t) => {
  // One plugin subscribes to BOTH a request-lifecycle event
  // (after:approve) and a session-boundary event (after:rest).
  // It must read `ctx.request` for the former and `ctx.sessionEvent`
  // for the latter — pinning that the bus populates the right subject
  // for each event.
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  hooks:\n    - plugins/multi-axis.mjs\n',
  );
  t.after(cleanup);
  const trace = join(root, 'trace.log');
  writeFileSync(
    join(pluginDir, 'multi-axis.mjs'),
    `import { appendFileSync } from 'node:fs';
     export default {
       on: ['after:approve', 'after:rest'],
       run: async (ctx) => {
         if (ctx.request) {
           appendFileSync(${JSON.stringify(trace)},
             'req:' + ctx.event + ':' + ctx.request.state + '\\n');
         } else if (ctx.sessionEvent) {
           appendFileSync(${JSON.stringify(trace)},
             'sess:' + ctx.event + ':' + ctx.sessionEvent.kind + '\\n');
         }
       },
     };`,
  );

  // Fire one of each.
  const reqResult = runGate(root, [
    'request',
    '--from', 'alice',
    '--action', 'do thing',
    '--reason', 'because',
    '--format', 'json',
  ]);
  assert.equal(reqResult.status, 0, reqResult.stderr);
  const id = JSON.parse(reqResult.stdout).id;
  assert.equal(runGate(root, ['approve', id, '--by', 'bob']).status, 0);
  assert.equal(runGate(root, ['rest', '--by', 'alice']).status, 0);

  assert.equal(
    readFileSync(trace, 'utf8'),
    'req:after:approve:approved\nsess:after:rest:rest\n',
  );
});

test('hook plugin: existing request-lifecycle plugin keeps working unchanged (backward compat)', (t) => {
  // Pre-#290, ctx.request was a non-optional field. After #290 it's
  // optional but still populated for request-lifecycle events.
  // Existing plugins that read ctx.request.X directly without a
  // null-check must keep working — this pins that contract.
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  hooks:\n    - plugins/legacy-shape.mjs\n',
  );
  t.after(cleanup);
  const trace = join(root, 'trace.log');
  writeFileSync(
    join(pluginDir, 'legacy-shape.mjs'),
    // No null-check on ctx.request — exact pre-#290 idiom.
    `import { appendFileSync } from 'node:fs';
     export default {
       on: 'after:approve',
       run: async (ctx) => {
         appendFileSync(${JSON.stringify(trace)},
           ctx.request.id.value + ':' + ctx.request.state + '\\n');
       },
     };`,
  );

  const reqResult = runGate(root, [
    'request',
    '--from', 'alice',
    '--action', 'thing',
    '--reason', 'r',
    '--format', 'json',
  ]);
  const id = JSON.parse(reqResult.stdout).id;
  const approve = runGate(root, ['approve', id, '--by', 'bob']);
  assert.equal(approve.status, 0, approve.stderr);
  assert.equal(readFileSync(trace, 'utf8'), `${id}:approved\n`);
});
