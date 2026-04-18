import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectUtterances,
  pushMultilineField,
  renderUtterance,
  RequestJSON,
} from '../../src/interface/gate/voices.js';

// Synthetic request corpus. These are intentionally not Request
// domain objects — the point of collectUtterances is that it works
// on structural JSON shapes, so tests don't need domain fixtures.
const corpus: RequestJSON[] = [
  {
    id: '2026-04-14-001',
    from: 'kiri',
    action: 'Feature A',
    reason: 'first task',
    created_at: '2026-04-14T10:00:00.000Z',
    completion_note: 'shipped',
    reviews: [
      {
        by: 'noir',
        lense: 'devil',
        verdict: 'concern',
        comment: 'I/O racy',
        at: '2026-04-14T11:00:00.000Z',
      },
      {
        by: 'rin',
        lense: 'layer',
        verdict: 'ok',
        comment: 'layers fine',
        at: '2026-04-14T11:05:00.000Z',
      },
    ],
  },
  {
    id: '2026-04-14-002',
    from: 'noir',
    action: 'Feature B',
    reason: 'second task',
    created_at: '2026-04-14T12:00:00.000Z',
    deny_reason: 'scope creep',
    reviews: [],
  },
  {
    id: '2026-04-14-003',
    from: 'kiri',
    action: 'Feature C',
    reason: 'third task',
    created_at: '2026-04-14T13:00:00.000Z',
    failure_reason: 'upstream outage',
    reviews: [
      {
        by: 'noir',
        lense: 'user',
        verdict: 'ok',
        comment: 'users fine',
        at: '2026-04-14T14:00:00.000Z',
      },
    ],
  },
];

test('collectUtterances returns all authored + review utterances for an actor', () => {
  const result = collectUtterances(corpus, { name: 'kiri' });
  // kiri authored req 001 and 003, reviewed nothing.
  assert.equal(result.length, 2);
  assert.equal(result[0]?.kind, 'authored');
  assert.equal(result[0]?.requestId, '2026-04-14-001');
  assert.equal(result[1]?.kind, 'authored');
  assert.equal(result[1]?.requestId, '2026-04-14-003');
});

test('collectUtterances returns mixed authored + review for an actor who wears both hats', () => {
  const result = collectUtterances(corpus, { name: 'noir' });
  // noir authored req 002, reviewed req 001 (devil) and req 003 (user).
  // Sorted by timestamp: devil@11:00, noir-authored@12:00, user@14:00.
  assert.equal(result.length, 3);
  assert.equal(result[0]?.kind, 'review');
  assert.equal(result[0]?.requestId, '2026-04-14-001');
  assert.equal(result[1]?.kind, 'authored');
  assert.equal(result[1]?.requestId, '2026-04-14-002');
  assert.equal(result[2]?.kind, 'review');
  assert.equal(result[2]?.requestId, '2026-04-14-003');
});

test('collectUtterances: --lense filter excludes authored and non-matching reviews', () => {
  const result = collectUtterances(corpus, { name: 'noir', lense: 'devil' });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.kind, 'review');
  const r = result[0];
  if (r?.kind === 'review') {
    assert.equal(r.lense, 'devil');
    assert.equal(r.verdict, 'concern');
  }
});

test('collectUtterances: --verdict filter is independent of lens filter', () => {
  const result = collectUtterances(corpus, { name: 'noir', verdict: 'ok' });
  // noir has two ok reviews (layer on 001? no, rin; user on 003 — noir).
  // Only user/ok on 003.
  assert.equal(result.length, 1);
  if (result[0]?.kind === 'review') {
    assert.equal(result[0].lense, 'user');
    assert.equal(result[0].verdict, 'ok');
  }
});

test('collectUtterances: unknown name returns empty array', () => {
  assert.deepEqual(collectUtterances(corpus, { name: 'ghost' }), []);
});

test('collectUtterances: name matching is case-insensitive', () => {
  const lower = collectUtterances(corpus, { name: 'noir' });
  const upper = collectUtterances(corpus, { name: 'NOIR' });
  const mixed = collectUtterances(corpus, { name: 'NoIr' });
  assert.equal(lower.length, 3);
  assert.deepEqual(lower, upper);
  assert.deepEqual(lower, mixed);
});

test('collectUtterances: sorts results chronologically ascending', () => {
  const result = collectUtterances(corpus, { name: 'noir' });
  for (let i = 1; i < result.length; i++) {
    const prev = result[i - 1]?.at ?? '';
    const curr = result[i]?.at ?? '';
    assert.ok(prev.localeCompare(curr) <= 0, `${prev} should be ≤ ${curr}`);
  }
});

test('collectUtterances: authored utterance captures deny_reason when present', () => {
  const result = collectUtterances(corpus, { name: 'noir' });
  const authored = result.find(
    (u) => u.kind === 'authored' && u.requestId === '2026-04-14-002',
  );
  assert.ok(authored, 'expected noir-authored denied request');
  if (authored?.kind === 'authored') {
    assert.equal(authored.denyReason, 'scope creep');
    assert.equal(authored.completionNote, undefined);
    assert.equal(authored.failureReason, undefined);
  }
});

test('collectUtterances: authored utterance captures failure_reason when present', () => {
  const result = collectUtterances(corpus, { name: 'kiri' });
  const failed = result.find(
    (u) => u.kind === 'authored' && u.requestId === '2026-04-14-003',
  );
  assert.ok(failed, 'expected kiri-authored failed request');
  if (failed?.kind === 'authored') {
    assert.equal(failed.failureReason, 'upstream outage');
    assert.equal(failed.completionNote, undefined);
    assert.equal(failed.denyReason, undefined);
  }
});

test('collectUtterances: authored utterance captures completion_note when present', () => {
  const result = collectUtterances(corpus, { name: 'kiri' });
  const completed = result.find(
    (u) => u.kind === 'authored' && u.requestId === '2026-04-14-001',
  );
  assert.ok(completed, 'expected kiri-authored completed request');
  if (completed?.kind === 'authored') {
    assert.equal(completed.completionNote, 'shipped');
    assert.equal(completed.denyReason, undefined);
    assert.equal(completed.failureReason, undefined);
  }
});

test('collectUtterances: lens+verdict filters combine via AND', () => {
  const result = collectUtterances(corpus, {
    name: 'noir',
    lense: 'devil',
    verdict: 'ok',
  });
  // noir's devil review is concern, not ok, so nothing matches.
  assert.deepEqual(result, []);
});

test('collectUtterances: empty reviews array is handled gracefully', () => {
  const onlyAuthored: RequestJSON[] = [
    {
      id: '2026-04-15-001',
      from: 'kiri',
      action: 'x',
      reason: 'y',
      created_at: '2026-04-15T00:00:00.000Z',
      reviews: [],
    },
  ];
  const result = collectUtterances(onlyAuthored, { name: 'kiri' });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.kind, 'authored');
});

test('collectUtterances: missing reviews field (undefined) is handled gracefully', () => {
  const noReviews: RequestJSON[] = [
    {
      id: '2026-04-15-002',
      from: 'kiri',
      action: 'x',
      reason: 'y',
      created_at: '2026-04-15T00:00:00.000Z',
    },
  ];
  const result = collectUtterances(noReviews, { name: 'kiri' });
  assert.equal(result.length, 1);
});

test("collectUtterances: omitting name returns every actor's utterances", () => {
  const result = collectUtterances(corpus, {});
  // 3 authored (kiri, noir, kiri) + 3 reviews (noir, rin, noir) = 6
  assert.equal(result.length, 6);
});

test('collectUtterances: limit truncates after sort', () => {
  const asc = collectUtterances(corpus, { limit: 2 });
  assert.equal(asc.length, 2);
  // ascending: earliest two are 001-authored (10:00) and 001-review-devil (11:00)
  assert.equal(asc[0]?.requestId, '2026-04-14-001');
  assert.equal(asc[0]?.kind, 'authored');
  assert.equal(asc[1]?.requestId, '2026-04-14-001');
  assert.equal(asc[1]?.kind, 'review');
});

test('collectUtterances: order desc reverses the chronology', () => {
  const desc = collectUtterances(corpus, { order: 'desc', limit: 1 });
  assert.equal(desc.length, 1);
  // descending: most recent is 003-review-user (14:00)
  assert.equal(desc[0]?.requestId, '2026-04-14-003');
  assert.equal(desc[0]?.kind, 'review');
});

test('collectUtterances: authored utterance carries the from field', () => {
  const [first] = collectUtterances(corpus, { name: 'kiri', limit: 1 });
  assert.equal(first?.kind, 'authored');
  if (first?.kind === 'authored') {
    assert.equal(first.from, 'kiri');
  }
});

test('collectUtterances: review utterance carries the by field', () => {
  const [first] = collectUtterances(corpus, {
    name: 'noir',
    lense: 'devil',
    limit: 1,
  });
  assert.equal(first?.kind, 'review');
  if (first?.kind === 'review') {
    assert.equal(first.by, 'noir');
  }
});

test('renderUtterance: authored text omits actor label when includeActor=false', () => {
  const [first] = collectUtterances(corpus, { name: 'kiri', limit: 1 });
  assert.ok(first);
  const text = renderUtterance(first, false);
  assert.match(text, /req=2026-04-14-001 authored$/m);
  assert.doesNotMatch(text, /authored kiri/);
});

test('renderUtterance: authored text includes actor label when includeActor=true', () => {
  const [first] = collectUtterances(corpus, { name: 'kiri', limit: 1 });
  assert.ok(first);
  const text = renderUtterance(first, true);
  assert.match(text, /req=2026-04-14-001 authored kiri/);
});

test('renderUtterance: review text includes "by <name>" when includeActor=true', () => {
  const [first] = collectUtterances(corpus, {
    name: 'noir',
    lense: 'devil',
    limit: 1,
  });
  assert.ok(first);
  const text = renderUtterance(first, true);
  assert.match(text, /\[devil\/concern\] by noir/);
});

test('renderUtterance: authored text includes closure labels when present', () => {
  // noir-authored (002) is denied with reason "scope creep"
  const [authored] = collectUtterances(corpus, { name: 'noir' }).filter(
    (u) => u.kind === 'authored',
  );
  assert.ok(authored);
  const text = renderUtterance(authored, false);
  assert.match(text, /denied: scope creep/);
});


// ── invoked_by on review utterances ──
//
// When a review was recorded by GUILD_ACTOR acting on another
// member's behalf, Review.toJSON stamps `invoked_by` on the wire.
// voices must carry that through so tail / whoami / voices readers
// see the proxy, not just `show <id>`.

test('collectUtterances: review invoked_by flows onto the utterance', () => {
  const proxied: RequestJSON[] = [
    {
      id: '2026-04-18-0001',
      from: 'eris',
      action: 'do thing',
      reason: 'because',
      created_at: '2026-04-18T00:00:00.000Z',
      reviews: [
        {
          by: 'sentinel',
          lense: 'devil',
          verdict: 'ok',
          comment: 'looks fine',
          at: '2026-04-18T01:00:00.000Z',
          invoked_by: 'claude',
        },
      ],
    },
  ];
  const [u] = collectUtterances(proxied, { name: 'sentinel' });
  assert.ok(u);
  assert.equal(u.kind, 'review');
  if (u.kind === 'review') {
    assert.equal(u.invokedBy, 'claude');
  }
});

test('collectUtterances: review without invoked_by leaves invokedBy undefined', () => {
  const [u] = collectUtterances(corpus, { name: 'noir', lense: 'devil' });
  assert.ok(u);
  if (u.kind === 'review') {
    assert.equal(u.invokedBy, undefined);
  }
});

test('renderUtterance: review shows [invoked_by=<actor>] when proxied', () => {
  const proxied: RequestJSON[] = [
    {
      id: '2026-04-18-0001',
      from: 'eris',
      action: 'do thing',
      reason: 'because',
      created_at: '2026-04-18T00:00:00.000Z',
      reviews: [
        {
          by: 'sentinel',
          lense: 'devil',
          verdict: 'concern',
          comment: 'hmm',
          at: '2026-04-18T01:00:00.000Z',
          invoked_by: 'claude',
        },
      ],
    },
  ];
  const [u] = collectUtterances(proxied, { name: 'sentinel' });
  assert.ok(u);
  const text = renderUtterance(u, true);
  assert.match(text, /\[devil\/concern\] by sentinel \[invoked_by=claude\]/);
});

test('renderUtterance: review omits [invoked_by=...] when same-actor', () => {
  // Pinned so we don't start emitting redundant markers on the
  // self-invoke common case.
  const [u] = collectUtterances(corpus, { name: 'noir', lense: 'devil' });
  assert.ok(u);
  const text = renderUtterance(u, true);
  assert.equal(/invoked_by/.test(text), false);
});

test('renderUtterance: invoked_by shows even when includeActor=false (voices grouping)', () => {
  // voices groups by actor so `by <name>` is redundant — but the
  // proxy invoker is NOT redundant in that context. Pinned so we
  // don't accidentally suppress it alongside the actor label.
  const proxied: RequestJSON[] = [
    {
      id: '2026-04-18-0001',
      from: 'eris',
      action: 'do thing',
      reason: 'because',
      created_at: '2026-04-18T00:00:00.000Z',
      reviews: [
        {
          by: 'sentinel',
          lense: 'devil',
          verdict: 'ok',
          comment: 'fine',
          at: '2026-04-18T01:00:00.000Z',
          invoked_by: 'claude',
        },
      ],
    },
  ];
  const [u] = collectUtterances(proxied, { name: 'sentinel' });
  assert.ok(u);
  const text = renderUtterance(u, false);
  assert.match(text, /\[invoked_by=claude\]/);
  assert.equal(/by sentinel/.test(text), false);
});

// ── pushMultilineField: continuation indent for multi-line values ──

test('pushMultilineField: single-line value is unchanged from a plain push', () => {
  // Byte-identical when there are no newlines — ensures we don't
  // regress the common short-value case where no indent work is needed.
  const lines: string[] = [];
  pushMultilineField(lines, '  reason: ', 'short text');
  assert.deepEqual(lines, ['  reason: short text']);
});

test('pushMultilineField: multi-line value aligns continuation lines with value column', () => {
  const lines: string[] = [];
  pushMultilineField(lines, '  reason:   ', 'first\nsecond\nthird');
  // '  reason:   ' is 12 chars, so continuation lines must be indented
  // by 12 spaces so they align with the start of "first".
  assert.deepEqual(lines, [
    '  reason:   first',
    '            second',
    '            third',
  ]);
});

test('renderUtterance authored: multi-line reason indents continuation lines', () => {
  // Regression: pre-fix, multi-line reasons started each continuation
  // line at column 0, breaking the visual grouping of the field.
  const reqs: RequestJSON[] = [
    {
      id: '2026-04-18-0099',
      from: 'alice',
      action: 'ship',
      reason: 'first paragraph\nsecond paragraph',
      created_at: '2026-04-18T00:00:00.000Z',
    },
  ];
  const [u] = collectUtterances(reqs, { name: 'alice' });
  assert.ok(u);
  const text = renderUtterance(u, true);
  // The 'second paragraph' line must be indented to align with the
  // value column, not hang off the left margin.
  assert.match(text, /  reason: first paragraph\n          second paragraph/);
});
