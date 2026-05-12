// Synergy S2 — Cross-Session Body Switch
// =======================================
//
// E2E test for the multi-body coordination pattern: the same actor
// name acting from different *sessions* — terminal A vs terminal B,
// or "early-day eris vs late-day eris" — each stamped distinctly on
// the substrate via `GUILD_SESSION_ID`. This is the operational form
// of principle 14 (substrate engagement reduces coordination context
// cost) at the smallest scale: one actor's distinct bodies coordinate
// through the record, not through shared working memory.
//
// What we assert:
//
//   - Two sessions of the same actor produce two distinct
//     `*_by_session` stamps on one request:
//     `opened_by_session` (set when the request is created) and
//     `claimed_by_session` (set when the actor claims the wave).
//   - A re-witness from a new session_id overwrites
//     `witness_sessions[<actor>]` (single-value map; not append-only
//     — only the latest body's session_id is retained).
//   - Malformed `GUILD_SESSION_ID` env value is rejected; the verb
//     does not silently strip it.
//
// Why this synergy is in the catalog:
//
//   Purpose: keep the substrate honest about *which body* did *which
//   move* on the same record. Without session_id stamps, the
//   substrate sees one actor and merges the bodies into a single
//   timeline; with them, a cold reader can read "claude in terminal
//   A opened this, claude in terminal B closed it" without asking.
//
//   Trade-off: session_id is hand-named (`<role>-<wave_date>` is the
//   suggested template, but no enforcement). Auto-allocation is on
//   the backlog and would lose the human-readable property; until
//   then, the operator picks names that survive being re-read in 30
//   days. Mismatched names degrade the synergy gracefully — the
//   record is still correct, just harder to scan.
//
// Linked playbook section: `docs/playbook.md` § "Synergies" → S2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrap,
  runGate,
  extractRequestId,
} from '../_e2e_helpers.js';

const ACTOR = 'claude';
const SESSION_A = 'claude-terminal-a-2026-05-12';
const SESSION_B = 'claude-terminal-b-2026-05-12';

test('S2: request opened in session A, claimed in session B — both stamps on record', (t) => {
  const { root, cleanup } = bootstrap({ members: [ACTOR, 'critic'] });
  t.after(cleanup);

  // Body A opens the request.
  const created = runGate(
    root,
    [
      'request',
      '--from', ACTOR,
      '--executors', ACTOR,
      '--action', 'cross-session smoke',
      '--reason', 'verify multi-body coordination',
    ],
    { GUILD_SESSION_ID: SESSION_A },
  );
  assert.equal(created.status, 0, created.stderr);
  const id = extractRequestId(created.stdout + created.stderr);

  // Critic approves so the wave reaches the claim-eligible state.
  // Critic's session_id is irrelevant to this synergy; left unset.
  assert.equal(runGate(root, ['approve', id, '--by', 'critic']).status, 0);

  // Body B claims the wave from a different session.
  const claimed = runGate(
    root,
    ['claim', id, '--by', ACTOR, '--note', 'body B picks up'],
    { GUILD_SESSION_ID: SESSION_B },
  );
  assert.equal(claimed.status, 0, claimed.stderr);

  // Inspect the record: both stamps must be present and distinct.
  const shown = runGate(root, ['show', id, '--format', 'json']);
  const record = JSON.parse(shown.stdout);

  assert.equal(record.opened_by_session, SESSION_A,
    `opened_by_session should be SESSION_A; got: ${record.opened_by_session}`);
  assert.equal(record.claimed_by_session, SESSION_B,
    `claimed_by_session should be SESSION_B; got: ${record.claimed_by_session}`);

  // Both stamps live on the same actor — the multi-body coordination
  // contract is "one --by, two session_ids visible side-by-side."
  assert.equal(record.from, ACTOR);
  assert.equal(record.claimed_by, ACTOR);
});

test('S2: re-witness with new session_id overwrites witness_sessions[actor] (latest body wins)', (t) => {
  const { root, cleanup } = bootstrap({ members: [ACTOR, 'critic'] });
  t.after(cleanup);

  const created = runGate(root, [
    'request',
    '--from', 'critic',
    '--executors', 'critic',
    '--action', 'witness session overwrite smoke',
    '--reason', 'pin the latest-wins contract',
  ]);
  const id = extractRequestId(created.stdout + created.stderr);

  // Body A witnesses first.
  const w1 = runGate(
    root,
    ['witness', id, '--by', ACTOR, '--note', 'body A observing'],
    { GUILD_SESSION_ID: SESSION_A },
  );
  assert.equal(w1.status, 0, w1.stderr);

  // Body B witnesses second — same actor, new session.
  const w2 = runGate(
    root,
    ['witness', id, '--by', ACTOR, '--note', 'body B observing'],
    { GUILD_SESSION_ID: SESSION_B },
  );
  assert.equal(w2.status, 0, w2.stderr);

  const shown = runGate(root, ['show', id, '--format', 'json']);
  const record = JSON.parse(shown.stdout);

  // witness_sessions is keyed by actor; the latest body's session
  // overwrites the previous one (single-value map, not append-only).
  // Trade-off pinned: the substrate carries only one session per
  // witnessing actor; multi-body history is not preserved here.
  assert.equal(
    record.witness_sessions?.[ACTOR],
    SESSION_B,
    `witness_sessions[${ACTOR}] should be SESSION_B (latest); got: ${JSON.stringify(record.witness_sessions)}`,
  );

  // The latest note is also retained (mirrors witness_sessions
  // overwrite semantics) — both maps reflect "current body of the
  // actor," not "history of bodies."
  assert.equal(
    record.witness_notes?.[ACTOR],
    'body B observing',
    `witness_notes[${ACTOR}] should be the latest; got: ${JSON.stringify(record.witness_notes)}`,
  );
});

test('S2: malformed GUILD_SESSION_ID surfaces a notice, does not silently drop', (t) => {
  const { root, cleanup } = bootstrap({ members: [ACTOR] });
  t.after(cleanup);

  // A capital-letter or whitespace-bearing session_id violates
  // SESSION_ID_RE (`/^[a-z0-9][a-z0-9_:.-]{0,63}$/`). resolveGuildSessionId
  // emits a `notice:` on stderr and proceeds with the session
  // unstamped — the verb does NOT crash, but the operator can see
  // the value was rejected.
  const r = runGate(
    root,
    [
      'request',
      '--from', ACTOR,
      '--executors', ACTOR,
      '--action', 'malformed session smoke',
      '--reason', 'verify notice on bad GUILD_SESSION_ID',
    ],
    { GUILD_SESSION_ID: 'Has Spaces And Caps' },
  );
  assert.equal(r.status, 0, `request itself should succeed: ${r.stderr}`);
  assert.match(
    r.stderr,
    /GUILD_SESSION_ID.*does not match/,
    `stderr should carry the notice; got: ${r.stderr}`,
  );

  const id = extractRequestId(r.stdout + r.stderr);
  const shown = runGate(root, ['show', id, '--format', 'json']);
  const record = JSON.parse(shown.stdout);

  // opened_by_session should be absent (or null) — malformed value
  // is dropped, not preserved.
  assert.ok(
    record.opened_by_session === undefined || record.opened_by_session === null,
    `malformed session_id should not be stamped; got: ${record.opened_by_session}`,
  );
});
