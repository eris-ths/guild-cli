// voiceBudget — verbatim-occurrence audit for the project's voice
// phrases.
//
// What this test is:
//   A detector for proliferation of named pedagogical phrases —
//   "all first-class", "advisory — override freely", "DETECTOR, not
//   an enforcer", and similar. Each phrase has a budget (max
//   occurrences) and an allowed-files list. Adding a new occurrence
//   or a new phrase fails this test until VOICE_BUDGET is updated
//   in the same commit, with a rationale recorded inline.
//
// What this test is NOT:
//   - Not a paraphrase detector. Replacing "all first-class" with
//     "every option carries equal weight" passes this test while
//     violating principle 08's intent. That failure mode is real and
//     unsolved (LLM-difficult); it is watched in code review, not in
//     CI. See `i-2026-05-01-0001` (standing observation place).
//   - Not a content-correctness check. The test is a budget on
//     surface count + file location, nothing about whether the
//     phrase is appropriate.
//   - Not exhaustive. Voice lives in any prose; the budget tracks
//     only the named phrases that have crossed the "this is doctrine"
//     threshold. Most prose is unbudgeted.
//
// Scope:
//   Scans every executable layer:
//     `src/application/**`, `src/domain/**`, `src/infrastructure/**`,
//     `src/interface/**`, and `mcp/plugins/**`.
//   Deliberately does NOT scan `lore/`, `docs/`, `CONTRIBUTING.md`,
//   `CHANGELOG.md`, or `tests/` — those are metadata layers; principle
//   08 specifically names voice in the running code, not in surrounding
//   documentation. Quoting a named phrase inside a markdown explanation
//   is permitted; running a named phrase in source carries the doctrine.
//
// On failure:
//   The test fails with the phrase, the offending file:line list,
//   and a one-line pointer to CONTRIBUTING.md § voice budget. The
//   message is intentionally terse — pedagogical voice in the test
//   itself would be self-undermining.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// At runtime this file lives under dist/tests/interface/, so we walk
// three levels up (interface → tests → dist → repo root) to reach
// the source tree. Same shape every other test in this directory uses.
const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '../../..');

const SCAN_ROOTS: readonly string[] = [
  'src/application',
  'src/domain',
  'src/infrastructure',
  'src/interface',
  'mcp/plugins',
];

interface BudgetEntry {
  /** The verbatim string scanned for. Case-sensitive. */
  readonly phrase: string;
  /** Maximum occurrences across all scanned files. */
  readonly budget: number;
  /** Files (relative to repo root) where this phrase is permitted. */
  readonly allowed_files: readonly string[];
  /** Why this phrase is named, why this budget. Required reading
   *  for anyone adjusting the entry. */
  readonly rationale: string;
}

// VOICE_BUDGET — the registry. Each entry names a pedagogical
// phrase, declares its current scope, and explains why. Adding /
// editing entries is part of the same PR that introduces a new
// surface; see CONTRIBUTING.md § voice budget for the workflow.
const VOICE_BUDGET: readonly BudgetEntry[] = [
  {
    phrase: 'all first-class',
    budget: 2,
    allowed_files: [
      'src/interface/gate/handlers/unresponded.ts',
      'src/interface/gate/handlers/writeFormat.ts',
    ],
    rationale:
      'core pedagogical phrase reframing inaction as a legitimate ' +
      'option. surfaces in the unresponded footer (user-facing) and ' +
      'a writeFormat comment that documents the design intent of ' +
      'the chain advisory. increase only if a new surface genuinely ' +
      'requires this phrase rather than paraphrasing it.',
  },
  {
    phrase: 'All first-class.',
    budget: 1,
    allowed_files: ['src/interface/gate/handlers/writeFormat.ts'],
    rationale:
      'sentence-initial form of the same pedagogical phrase, ending ' +
      'the completed-with-concern advisory string. Tracked separately ' +
      'because verbatim grep is case-sensitive; the lowercase form ' +
      '(above) does not match this occurrence.',
  },
  {
    phrase: 'advisory — override freely',
    budget: 1,
    allowed_files: ['src/interface/gate/handlers/suggest.ts'],
    rationale:
      'stderr footer of `gate suggest --format text` — principle 02 ' +
      'at the point of use. budget 1 because this is an at-the-edge ' +
      'phrase tied to one surface (the suggest verb), not pedagogical ' +
      'across surfaces.',
  },
  {
    phrase: 'DETECTOR, not an enforcer',
    budget: 1,
    allowed_files: ['mcp/plugins/self-loop-check.mjs'],
    rationale:
      'principle 07 phrasing applied at a plugin. budget 1: each ' +
      'plugin should name its own detector posture in its own words; ' +
      'reusing this exact phrase across plugins would be cargo-culting ' +
      "rather than inheriting the project's voice deliberately.",
  },
  {
    phrase: 'Advisory — NOT a directive',
    budget: 2,
    allowed_files: ['src/interface/gate/handlers/schema.ts'],
    rationale:
      'principle 02 surface in the JSON Schema descriptions of ' +
      'suggested_next (boot output and suggest output). repeated ' +
      'because both surfaces have schema-aware consumers (LLM tool ' +
      'layers) that may read either independently. budget 2 = current ' +
      'count; increase only if a third schema entry emits suggested_next.',
  },
  {
    phrase: 'deliberately coarse',
    budget: 3,
    allowed_files: [
      'src/application/concern/UnrespondedConcernsQuery.ts',
      'src/interface/gate/handlers/unresponded.ts',
      'src/interface/gate/index.ts',
    ],
    rationale:
      'principled limitation marker for UnrespondedConcernsQuery — ' +
      'admits the detector does NOT infer partial-close (the reader ' +
      'judges). surfaces in the application layer (where the limitation ' +
      'is enforced), the handler (where it is exposed via the verb), ' +
      'and the help text (where it is announced). budget 3 = current ' +
      'count; new surfaces inheriting this discipline should reuse the ' +
      'phrase rather than paraphrase.',
  },
  {
    phrase: 'perception, not judgement',
    budget: 1,
    allowed_files: ['src/interface/gate/handlers/why.ts'],
    rationale:
      'principle 07 namestamp in why.ts header. budget 1 because the ' +
      'principle is named in lore/principles/07 (which this test does ' +
      'NOT scan); inline references in source are exceptions for ' +
      'high-density principle-bound surfaces, not the rule.',
  },
];

interface Occurrence {
  readonly file: string;
  readonly line: number;
}

function walk(absDir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(absDir);
  } catch {
    // Missing scan root is non-fatal — repo layout may legitimately
    // omit one of the directories (e.g. mcp/plugins on a slim install).
    return out;
  }
  for (const name of entries) {
    const full = join(absDir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|mjs|js)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function findOccurrences(phrase: string): Occurrence[] {
  const result: Occurrence[] = [];
  for (const root of SCAN_ROOTS) {
    const files = walk(join(REPO_ROOT, root));
    for (const abs of files) {
      const lines = readFileSync(abs, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.includes(phrase)) {
          result.push({
            file: relative(REPO_ROOT, abs),
            line: i + 1,
          });
        }
      }
    }
  }
  return result;
}

for (const entry of VOICE_BUDGET) {
  test(`voice budget: ${entry.phrase}`, () => {
    const found = findOccurrences(entry.phrase);

    if (found.length > entry.budget) {
      const locations = found.map((o) => `${o.file}:${o.line}`).join('\n  ');
      assert.fail(
        `VOICE_BUDGET[${JSON.stringify(entry.phrase)}] exceeded: ` +
          `${found.length} > ${entry.budget}\n  ${locations}\n` +
          `(see CONTRIBUTING.md § voice budget for the workflow)`,
      );
    }

    const allowed = new Set(entry.allowed_files);
    const outOfBounds = found.filter((o) => !allowed.has(o.file));
    if (outOfBounds.length > 0) {
      const locations = outOfBounds
        .map((o) => `${o.file}:${o.line}`)
        .join('\n  ');
      assert.fail(
        `VOICE_BUDGET[${JSON.stringify(entry.phrase)}] used outside allowed_files:\n  ` +
          `${locations}\n` +
          `(see CONTRIBUTING.md § voice budget for the workflow)`,
      );
    }
  });
}

// Sanity: VOICE_BUDGET itself is non-empty. A future commit that
// strips the registry entirely would silently disable the discipline.
test('voice budget: registry is non-empty', () => {
  assert.ok(
    VOICE_BUDGET.length > 0,
    'VOICE_BUDGET is empty; the discipline has been disabled. ' +
      'See lore/principles/08-voice-as-doctrine.md.',
  );
});
