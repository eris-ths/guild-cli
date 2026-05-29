import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';
import {
  GATE,
  bootstrap,
  runGate,
  escapeRegex,
  bootstrapWithMembers,
  registerMember,
  makeRequestWithTarget,
  makeRequestSessioned,
} from './_bootHelpers.js';

// active_overlapping_targets — cross-session race surface (#234).
//
// Surfaces active (pending|approved|executing) requests that share
// the same `target` so a booting agent sees "someone else is on
// it" before pre-empting. Phase 1: detection + warning, no refuse.
// Refuse-on-create lives with #227 (swarm profile epic).

test('gate boot: active_overlapping_targets surfaces two pending requests on the same target', () => {
  const { root, cleanup } = bootstrap();
  try {
    registerMember(root, 'leysia');
    const id1 = makeRequestWithTarget(root, 'alice', 'work A', 'data/guild/templates');
    const id2 = makeRequestWithTarget(root, 'leysia', 'work B', 'data/guild/templates');

    const { stdout } = runGate(root, ['boot']);
    const payload = JSON.parse(stdout);
    assert.equal(Array.isArray(payload.active_overlapping_targets), true);
    assert.equal(payload.active_overlapping_targets.length, 1);
    const entry = payload.active_overlapping_targets[0];
    assert.equal(entry.target, 'data/guild/templates');
    assert.equal(entry.requests.length, 2);
    // Sorted by id ascending — deterministic across boots.
    assert.deepEqual(
      entry.requests.map((r: { id: string }) => r.id),
      [id1, id2].sort(),
    );
    // Each entry carries state + executors[]. claimed_by is omitted
    // for unclaimed waves (omit-when-undefined convention).
    for (const r of entry.requests) {
      assert.ok(['pending', 'approved', 'executing'].includes(r.state));
      assert.ok(Array.isArray(r.executors));
      assert.equal('claimed_by' in r, false);
    }
  } finally {
    cleanup();
  }
});

test('gate boot: active_overlapping_targets is empty when targets differ', () => {
  const { root, cleanup } = bootstrap();
  try {
    registerMember(root, 'leysia');
    makeRequestWithTarget(root, 'alice', 'work A', 'src/foo');
    makeRequestWithTarget(root, 'leysia', 'work B', 'src/bar');

    const { stdout } = runGate(root, ['boot']);
    const payload = JSON.parse(stdout);
    assert.deepEqual(payload.active_overlapping_targets, []);
  } finally {
    cleanup();
  }
});

test('gate boot: active_overlapping_targets ignores requests with no target', () => {
  // Two requests, both untargeted → no group key → no overlap.
  // Untargeted overlap is not a coordination signal (the freeform
  // target is the only handle for "same wave").
  const { root, cleanup } = bootstrap();
  try {
    registerMember(root, 'leysia');
    const r1 = spawnSync(
      process.execPath,
      [GATE, 'request', '--from', 'alice', '--action', 'a', '--reason', 'r', '--format', 'json'],
      { cwd: root, env: { ...process.env }, encoding: 'utf8' },
    );
    assert.equal(r1.status, 0, r1.stderr);
    const r2 = spawnSync(
      process.execPath,
      [GATE, 'request', '--from', 'leysia', '--action', 'b', '--reason', 'r', '--format', 'json'],
      { cwd: root, env: { ...process.env }, encoding: 'utf8' },
    );
    assert.equal(r2.status, 0, r2.stderr);

    const { stdout } = runGate(root, ['boot']);
    const payload = JSON.parse(stdout);
    assert.deepEqual(payload.active_overlapping_targets, []);
  } finally {
    cleanup();
  }
});

test('gate boot: active_overlapping_targets carries claim_held marker for claimed wave', () => {
  const { root, cleanup } = bootstrap();
  try {
    // Overlap text-mode rendering is profile=swarm only (#323).
    writeFileSync(
      join(root, 'guild.config.yaml'),
      'content_root: .\nhost_names: [human]\nprofile: swarm\n',
    );
    registerMember(root, 'leysia');
    // Use --executor to populate the executors[] slot the surface
    // renders (matching the issue's example output shape, which
    // names the executor next to the id).
    const r1 = spawnSync(
      process.execPath,
      [
        GATE, 'request',
        '--from', 'alice',
        '--executors', 'alice',
        '--action', 'work A',
        '--reason', 'overlap test',
        '--target', 'shared/path',
        '--format', 'json',
      ],
      { cwd: root, env: { ...process.env }, encoding: 'utf8' },
    );
    assert.equal(r1.status, 0, r1.stderr);
    const id1 = JSON.parse(r1.stdout).id;
    const r2 = spawnSync(
      process.execPath,
      [
        GATE, 'request',
        '--from', 'leysia',
        '--executors', 'leysia',
        '--action', 'work B',
        '--reason', 'overlap test',
        '--target', 'shared/path',
        '--format', 'json',
      ],
      { cwd: root, env: { ...process.env }, encoding: 'utf8' },
    );
    assert.equal(r2.status, 0, r2.stderr);

    // Stake an exclusive claim on the first request.
    const claim = runGate(root, ['claim', id1, '--by', 'alice']);
    assert.equal(claim.status, 0);

    const { stdout } = runGate(root, ['boot']);
    const payload = JSON.parse(stdout);
    const entry = payload.active_overlapping_targets[0];
    const claimed = entry.requests.find((r: { id: string }) => r.id === id1);
    assert.equal(claimed.claimed_by, 'alice');
    // Text mode renders the marker too (`claim_held` flag).
    const t = runGate(root, ['boot', '--format', 'text']);
    assert.match(t.stdout, /active waves with overlapping target:/);
    assert.match(t.stdout, new RegExp(`${id1} \\(alice, pending, claim_held\\)`));
    assert.match(t.stdout, /target: shared\/path/);
    assert.match(t.stdout, /coordinate via .gate witness/);
  } finally {
    cleanup();
  }
});

test('gate boot: active_overlapping_targets text section is omitted when no overlap', () => {
  // Voice budget — fresh roots / single-wave roots should not see
  // the warning header line. Empty array is a JSON contract; text
  // mode silences entirely.
  const { root, cleanup } = bootstrap();
  try {
    const t = runGate(root, ['boot', '--format', 'text']);
    assert.equal(t.status, 0);
    assert.doesNotMatch(t.stdout, /active waves with overlapping target/);
  } finally {
    cleanup();
  }
});

// ---- Slice 4 (#249): same-actor parallel-session detection ---------


test('gate boot: overlap requests carry opened_by_session when stamped (#249 slice 4)', () => {
  const { root, cleanup } = bootstrap();
  try {
    makeRequestSessioned(root, 'alice', 'work A', 'src/foo', 'alice-tmux-1');
    makeRequestSessioned(root, 'alice', 'work B', 'src/foo', 'alice-tmux-1');

    const { stdout } = runGate(root, ['boot']);
    const payload = JSON.parse(stdout);
    const entry = payload.active_overlapping_targets[0];
    assert.equal(entry.requests.length, 2);
    for (const r of entry.requests) {
      assert.equal(r.opened_by_session, 'alice-tmux-1');
    }
  } finally {
    cleanup();
  }
});

test('gate boot: parallel_session_authors flags actor with two sessions on same target (#249 slice 4)', () => {
  const { root, cleanup } = bootstrap();
  try {
    // Same author (alice), same target, two distinct sessions — the
    // self-race shape the slice exists to surface.
    makeRequestSessioned(root, 'alice', 'work A', 'src/foo', 'alice-tmux-1');
    makeRequestSessioned(root, 'alice', 'work B', 'src/foo', 'alice-tmux-2');

    const { stdout } = runGate(root, ['boot']);
    const payload = JSON.parse(stdout);
    const entry = payload.active_overlapping_targets[0];
    assert.deepEqual(entry.parallel_session_authors, {
      alice: ['alice-tmux-1', 'alice-tmux-2'],
    });
  } finally {
    cleanup();
  }
});

test('gate boot: parallel_session_authors omitted when sessions match (#249 slice 4)', () => {
  // Same author, same target, IDENTICAL session — that's not a
  // self-race (the actor knows about both records). The map must
  // stay absent so the "warn-on-divergence" contract holds.
  const { root, cleanup } = bootstrap();
  try {
    makeRequestSessioned(root, 'alice', 'work A', 'src/foo', 'alice-tmux-1');
    makeRequestSessioned(root, 'alice', 'work B', 'src/foo', 'alice-tmux-1');

    const { stdout } = runGate(root, ['boot']);
    const payload = JSON.parse(stdout);
    const entry = payload.active_overlapping_targets[0];
    assert.equal(
      'parallel_session_authors' in entry,
      false,
      'identical sessions are not a self-race',
    );
  } finally {
    cleanup();
  }
});

test('gate boot: parallel_session_authors omitted when only one record stamped (#249 slice 4)', () => {
  // One stamped, one unstamped — provenance unknown for the second
  // record. Detection requires ≥2 of the actor's records to BOTH
  // carry sessions AND those values to diverge. Mixed pre/post-#249
  // groups should not falsely flag.
  const { root, cleanup } = bootstrap();
  try {
    makeRequestSessioned(root, 'alice', 'work A', 'src/foo', 'alice-tmux-1');
    makeRequestWithTarget(root, 'alice', 'work B', 'src/foo'); // no GUILD_SESSION_ID

    const { stdout } = runGate(root, ['boot']);
    const payload = JSON.parse(stdout);
    const entry = payload.active_overlapping_targets[0];
    assert.equal(
      'parallel_session_authors' in entry,
      false,
      'one stamped + one unstamped is not enough to prove divergence',
    );
  } finally {
    cleanup();
  }
});

test('gate boot: different actors with different sessions do NOT flag (#249 slice 4)', () => {
  // alice from session A, leysia from session B → genuine cross-
  // session overlap (the original #234 surface), but NOT a
  // SAME-actor parallel-session race. Only flag when a single
  // actor's authorship splits.
  const { root, cleanup } = bootstrap();
  try {
    registerMember(root, 'leysia');
    makeRequestSessioned(root, 'alice', 'work A', 'src/foo', 'alice-tmux-1');
    makeRequestSessioned(root, 'leysia', 'work B', 'src/foo', 'leysia-tmux-1');

    const { stdout } = runGate(root, ['boot']);
    const payload = JSON.parse(stdout);
    const entry = payload.active_overlapping_targets[0];
    assert.equal(
      'parallel_session_authors' in entry,
      false,
      'different actors authoring is not a self-race',
    );
  } finally {
    cleanup();
  }
});

test('gate boot text: parallel-session warning lands under overlap section (#249 slice 4)', () => {
  const { root, cleanup } = bootstrap();
  try {
    // Overlap text-mode rendering (and the parallel-session warn it
    // hangs off) is profile=swarm only (#323).
    writeFileSync(
      join(root, 'guild.config.yaml'),
      'content_root: .\nhost_names: [human]\nprofile: swarm\n',
    );
    makeRequestSessioned(root, 'alice', 'work A', 'src/foo', 'alice-tmux-1');
    makeRequestSessioned(root, 'alice', 'work B', 'src/foo', 'alice-tmux-2');

    const t = runGate(root, ['boot', '--format', 'text']);
    assert.equal(t.status, 0);
    assert.match(t.stdout, /active waves with overlapping target:/);
    // The per-request line carries the bracket-tagged session.
    assert.match(t.stdout, /\[session=alice-tmux-1\]/);
    assert.match(t.stdout, /\[session=alice-tmux-2\]/);
    // The dedicated warning line names the actor and both sessions.
    assert.match(
      t.stdout,
      /⚠ same-actor parallel sessions: alice on target "src\/foo" \(sessions: alice-tmux-1, alice-tmux-2\)/,
    );
  } finally {
    cleanup();
  }
});
