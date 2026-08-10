// Drift detection for AGENT.md's exhaustiveness claim.
//
// Two documents in this repo say AGENT.md carries every verb:
//
//   README.md            "Full verb map (AI-first reference) → AGENT.md"
//   docs/verbs.md        "If a verb is missing here, see AGENT.md for the
//                         full signature list (the agent quick reference
//                         carries every verb, state machine, and config
//                         field)."
//
// docs/verbs.md is explicitly partial and defers here, so AGENT.md is
// the single place an agent is promised complete coverage. Principle 11
// makes that promise load-bearing: `gate schema` is the machine
// contract, and AGENT.md is the human/agent-readable form of the same
// surface. A verb present in one and absent from the other means a cold
// agent reading the documented map cannot discover it.
//
// Measured 2026-08-10, before this test existed: AGENT.md was missing
// four verbs (`next`, `swarm-status`, `lore`, `rom`), three of them
// long-standing. Nothing had noticed, because the claim of
// exhaustiveness was prose and prose cannot fail.
//
// Direction is one-way on purpose. Every schema verb must appear in
// AGENT.md; the reverse (a `gate foo` string in AGENT.md with no schema
// entry) is not checked here, because AGENT.md legitimately shows
// composed shell examples and prose mentions that are not verbs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../../../');
const GATE = join(REPO, 'bin', 'gate.mjs');

interface VerbSchema {
  name: string;
}

/**
 * Ask the CLI, not a checked-in copy. `gate schema` is exhaustive
 * regardless of profile or `--all`, which is precisely why it is the
 * right side to derive the expectation from.
 */
function schemaVerbNames(): string[] {
  const root = makeTempRoot('guild-agentdoc-');
  try {
    writeFileSync(
      join(root, 'guild.config.yaml'),
      'content_root: .\nhost_names: [human]\n',
    );
    mkdirSync(join(root, 'members'));
    writeFileSync(join(root, 'members', 'alice.yaml'), 'name: alice\nrole: member\n');
    const r = spawnSync(process.execPath, [GATE, 'schema', '--format', 'json'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GUILD_ACTOR: 'alice' },
    });
    assert.equal(r.status, 0, `gate schema failed: ${r.stderr}`);
    const verbs = JSON.parse(r.stdout).verbs as VerbSchema[];
    return verbs.map((v) => v.name);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('AGENT.md documents every verb gate schema advertises', () => {
  const verbs = schemaVerbNames();
  // An empty or near-empty derivation would make the loop below a
  // no-op and this test a vacuous pass.
  assert.ok(
    verbs.length > 20,
    `gate schema returned only ${verbs.length} verbs — derivation is broken`,
  );

  const agent = readFileSync(join(REPO, 'AGENT.md'), 'utf8');
  const missing = verbs.filter(
    (v) => !new RegExp(`gate ${v.replace(/[-]/g, '\\-')}\\b`).test(agent),
  );
  assert.deepEqual(
    missing,
    [],
    `AGENT.md claims to carry every verb but does not mention: ${missing.join(', ')}\n` +
      `  Add a signature line for each, or drop the exhaustiveness claim in\n` +
      `  README.md and docs/verbs.md that points readers here.`,
  );
});
