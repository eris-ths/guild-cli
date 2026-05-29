// AX — AI-experience affordances.
//
// These tests pin agent-facing behaviors that a tool layer depends on:
//   - boot.suggested_next reaches beyond onboarding into the live
//     workflow (executing-by-me / unreviewed-mine / approved-for-me /
//     pending-as-executor) so an agent's orientation call returns
//     a single next verb to dispatch.
//   - --format json errors arrive on stderr as a parseable envelope
//     alongside the human-readable `error: …` line.
//   - board --format json echoes any implicit scoping so a JSON
//     consumer can tell "empty because filtered" from "empty because
//     nothing in flight".
//   - show --fields trims the payload for hot-loop callers.
//   - --dry-run previews state transitions without persisting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, runGate, rid } from './_axHelpers.js';
// ── boot.suggested_next: workflow-stage routing ───────────────────

test('boot.suggested_next: pending-as-executor → approve', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.suggested_next?.verb, 'approve');
    assert.equal(payload.suggested_next?.args?.id, rid(1));
    assert.equal(payload.suggested_next?.args?.by, 'bob');
  } finally {
    cleanup();
  }
});

test('boot.suggested_next: approved-for-me → execute', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, ['approve', rid(1), '--by', 'alice']);
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.suggested_next?.verb, 'execute');
    assert.equal(payload.suggested_next?.args?.id, rid(1));
  } finally {
    cleanup();
  }
});

test('boot.suggested_next: executing-by-me → complete (takes priority)', () => {
  // If I'm mid-flight on request A and also have approved-for-me B
  // waiting, orient me back to A first — "finish what's in your hand".
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'A', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, ['approve', rid(1), '--by', 'alice']);
    runGate(root, ['execute', rid(1), '--by', 'bob']);
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'B', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, ['approve', rid(2), '--by', 'alice']);
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.suggested_next?.verb, 'complete');
    assert.equal(payload.suggested_next?.args?.id, rid(1));
  } finally {
    cleanup();
  }
});

test('boot.suggested_next: unreviewed-mine → review', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r', '--auto-review', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.suggested_next?.verb, 'review');
    assert.equal(payload.suggested_next?.args?.id, rid(1));
    assert.equal(payload.suggested_next?.args?.lense, 'devil');
  } finally {
    cleanup();
  }
});

// ── --format json: structured error envelope ─────────────────────

test('--format json: errors emit a JSON envelope on stderr', () => {
  const { root, cleanup } = bootstrap();
  try {
    // Complete an id that doesn't exist → DomainError.
    const { stdout, stderr, status } = runGate(
      root,
      ['approve', '9999-99-99-0001', '--by', 'alice', '--format', 'json'],
    );
    assert.equal(status, 1);
    assert.equal(stdout, '');
    // First line of stderr is the JSON envelope; the second is the
    // human-readable `error: …` line kept for terminal readers.
    const firstLine = stderr.split('\n').find((l) => l.trim().startsWith('{'));
    assert.ok(firstLine, 'expected a JSON envelope line on stderr');
    const payload = JSON.parse(firstLine!);
    assert.equal(payload.ok, false);
    assert.equal(typeof payload.error?.message, 'string');
    assert.match(payload.error.message, /Request not found/);
  } finally {
    cleanup();
  }
});

test('--format json not set: errors stay text-only (no JSON leak)', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stderr, status } = runGate(
      root,
      ['approve', '9999-99-99-0001', '--by', 'alice'],
    );
    assert.equal(status, 1);
    // stderr has the `error:` line and nothing else — no JSON envelope
    // should leak into non-json mode.
    assert.equal(/\{\s*"ok"/.test(stderr), false);
    assert.match(stderr, /^error: /);
  } finally {
    cleanup();
  }
});

// ── board --format json: filter meta ─────────────────────────────

test('board --format json: _meta.filter echoes GUILD_ACTOR scoping', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['board', '--format', 'json'], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    assert.deepEqual(payload._meta?.filter, { actor: 'alice', source: 'GUILD_ACTOR' });
  } finally {
    cleanup();
  }
});

test('board --format json: _meta.filter echoes --for source when explicit', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['board', '--format', 'json', '--for', 'alice']);
    const payload = JSON.parse(stdout);
    assert.deepEqual(payload._meta?.filter, { actor: 'alice', source: '--for' });
  } finally {
    cleanup();
  }
});

test('board --format json: no _meta when unfiltered (global view)', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['board', '--format', 'json']);
    const payload = JSON.parse(stdout);
    assert.equal('_meta' in payload, false);
  } finally {
    cleanup();
  }
});

// ── gate show --fields ───────────────────────────────────────────

test('show --fields: trims JSON to requested keys', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    // Issue #230: the on-record / wire-form key is now `executors`
    // (array). The single-executor input above hydrates as a one-
    // element list; the legacy `executor` key is no longer emitted
    // by toJSON. Tool wirings asking for the new key get the array.
    const { stdout } = runGate(root, ['show', rid(1), '--fields', 'state,executors']);
    const payload = JSON.parse(stdout);
    assert.deepEqual(Object.keys(payload).sort(), ['executors', 'state']);
    assert.equal(payload.state, 'pending');
    // Issue #294: structured form for freshly-created records.
    assert.deepEqual(payload.executors, [{ name: 'bob', status: 'pending' }]);
  } finally {
    cleanup();
  }
});

test('show --fields: unknown keys silently dropped (not errored)', () => {
  // "Silently dropped" is an intentional agent affordance: tool layers
  // may enumerate an optimistic field set; we don't want speculative
  // keys to take down the whole call.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['show', rid(1), '--fields', 'state,not_a_field']);
    const payload = JSON.parse(stdout);
    assert.deepEqual(Object.keys(payload), ['state']);
  } finally {
    cleanup();
  }
});

// ── suggested_next advisory semantics ───────────────────────────

test('suggest --format text: advisory footer goes to stderr, stdout stays composable', () => {
  // Humans scanning the terminal see the reminder that suggested_next
  // is a heuristic. But `$(gate suggest --format text)` captures
  // stdout, which must stay clean for shell composition.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout, stderr } = runGate(
      root,
      ['suggest', '--format', 'text'],
      { GUILD_ACTOR: 'bob' },
    );
    assert.match(stderr, /advisory/);
    assert.equal(/advisory/.test(stdout), false);
    // Stdout still carries the actionable two-line output.
    assert.match(stdout, /→ approve/);
  } finally {
    cleanup();
  }
});

test('schema: suggested_next descriptions name the "advisory, not directive" semantic', () => {
  // This is the durable surface — tool layers reading the schema
  // get the semantic without parsing the runtime output. Easier to
  // wire correctly once than to discover through experimentation.
  const { root, cleanup } = bootstrap();
  try {
    const bootSchema = JSON.parse(
      runGate(root, ['schema', '--verb', 'boot', '--format', 'json']).stdout,
    );
    const bootSN =
      bootSchema.verbs[0].output.properties.suggested_next.description;
    assert.ok(typeof bootSN === 'string');
    assert.match(bootSN, /[Aa]dvisory/);
    assert.match(bootSN, /not a directive|NOT a directive/);

    const suggestSchema = JSON.parse(
      runGate(root, ['schema', '--verb', 'suggest', '--format', 'json']).stdout,
    );
    const suggestSN =
      suggestSchema.verbs[0].output.properties.suggested_next.description;
    assert.ok(typeof suggestSN === 'string');
    assert.match(suggestSN, /[Aa]dvisory/);
    assert.match(suggestSN, /override/);
  } finally {
    cleanup();
  }
});

// ── thank integration: utterance stream & transcript fold-in ────

test('thank: appears in gate tail as a directional utterance', () => {
  // tail is the unified cross-actor stream. Thanks share the stream
  // with authored/review utterances so a reader scanning activity
  // sees the appreciation alongside the decisions.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, ['thank', 'bob', '--for', rid(1), '--reason', 'nice'], {
      GUILD_ACTOR: 'alice',
    });
    const { stdout } = runGate(root, ['tail']);
    assert.match(stdout, /thank alice → bob/);
    assert.match(stdout, /re: x/);
  } finally {
    cleanup();
  }
});

test('voices <name>: surfaces thanks in BOTH directions (given and received)', () => {
  // Reviews are one-sided (only `by` speaks). Thanks involve two
  // actors; voices matches either side so a voice's full
  // appreciation footprint — given AND received — is visible when
  // looking at them.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    // alice thanks bob (bob receives)
    runGate(root, ['thank', 'bob', '--for', rid(1), '--reason', 'a-to-b'], {
      GUILD_ACTOR: 'alice',
    });
    // bob thanks alice (bob gives)
    runGate(root, ['thank', 'alice', '--for', rid(1), '--reason', 'b-to-a'], {
      GUILD_ACTOR: 'bob',
    });
    const { stdout } = runGate(root, ['voices', 'bob', '--format', 'text']);
    // Both directions land in bob's stream.
    assert.match(stdout, /thank alice → bob/);
    assert.match(stdout, /thank bob → alice/);
    assert.match(stdout, /a-to-b/);
    assert.match(stdout, /b-to-a/);
  } finally {
    cleanup();
  }
});

test('voices: lense/verdict filters DO NOT surface thanks (reviews only)', () => {
  // thanks have no lense and no verdict. A lense-scoped query is
  // asking for reviews through that lense; including thanks would
  // be a category error.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, ['thank', 'bob', '--for', rid(1), '--reason', 'nice'], {
      GUILD_ACTOR: 'alice',
    });
    const { stdout } = runGate(
      root,
      ['voices', 'alice', '--format', 'text', '--lense', 'devil'],
    );
    assert.equal(/thank/.test(stdout), false);
    assert.match(stdout, /no utterances|reviews/);
  } finally {
    cleanup();
  }
});

test('transcript: thanks appear as their own prose paragraph + in summary', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, ['thank', 'bob', '--for', rid(1), '--reason', 'elegant'], {
      GUILD_ACTOR: 'alice',
    });
    const { stdout } = runGate(root, ['transcript', rid(1)]);
    assert.match(stdout, /Alice thanked bob/);
    assert.match(stdout, /elegant/);

    const jsonOut = runGate(root, ['transcript', rid(1), '--format', 'json']);
    const p = JSON.parse(jsonOut.stdout);
    assert.equal(p.summary.thank_count, 1);
  } finally {
    cleanup();
  }
});

// ── gate transcript: narrative arc of one request ───────────────

test('transcript: narrative prose names filer, action, executor, reviews', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      [
        'request', '--from', 'alice',
        '--action', 'refactor parser',
        '--reason', 'cut p99 latency',
        '--executors', 'bob',
        '--auto-review', 'alice',
      ],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, ['approve', rid(1), '--by', 'alice']);
    runGate(root, ['execute', rid(1), '--by', 'bob']);
    runGate(root, ['complete', rid(1), '--by', 'bob', '--note', 'landed in abc123']);
    runGate(
      root,
      ['review', rid(1), '--by', 'alice', '--lense', 'devil', '--verdict', 'ok', '--comment', 'LGTM'],
    );
    const { stdout } = runGate(root, ['transcript', rid(1)]);
    assert.match(stdout, /Alice filed/);
    assert.match(stdout, /refactor parser/);
    assert.match(stdout, /bob as executor/);
    // Slice-close re-phrase (#400-era polish + eris touch-feel
    // 2026-05-16 finding 4.4): single-executor `complete` shows up
    // as the slice closure, not as "moved it to executing" + "moved
    // it to completed". Cold reader sees the actor's terminal
    // judgement directly.
    assert.match(stdout, /Bob closed their slice as completed/);
    assert.match(stdout, /devil lense/);
    assert.match(stdout, /verdict of ok/);
    assert.match(stdout, /LGTM/);
    assert.match(stdout, /Final state: completed/);
  } finally {
    cleanup();
  }
});

test('transcript --format json: summary carries structured fields', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, ['approve', rid(1), '--by', 'alice']);
    runGate(root, ['execute', rid(1), '--by', 'bob']);
    runGate(root, ['complete', rid(1), '--by', 'bob']);
    const { stdout } = runGate(root, ['transcript', rid(1), '--format', 'json']);
    const p = JSON.parse(stdout);
    assert.equal(p.id, rid(1));
    assert.ok(typeof p.arc === 'string');
    assert.ok(p.arc.length > 50);
    assert.equal(p.summary.actor_count, 2);
    assert.deepEqual(p.summary.actors.sort(), ['alice', 'bob']);
    assert.equal(p.summary.final_state, 'completed');
    assert.equal(typeof p.summary.duration_ms, 'number');
  } finally {
    cleanup();
  }
});

test('transcript: self-loop arc surfaces as "carried out by X alone"', () => {
  // The textual echo of the self-loop-check plugin: one sentence in
  // the summary names the mono-actor pattern per-request.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['transcript', rid(1)]);
    assert.match(stdout, /carried out by alice alone/);
  } finally {
    cleanup();
  }
});

test('transcript: pending auto-review is named explicitly', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r', '--auto-review', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['transcript', rid(1)]);
    assert.match(stdout, /Auto-review is pending: bob/);
  } finally {
    cleanup();
  }
});

// ── gate show --plain: shell-friendly single-field output ────────

test('show --plain --fields <key>: emits raw value, no JSON quoting', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['show', rid(1), '--fields', 'state', '--plain']);
    assert.equal(stdout, 'pending\n');
  } finally {
    cleanup();
  }
});

test('show --plain: requires exactly one field', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r'],
      { GUILD_ACTOR: 'alice' },
    );
    const noFields = runGate(root, ['show', rid(1), '--plain']);
    assert.equal(noFields.status, 1);
    assert.match(noFields.stderr, /requires exactly one field/);
    const multi = runGate(root, ['show', rid(1), '--fields', 'state,from', '--plain']);
    assert.equal(multi.status, 1);
    assert.match(multi.stderr, /requires exactly one field/);
  } finally {
    cleanup();
  }
});

test('show --plain: missing field = empty stdout + exit 1 (shell-friendly)', () => {
  // `[ -z "$v" ]` should be a usable check for "field not present"
  // without the caller having to parse or differentiate error modes.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout, status } = runGate(
      root,
      ['show', rid(1), '--fields', 'not_a_field', '--plain'],
    );
    assert.equal(stdout, '');
    assert.equal(status, 1);
  } finally {
    cleanup();
  }
});

// ── --dry-run on state-transition verbs ──────────────────────────

test('approve --dry-run: emits preview envelope, does NOT persist', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout, status } = runGate(
      root,
      ['approve', rid(1), '--by', 'alice', '--dry-run'],
    );
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);
    assert.equal(payload.dry_run, true);
    assert.equal(payload.verb, 'approve');
    assert.deepEqual(payload.would_transition, { from: 'pending', to: 'approved' });
    assert.equal(payload.preview.state, 'approved');
    // After dry-run, the real record is still pending.
    const after = JSON.parse(
      runGate(root, ['show', rid(1), '--fields', 'state']).stdout,
    );
    assert.equal(after.state, 'pending');
  } finally {
    cleanup();
  }
});

test('review --dry-run: preview includes new review without persisting', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r'],
      { GUILD_ACTOR: 'alice' },
    );
    // Bare `--dry-run` followed by the positional comment `looks good`
    // works because `dry-run` is listed in KNOWN_BOOLEAN_FLAGS — the
    // parser won't speculatively consume the next token as the flag's
    // value. Before that fix this line needed `--dry-run=true`.
    const { stdout, status } = runGate(
      root,
      [
        'review', rid(1),
        '--by', 'bob',
        '--lense', 'devil',
        '--verdict', 'ok',
        '--dry-run',
        'looks good',
      ],
    );
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);
    assert.equal(payload.dry_run, true);
    assert.equal(payload.verb, 'review');
    // No state transition for review — envelope omits the field.
    assert.equal('would_transition' in payload, false);
    assert.equal(payload.preview.reviews.length, 1);
    // After dry-run, real reviews list is still empty.
    const after = JSON.parse(runGate(root, ['show', rid(1)]).stdout);
    assert.equal(after.reviews.length, 0);
  } finally {
    cleanup();
  }
});


// ── suggest text-mode footer: context-sensitivity ─────────────────

test('suggest --format text suppresses advisory footer for export verb', () => {
  // GUILD_ACTOR-unset bootstrap: suggest returns verb=export which is
  // a shell builtin used to set the env var, not a gate dispatch.
  // The "# advisory — override freely" footer applies to heuristic
  // gate verbs; pinning it onto an env-var bootstrap reads as
  // "you can ignore this", which is wrong — without GUILD_ACTOR the
  // agent stays anonymous. The footer is suppressed for export.
  const { root, cleanup } = bootstrap();
  try {
    const out = runGate(root, ["suggest", "--format", "text"]);
    assert.equal(out.status, 0);
    assert.match(out.stdout, /export GUILD_ACTOR/);
    // No advisory footer (which would land on stderr) for the
    // export case.
    assert.doesNotMatch(out.stderr, /advisory/);
  } finally {
    cleanup();
  }
});

test('suggest --format text keeps advisory footer for gate verbs', () => {
  // Regression: the footer should still appear when the suggestion
  // is a real gate dispatch (not export). Drives a request to
  // pending-as-executor so suggest returns a non-null gate verb.
  const { root, cleanup } = bootstrap();
  try {
    runGate(root, [
      "request",
      "--from", "alice",
      "--action", "do thing",
      "--reason", "r",
      "--executors", "bob",
    ], { GUILD_ACTOR: "alice" });
    const out = runGate(root, ["suggest", "--format", "text"], { GUILD_ACTOR: "bob" });
    assert.equal(out.status, 0);
    assert.match(out.stdout, /^→ approve/m);
    assert.match(out.stderr, /advisory — override freely/);
  } finally {
    cleanup();
  }
});
