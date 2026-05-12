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
// We use a hand-curated ALL_VERBS per passage (mirrored against the
// switch / KNOWN_COMMANDS arrays in each index.ts). AST-walking would
// be more clever but brittle; hand enumeration is obvious-when-broken
// in the same spirit as the index-level KNOWN_COMMANDS arrays.

import { test } from 'node:test';
import assert from 'node:assert/strict';

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

// Mirrors of the switch cases in each entry's index.ts. If a new verb
// lands, add it here too — the test will fail loud at CI otherwise.
const GATE_ALL = [
  'request', 'pending', 'board', 'list', 'show', 'voices', 'tail',
  'whoami', 'register', 'chain', 'approve', 'deny', 'execute',
  'complete', 'fail', 'review', 'claim', 'witness', 'unwitness',
  'thank', 'fast-track', 'issues',
  'message', 'broadcast', 'inbox', 'doctor', 'repair', 'status',
  'boot', 'suggest', 'flow-suggest', 'transcript', 'summarize', 'why', 'resume',
  'schema', 'unresponded', 'templates', 'rest', 'wake', 'farewell',
  'wave-status', 'lense-stats', 'review-context',
  'decisions', 'self-pattern',
] as const;

const AGORA_ALL = [
  'new', 'play', 'move', 'suspend', 'resume', 'conclude',
  'list', 'show', 'last', 'cliff', 'schema',
] as const;

const DEVIL_ALL = [
  'open', 'entry', 'list', 'show', 'dismiss', 'resolve',
  'suspend', 'resume', 'ingest', 'conclude', 'schema',
] as const;

const CTX_ALL = ['record'] as const;

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
