// gate doctor — content_root orientation disclosure.
//
// Carries the same conditional-disclosure pattern PR #108
// (register stderr notice) and PR #110 (boot text content_root
// line) introduced. Pre-fix, `gate doctor` reported "members 1
// total, 0 malformed" without disclosing WHICH content_root
// produced those numbers — an operator running doctor from a
// subdir of an active guild had no signal that the diagnostic
// walked up to a parent guild.
//
// Pinned here:
//   - aligned cwd (cwd === content_root, config present) stays
//     silent (voice budget)
//   - subdir of active guild → discloses with parent's config
//   - misconfigured_cwd (no config + no data) suppresses the
//     disclosure (the bigger warning owns that surface; one
//     disclosure surface at a time per
//     lore/principles/09-orientation-disclosure.md)
//   - --summary mode also discloses
//   - --format json is unaffected (text-only disclosure;
//     JSON contract unchanged on doctor side per the principle)

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

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-doc-cr-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, d));
  }
  for (const s of ['pending', 'approved', 'executing', 'completed', 'failed', 'denied']) {
    mkdirSync(join(root, 'requests', s));
  }
  // One member so totals > 0 — the disclosure suppress-on-empty
  // boundary stays out of the picture for the basic cases.
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(
  cwd: string,
  args: string[],
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
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

test('doctor text: aligned cwd (cwd === content_root) stays silent', (t) => {
  // The 99% normal case. Pin the absence so a future "always
  // disclose" refactor can't regress voice budget.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['doctor']);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /^content root:/m);
});

test('doctor text: subdir of active guild discloses content_root + parent config', (t) => {
  // The case PR #108 closed on register and PR #110 closed on
  // boot — doctor inherits the same gap. Now discloses with the
  // canonical line shape (matches register/boot phrasing
  // verbatim per principle 09).
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const sub = join(root, 'sub');
  mkdirSync(sub);
  const r = runGate(sub, ['doctor']);
  assert.equal(r.status, 0);
  assert.match(
    r.stdout,
    new RegExp(
      `^content root: ${escapeRegex(root)} \\(config: ${escapeRegex(join(root, 'guild.config.yaml'))}\\)$`,
      'm',
    ),
  );
});

test('doctor text: no-config-found case discloses cwd-as-fallback (totals > 0)', (t) => {
  // The other half of the disclosure trigger: an operator using
  // cwd as implicit content_root (no parent config) gets the
  // `(config: none — cwd used as fallback root)` segment naming
  // the implicit default.
  const root = mkdtempSync(join(tmpdir(), 'guild-doc-cr-nocfg-'));
  try {
    mkdirSync(join(root, 'members'));
    writeFileSync(
      join(root, 'members', 'solo.yaml'),
      'name: solo\ncategory: professional\nactive: true\n',
    );
    const r = runGate(root, ['doctor']);
    assert.equal(r.status, 0);
    assert.match(
      r.stdout,
      new RegExp(
        `^content root: ${escapeRegex(root)} \\(config: none — cwd used as fallback root\\)$`,
        'm',
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('doctor text: misconfigured_cwd (no config + no data) suppresses content_root disclosure', (t) => {
  // Principle 09: disclosure is exactly one surface at a time.
  // The bigger misconfigured-cwd warning takes over when totals
  // === 0 + config null; the new disclosure must NOT also fire.
  const root = mkdtempSync(join(tmpdir(), 'guild-doc-cr-misc-'));
  try {
    const r = runGate(root, ['doctor']);
    // The bigger warning fires on stderr.
    assert.match(r.stderr, /no guild.config.yaml found/);
    // The new disclosure must NOT fire alongside it.
    assert.doesNotMatch(r.stdout, /^content root:/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('doctor --summary: subdir case also discloses', (t) => {
  // The --summary mode is the agent-friendly compact view. The
  // disclosure applies there too — same trigger, same line.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const sub = join(root, 'sub');
  mkdirSync(sub);
  const r = runGate(sub, ['doctor', '--summary']);
  assert.equal(r.status, 0);
  assert.match(
    r.stdout,
    new RegExp(
      `^content root: ${escapeRegex(root)} \\(config: ${escapeRegex(join(root, 'guild.config.yaml'))}\\)$`,
      'm',
    ),
  );
});

test('doctor --format json: JSON envelope unaffected by the new disclosure', (t) => {
  // Principle 09: where a verb's JSON envelope doesn't have
  // natural room for the structured boolean, text-only is
  // acceptable. Doctor JSON is `{summary, findings}` — pinning
  // that no `content_root` / `cwd_outside_content_root` field
  // sneaks in here means the JSON consumers' contract stays
  // backwards-compatible. (Future: if a structured field is
  // wanted, it gets its own PR with a CHANGELOG entry.)
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const sub = join(root, 'sub');
  mkdirSync(sub);
  const r = runGate(sub, ['doctor', '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  // No content_root field on the JSON side.
  assert.equal(payload.content_root, undefined);
  assert.equal(payload.cwd_outside_content_root, undefined);
  // The JSON shape stays the same as before — summary + findings.
  assert.ok(payload.summary);
  assert.ok(Array.isArray(payload.findings));
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
