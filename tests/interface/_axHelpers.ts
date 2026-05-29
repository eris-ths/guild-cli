// Shared fixtures for the AX (AI-experience) interface test split,
// extracted from the original 1549-line ax.test.ts. One bootstrap +
// gate runner + id helpers, reused by ax.test.ts and the per-concern
// ax*.test.ts files (suggest / verbs-available-now / voice / thank).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

export function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-ax-'));
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

export function runGate(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
  input?: string,
): { stdout: string; stderr: string; status: number } {
  const opts: Parameters<typeof spawnSync>[2] = {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  };
  if (input !== undefined) opts.input = input;
  const r = spawnSync(process.execPath, [GATE, ...args], opts);
  return {
    stdout: typeof r.stdout === 'string' ? r.stdout : '',
    stderr: typeof r.stderr === 'string' ? r.stderr : '',
    status: r.status ?? -1,
  };
}

export const today = () => new Date().toISOString().slice(0, 10);
export const rid = (n: number) => `${today()}-${String(n).padStart(4, '0')}`;
