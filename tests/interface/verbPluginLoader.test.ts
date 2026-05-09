// Verb plugin loader (issue #36 Phase 1 step 4).
//
// End-to-end tests via the gate CLI:
//   - successful load: a valid plugin's verb dispatches and `gate
//     schema` lists it with `source: "plugin"`
//   - name collision with built-in: rejected, surfaces via `gate
//     doctor` as a finding (area: 'plugin')
//   - missing file: same — error finding, CLI keeps working
//   - broken module (syntax error): error finding, no crash
//   - no `plugins.trusted: true`: paths are silently skipped (with
//     onMalformed notice on stderr)
//
// The unit-level shape validation lives inline in the loader itself
// and is exercised here via the broken-shape test (export not an
// object → error finding).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

interface RunResult {
  stdout: string;
  stderr: string;
  status: number;
}

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
  const root = makeTempRoot('gate-vp-');
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n' + extraConfig,
  );
  mkdirSync(join(root, 'members'));
  mkdirSync(join(root, 'plugins'));
  return {
    root,
    pluginDir: join(root, 'plugins'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const VALID_PLUGIN = `export default {
  name: 'myverb',
  category: 'meta',
  summary: 'plugin test verb',
  input: { type: 'object', properties: { text: { type: 'string' } } },
  output: { type: 'object' },
  run: async (_c, args) => {
    process.stdout.write('plugin ran with text=' + args.options['text'] + '\\n');
    return 0;
  },
};`;

test('verb plugin: loads + dispatches when plugins.trusted: true', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  verbs:\n    - plugins/myverb.mjs\n',
  );
  t.after(cleanup);
  writeFileSync(join(pluginDir, 'myverb.mjs'), VALID_PLUGIN);

  const r = runGate(root, ['myverb', '--text', 'hello']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /plugin ran with text=hello/);
});

test('verb plugin: gate schema lists the plugin verb with source="plugin"', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  verbs:\n    - plugins/myverb.mjs\n',
  );
  t.after(cleanup);
  writeFileSync(join(pluginDir, 'myverb.mjs'), VALID_PLUGIN);

  const r = runGate(root, ['schema', '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  const myverb = (payload.verbs as Array<{ name: string; source: string }>).find(
    (v) => v.name === 'myverb',
  );
  assert.ok(myverb, 'plugin verb is in the schema payload');
  assert.equal(myverb!.source, 'plugin');
});

test('verb plugin: gate schema --format text tags the plugin verb [plugin]', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  verbs:\n    - plugins/myverb.mjs\n',
  );
  t.after(cleanup);
  writeFileSync(join(pluginDir, 'myverb.mjs'), VALID_PLUGIN);

  const r = runGate(root, ['schema', '--format', 'text']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /myverb \[meta\] \[plugin\] — plugin test verb/);
});

test('verb plugin: name collision with built-in is rejected, error surfaces via gate doctor', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  verbs:\n    - plugins/colliding.mjs\n',
  );
  t.after(cleanup);
  writeFileSync(
    join(pluginDir, 'colliding.mjs'),
    VALID_PLUGIN.replace("name: 'myverb'", "name: 'request'"),
  );

  // Built-in `request` verb still works — plugin shadow rejected.
  // (No need to actually invoke it — the schema check is sufficient
  // to confirm dispatch wasn't hijacked.)
  const schema = runGate(root, ['schema', '--format', 'json', '--verb', 'request']);
  assert.equal(schema.status, 0);
  const payload = JSON.parse(schema.stdout);
  const requestVerb = payload.verbs.find((v: { name: string }) => v.name === 'request');
  assert.equal(requestVerb.source, 'core', 'built-in `request` was not shadowed');

  // doctor surfaces the collision as a plugin-area finding.
  const doctor = runGate(root, ['doctor', '--format', 'json']);
  const report = JSON.parse(doctor.stdout);
  const finding = report.findings.find(
    (f: { area: string; message: string }) =>
      f.area === 'plugin' && /collides with a built-in/.test(f.message),
  );
  assert.ok(finding, `expected collision finding in:\n${JSON.stringify(report.findings, null, 2)}`);
});

test('verb plugin: missing file surfaces as gate doctor finding (CLI keeps working)', (t) => {
  const { root, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  verbs:\n    - plugins/does-not-exist.mjs\n',
  );
  t.after(cleanup);

  // Read verbs still work despite the broken plugin path.
  const status = runGate(root, ['status']);
  assert.equal(status.status, 0);

  // doctor surfaces the load failure.
  const doctor = runGate(root, ['doctor', '--format', 'json']);
  const report = JSON.parse(doctor.stdout);
  const finding = report.findings.find(
    (f: { area: string; message: string }) =>
      f.area === 'plugin' && /import failed/.test(f.message),
  );
  assert.ok(finding, `expected import-failed finding in:\n${JSON.stringify(report.findings, null, 2)}`);
});

test('verb plugin: broken shape (export not an object) is rejected with a finding', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  verbs:\n    - plugins/broken.mjs\n',
  );
  t.after(cleanup);
  writeFileSync(join(pluginDir, 'broken.mjs'), `export default 42;`);

  const doctor = runGate(root, ['doctor', '--format', 'json']);
  const report = JSON.parse(doctor.stdout);
  const finding = report.findings.find(
    (f: { area: string; message: string }) =>
      f.area === 'plugin' && /default export is not an object/.test(f.message),
  );
  assert.ok(finding, `expected shape-error finding in:\n${JSON.stringify(report.findings, null, 2)}`);
});

test('verb plugin: plugins.trusted absent → loader skips with onMalformed notice', (t) => {
  // No `trusted: true` → plugin paths drop with an onMalformed
  // notice. This is the consent gate: the YAML alone is not
  // consent. See SECURITY.md § "Plugin trust model".
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  verbs:\n    - plugins/myverb.mjs\n',
  );
  t.after(cleanup);
  writeFileSync(join(pluginDir, 'myverb.mjs'), VALID_PLUGIN);

  // The plugin verb is NOT registered.
  const schema = runGate(root, ['schema', '--format', 'json']);
  assert.equal(schema.status, 0);
  const payload = JSON.parse(schema.stdout);
  const found = payload.verbs.find((v: { name: string }) => v.name === 'myverb');
  assert.equal(found, undefined, 'plugin verb must not register without plugins.trusted: true');

  // The notice surfaces on stderr (somewhere — gate verbs all share
  // the GuildConfig.load path that emits onMalformed). Pick a quiet
  // verb whose stderr is empty in the clean case.
  const status = runGate(root, ['status']);
  assert.equal(status.status, 0);
  assert.match(
    status.stderr,
    /plugins\.verbs present but plugins\.trusted is not true/,
  );
});

test('verb plugin: duplicate names within one load pass — first wins, rest rejected', (t) => {
  const { root, pluginDir, cleanup } = bootstrap(
    'plugins:\n  trusted: true\n  verbs:\n' +
      '    - plugins/first.mjs\n' +
      '    - plugins/second.mjs\n',
  );
  t.after(cleanup);
  writeFileSync(join(pluginDir, 'first.mjs'), VALID_PLUGIN);
  // Both export the same `name: 'myverb'`.
  writeFileSync(join(pluginDir, 'second.mjs'), VALID_PLUGIN);

  const schema = runGate(root, ['schema', '--format', 'json']);
  const payload = JSON.parse(schema.stdout);
  const myverbs = payload.verbs.filter((v: { name: string }) => v.name === 'myverb');
  assert.equal(myverbs.length, 1, 'only the first registration wins');

  const doctor = runGate(root, ['doctor', '--format', 'json']);
  const report = JSON.parse(doctor.stdout);
  const dup = report.findings.find(
    (f: { area: string; message: string }) =>
      f.area === 'plugin' && /already registered by an earlier plugin/.test(f.message),
  );
  assert.ok(dup, 'second registration is rejected with a finding');
});
