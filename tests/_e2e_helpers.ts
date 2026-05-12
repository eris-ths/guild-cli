// Shared bootstrap / runGate / extractRequestId for E2E synergy tests.
//
// E2E tests (under tests/e2e/) intentionally drive the CLI as a
// subprocess — they verify the substrate from outside, like a real
// AI agent would. tests/interface/ already has near-duplicate
// helpers per-file; consolidating here keeps the synergy tests
// DRY without forcing the interface tests to migrate (their
// duplication is intentional — each interface test pins the verb
// it owns, in isolation).
//
// Path note: this file is compiled to `dist/tests/_e2e_helpers.js`
// and imported by `dist/tests/e2e/synergy_*.test.js`. The `GATE`
// constant climbs 3 levels (`dist/tests/e2e/X.js` → repo root →
// `bin/gate.mjs`), which matches the interface-test pattern.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** Absolute path to the `gate` CLI entrypoint (`bin/gate.mjs`). */
export const GATE = resolve(here, '../../bin/gate.mjs');

export interface GateResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number;
}

/**
 * Invoke `gate <args>` in the given content_root. Env is merged
 * onto the parent process env so `GUILD_ACTOR` etc. can be set
 * per-call. Output captured as strings.
 */
export function runGate(
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): GateResult {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

export interface BootstrapOptions {
  /** Member names to register under `members/<name>.yaml`. */
  readonly members?: readonly string[];
  /** Host names declared in `guild.config.yaml`. */
  readonly hosts?: readonly string[];
  /** Extra YAML to append to `guild.config.yaml` (e.g. `profile: swarm`). */
  readonly extraConfig?: string;
}

/**
 * Create a fresh tmpdir as a `content_root`, write a minimal
 * `guild.config.yaml`, and register the requested members.
 * Returns the root path plus a `cleanup()` to register with
 * `t.after()` in the test.
 *
 * Defaults: hosts=['eris'], members=['alice','bob','critic'] —
 * the common solo+critic shape. Override `members` / `hosts` for
 * synergy-specific personas.
 */
export function bootstrap(opts: BootstrapOptions = {}): {
  root: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), 'guild-e2e-'));
  const hosts = opts.hosts ?? ['eris'];
  const hostsYaml = hosts.map((h) => `  - ${h}`).join('\n');
  let config = `content_root: .\nhost_names:\n${hostsYaml}\n`;
  if (opts.extraConfig) {
    config += opts.extraConfig.endsWith('\n')
      ? opts.extraConfig
      : opts.extraConfig + '\n';
  }
  writeFileSync(join(root, 'guild.config.yaml'), config);

  mkdirSync(join(root, 'members'));
  const members = opts.members ?? ['alice', 'bob', 'critic'];
  for (const name of members) {
    writeFileSync(
      join(root, 'members', `${name}.yaml`),
      `name: ${name}\ncategory: professional\nactive: true\n`,
    );
  }

  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Extract the first request id (YYYY-MM-DD-NNNN) from CLI output
 * — typically `gate request --action ...` emits the id on
 * `✓ created: 2026-MM-DD-NNNN ...`. Throws if no id is found, so
 * a test that expected creation but got an error message fails
 * with a precise message.
 */
export function extractRequestId(output: string): string {
  const m = output.match(/\d{4}-\d{2}-\d{2}-\d{4}/);
  if (!m) {
    throw new Error(`could not find request id in output: ${output}`);
  }
  return m[0];
}
