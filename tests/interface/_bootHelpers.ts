// Shared fixtures for the gate-boot interface test split (extracted from
// the original 1444-line boot.test.ts). bootstrap / runGate / the
// member + target + session request builders, reused by boot.test.ts and
// the per-concern boot*.test.ts files.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
export const GATE = resolve(here, '../../../bin/gate.mjs');

export function bootstrap(): { root: string; cleanup: () => void } {
  const root = makeTempRoot('guild-boot-');
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export function runGate(cwd: string, args: string[], env: Record<string, string> = {}): { stdout: string; status: number } {
  const result = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { stdout: result.stdout, status: result.status ?? -1 };
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function bootstrapWithMembers(): { root: string; cleanup: () => void } {
  // Two-member fixture so reviewer != author. alice authors, bob
  // reviews — the minimal shape the reviewed-authored predicate
  // needs.
  const root = mkdtempSync(join(tmpdir(), 'guild-boot-rev-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
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
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export function registerMember(root: string, name: string): void {
  runGate(root, ['register', '--name', name]);
}

export function makeRequestWithTarget(
  root: string,
  from: string,
  action: string,
  target: string,
): string {
  const r = spawnSync(
    process.execPath,
    [
      GATE,
      'request',
      '--from', from,
      '--action', action,
      '--reason', 'overlap test',
      '--target', target,
      '--format', 'json',
    ],
    { cwd: root, env: { ...process.env }, encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(`gate request failed: ${r.stderr}`);
  }
  const j = JSON.parse(r.stdout);
  return j.id ?? j.request_id;
}

export function makeRequestSessioned(
  root: string,
  from: string,
  action: string,
  target: string,
  sessionId: string,
): string {
  const r = spawnSync(
    process.execPath,
    [
      GATE,
      'request',
      '--from', from,
      '--action', action,
      '--reason', 'overlap test',
      '--target', target,
      '--format', 'json',
    ],
    {
      cwd: root,
      env: { ...process.env, GUILD_SESSION_ID: sessionId },
      encoding: 'utf8',
    },
  );
  if (r.status !== 0) {
    throw new Error(`gate request failed: ${r.stderr}`);
  }
  return JSON.parse(r.stdout).id as string;
}

