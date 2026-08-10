// verbs-consistency — pin each entry's READ/WRITE/EXEMPT verb sets
// against the verbs the dispatcher actually accepts.
//
// Why this exists: the entry middleware (`withEntryLock`) treats any
// verb not in READ/EXEMPT as WRITE (fail-safe). That means a forgotten
// entry in verbs.ts would silently over-lock in the safe direction —
// no incident, but slow. Conversely, a forgotten verb in the switch
// would silently slip through. This test pins both sides so a new
// verb either lands in verbs.ts or fails CI loud.
//
// ## Why the expectation is parsed out of index.ts (2026-08-10)
//
// It used to be a hand-curated list per passage, and the header here
// argued for that: "AST-walking would be more clever but brittle; hand
// enumeration is obvious-when-broken."
//
// It was not obvious when broken. `gate swarm-status` shipped, was
// dispatched, appeared in `gate --help` and in `gate schema` — and was
// absent from BOTH verbs.ts and the hand-curated list here. The two
// sides agreed, so this test stayed green while the middleware took a
// write lock for a read-only command. Two hand-written lists that
// forget the same verb agree about nothing.
//
// The expectation now comes from the same structure the runtime uses:
// the `case '<verb>':` labels in each entry's index.ts. That is the
// dispatcher, so "the dispatcher accepts it" can no longer be true
// while this test is green. `assertNonEmpty` guards the parse — a
// regex that silently matches nothing would turn every assertion below
// into a vacuous pass (`reachability-audit`'s empty green).
//
// See lore/traps/trap_identity_string_written_by_hand_beside_its_table.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as gateVerbs from '../../src/interface/gate/verbs.js';
import * as agoraVerbs from '../../src/passages/agora/interface/verbs.js';
import * as devilVerbs from '../../src/passages/devil/interface/verbs.js';
import * as ctxVerbs from '../../src/passages/ctx/interface/verbs.js';

interface VerbSets {
  READ_VERBS: ReadonlySet<string>;
  WRITE_VERBS: ReadonlySet<string>;
  LOCK_EXEMPT_VERBS: ReadonlySet<string>;
}

interface Case {
  passage: string;
  verbs: VerbSets;
  all: readonly string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../../../src');

/**
 * The verbs an entry's dispatcher actually accepts: every `case '<v>':`
 * label in its index.ts. This is the structure the runtime switches on,
 * so it cannot drift from itself.
 */
function dispatchedVerbs(indexRelPath: string): string[] {
  const text = readFileSync(resolve(SRC, indexRelPath), 'utf8');
  const out = new Set<string>();
  for (const m of text.matchAll(/^\s*case '([a-z][a-z0-9-]*)':/gm)) {
    out.add(m[1] as string);
  }
  return [...out].sort();
}

/**
 * A derived expectation that comes back empty makes every assertion
 * built on it a no-op, and the suite goes green having checked nothing.
 * Pin the floor before using it.
 */
function assertNonEmpty(verbs: readonly string[], label: string): readonly string[] {
  assert.ok(
    verbs.length > 5,
    `${label}: derived only ${verbs.length} verbs from the dispatcher — ` +
      `the parse is broken and every check below would pass vacuously`,
  );
  return verbs;
}

const GATE_ALL = assertNonEmpty(dispatchedVerbs('interface/gate/index.ts'), 'gate');
const AGORA_ALL = assertNonEmpty(
  dispatchedVerbs('passages/agora/interface/index.ts'),
  'agora',
);
const DEVIL_ALL = assertNonEmpty(
  dispatchedVerbs('passages/devil/interface/index.ts'),
  'devil',
);
const CTX_ALL = assertNonEmpty(
  dispatchedVerbs('passages/ctx/interface/index.ts'),
  'ctx',
);

const CASES: Case[] = [
  { passage: 'gate', verbs: gateVerbs, all: GATE_ALL },
  { passage: 'agora', verbs: agoraVerbs, all: AGORA_ALL },
  { passage: 'devil', verbs: devilVerbs, all: DEVIL_ALL },
  { passage: 'ctx', verbs: ctxVerbs, all: CTX_ALL },
];

for (const c of CASES) {
  test(`${c.passage} verbs: union equals ALL_VERBS`, () => {
    const union = new Set<string>([
      ...c.verbs.READ_VERBS,
      ...c.verbs.WRITE_VERBS,
      ...c.verbs.LOCK_EXEMPT_VERBS,
    ]);
    const all = new Set<string>(c.all);
    const missingFromVerbs = [...all].filter((v) => !union.has(v)).sort();
    const extraInVerbs = [...union].filter((v) => !all.has(v)).sort();
    assert.deepEqual(
      missingFromVerbs,
      [],
      `${c.passage}: verbs in dispatcher but absent from verbs.ts: ${missingFromVerbs.join(', ')}`,
    );
    assert.deepEqual(
      extraInVerbs,
      [],
      `${c.passage}: verbs in verbs.ts not in dispatcher: ${extraInVerbs.join(', ')}`,
    );
  });

  test(`${c.passage} verbs: READ ∩ WRITE = ∅`, () => {
    const overlap = [...c.verbs.READ_VERBS].filter((v) =>
      c.verbs.WRITE_VERBS.has(v),
    );
    assert.deepEqual(overlap, [], `${c.passage}: READ ∩ WRITE: ${overlap.join(', ')}`);
  });

  test(`${c.passage} verbs: READ ∩ EXEMPT = ∅`, () => {
    const overlap = [...c.verbs.READ_VERBS].filter((v) =>
      c.verbs.LOCK_EXEMPT_VERBS.has(v),
    );
    assert.deepEqual(
      overlap,
      [],
      `${c.passage}: READ ∩ EXEMPT: ${overlap.join(', ')}`,
    );
  });

  test(`${c.passage} verbs: WRITE ∩ EXEMPT = ∅`, () => {
    const overlap = [...c.verbs.WRITE_VERBS].filter((v) =>
      c.verbs.LOCK_EXEMPT_VERBS.has(v),
    );
    assert.deepEqual(
      overlap,
      [],
      `${c.passage}: WRITE ∩ EXEMPT: ${overlap.join(', ')}`,
    );
  });
}
