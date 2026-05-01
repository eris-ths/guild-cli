// writeFormat.deriveSuggestedNext — state-machine → next-verb mapping.
//
// These tests pin the contract that agent orchestrators rely on: the
// verb returned for each state, and the explicit absence of a default
// verdict on review (so a lazy agent can't rubber-stamp).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSuggestedNext } from '../../src/interface/gate/handlers/writeFormat.js';
import { Request } from '../../src/domain/request/Request.js';
import { RequestId } from '../../src/domain/request/RequestId.js';
import { MemberName } from '../../src/domain/member/MemberName.js';
import { Review } from '../../src/domain/request/Review.js';
import { GuildConfig } from '../../src/infrastructure/config/GuildConfig.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function mkConfig(hosts: string[]): { cfg: GuildConfig; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-writeFormat-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    `content_root: .\nhost_names: [${hosts.join(', ')}]\n`,
  );
  const cfg = GuildConfig.load(root, () => {});
  return { cfg, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const d = new Date('2026-04-16T00:00:00Z');

test('pending with single host → approve suggested with host filled', () => {
  const { cfg, cleanup } = mkConfig(['human']);
  try {
    const r = Request.create({
      id: RequestId.generate(d, 1),
      from: 'alice',
      action: 'a',
      reason: 'r',
    });
    const s = deriveSuggestedNext(r, cfg);
    assert.equal(s?.verb, 'approve');
    assert.equal(s?.args['by'], 'human');
  } finally {
    cleanup();
  }
});

test('pending with multiple hosts → approve suggested WITHOUT `by` prefill', () => {
  // Silently nominating a single host would mask the operator choice.
  // Surface the list in `reason`, leave `by` to the caller.
  const { cfg, cleanup } = mkConfig(['alice', 'bob']);
  try {
    const r = Request.create({
      id: RequestId.generate(d, 1),
      from: 'alice',
      action: 'a',
      reason: 'r',
    });
    const s = deriveSuggestedNext(r, cfg);
    assert.equal(s?.verb, 'approve');
    assert.equal(s?.args['by'], undefined);
    assert.match(s!.reason, /alice, bob/);
  } finally {
    cleanup();
  }
});

test('pending with zero hosts → reason explains the gap', () => {
  const { cfg, cleanup } = mkConfig([]);
  try {
    const r = Request.create({
      id: RequestId.generate(d, 1),
      from: 'alice',
      action: 'a',
      reason: 'r',
    });
    const s = deriveSuggestedNext(r, cfg);
    assert.equal(s?.verb, 'approve');
    assert.match(s!.reason, /none are configured/i);
  } finally {
    cleanup();
  }
});

test('completed with auto-review not yet done → review suggested WITHOUT verdict default', () => {
  // The Two-Persona loop's whole point is that the reviewer must
  // actually review. Defaulting verdict to 'ok' would let an agent
  // blindly chain the suggestion into an approving review. Reject.
  const { cfg, cleanup } = mkConfig(['human']);
  try {
    const r = Request.create({
      id: RequestId.generate(d, 1),
      from: 'alice',
      action: 'a',
      reason: 'r',
      executor: 'alice',
      autoReview: 'bob',
    });
    r.approve(MemberName.of('human'));
    r.execute(MemberName.of('alice'));
    r.complete(MemberName.of('alice'));
    const s = deriveSuggestedNext(r, cfg);
    assert.equal(s?.verb, 'review');
    assert.equal(s?.args['by'], 'bob');
    assert.equal(s?.args['lense'], 'devil');
    assert.equal(
      s?.args['verdict'],
      undefined,
      'verdict must NOT be pre-filled; the reviewer has to decide',
    );
    assert.match(s!.reason, /after actually reading/i);
  } finally {
    cleanup();
  }
});

test('completed with auto-review already done → suggested_next is null', () => {
  const { cfg, cleanup } = mkConfig(['human']);
  try {
    const r = Request.create({
      id: RequestId.generate(d, 1),
      from: 'alice',
      action: 'a',
      reason: 'r',
      executor: 'alice',
      autoReview: 'bob',
    });
    r.approve(MemberName.of('human'));
    r.execute(MemberName.of('alice'));
    r.complete(MemberName.of('alice'));
    r.addReview(
      Review.create({ by: 'bob', lense: 'devil', verdict: 'ok', comment: 'lgtm' }),
    );
    assert.equal(deriveSuggestedNext(r, cfg), null);
  } finally {
    cleanup();
  }
});

test('completed without auto-review → suggested_next is null', () => {
  const { cfg, cleanup } = mkConfig(['human']);
  try {
    const r = Request.create({
      id: RequestId.generate(d, 1),
      from: 'alice',
      action: 'a',
      reason: 'r',
    });
    r.approve(MemberName.of('human'));
    r.execute(MemberName.of('alice'));
    r.complete(MemberName.of('alice'));
    assert.equal(deriveSuggestedNext(r, cfg), null);
  } finally {
    cleanup();
  }
});

test('actor_resolved is true when GUILD_ACTOR matches suggested args.by', () => {
  const { cfg, cleanup } = mkConfig(['human']);
  try {
    const r = Request.create({
      id: RequestId.generate(d, 1),
      from: 'alice',
      action: 'a',
      reason: 'r',
      executor: 'alice',
    });
    r.approve(MemberName.of('human'));
    // approved → execute, args.by=alice
    const sAsAlice = deriveSuggestedNext(r, cfg, 'alice');
    assert.equal(sAsAlice?.actor_resolved, true);
    const sAsBob = deriveSuggestedNext(r, cfg, 'bob');
    assert.equal(sAsBob?.actor_resolved, false);
  } finally {
    cleanup();
  }
});

test('actor_resolved is true when args has no by (caller-agnostic)', () => {
  // Multiple hosts → suggested_next has no `by` (per existing
  // behavior). actor_resolved falls back to true because there's
  // no actor constraint to mismatch against.
  const { cfg, cleanup } = mkConfig(['alice', 'bob']);
  try {
    const r = Request.create({
      id: RequestId.generate(d, 1),
      from: 'alice',
      action: 'a',
      reason: 'r',
    });
    const s = deriveSuggestedNext(r, cfg, 'someone');
    assert.equal(s?.args['by'], undefined);
    assert.equal(s?.actor_resolved, true);
  } finally {
    cleanup();
  }
});

test('completed with concern review and no auto-review → chain advisory', () => {
  // 3.A: when a completed request carries a concern verdict, the
  // suggested_next becomes a `chain` walk (read-only) so the reader
  // can see what (if anything) already references it. The `reason`
  // names "leaving as-is, conversing it out, or letting it fade —
  // all first-class" so absence-of-action stays a valid choice.
  const { cfg, cleanup } = mkConfig(['human']);
  try {
    const r = Request.create({
      id: RequestId.generate(d, 1),
      from: 'alice',
      action: 'a',
      reason: 'r',
    });
    r.approve(MemberName.of('human'));
    r.execute(MemberName.of('alice'));
    r.complete(MemberName.of('alice'));
    r.addReview(
      Review.create({
        by: 'bob',
        lense: 'devil',
        verdict: 'concern',
        comment: 'subtle issue',
      }),
    );
    const s = deriveSuggestedNext(r, cfg);
    assert.equal(s?.verb, 'chain');
    assert.match(s!.reason, /concern recorded/i);
    assert.match(s!.reason, /leaving as-is/i);
    assert.match(s!.reason, /first-class/i);
  } finally {
    cleanup();
  }
});

test('completed with auto-review done AND concern present → chain advisory', () => {
  // Auto-review fired but its verdict was concern. The advisory
  // (chain walk + first-class options) replaces the otherwise-null
  // suggested_next, so the concern doesn't go quiet.
  const { cfg, cleanup } = mkConfig(['human']);
  try {
    const r = Request.create({
      id: RequestId.generate(d, 1),
      from: 'alice',
      action: 'a',
      reason: 'r',
      executor: 'alice',
      autoReview: 'bob',
    });
    r.approve(MemberName.of('human'));
    r.execute(MemberName.of('alice'));
    r.complete(MemberName.of('alice'));
    r.addReview(
      Review.create({
        by: 'bob',
        lense: 'devil',
        verdict: 'concern',
        comment: 'careful',
      }),
    );
    const s = deriveSuggestedNext(r, cfg);
    assert.equal(s?.verb, 'chain');
    assert.match(s!.reason, /first-class/i);
  } finally {
    cleanup();
  }
});

test('completed with auto-review done AND ok verdict → still null', () => {
  // The advisory only fires for concern/reject. A clean ok review
  // closes the arc without further suggestion (existing behavior).
  const { cfg, cleanup } = mkConfig(['human']);
  try {
    const r = Request.create({
      id: RequestId.generate(d, 1),
      from: 'alice',
      action: 'a',
      reason: 'r',
      executor: 'alice',
      autoReview: 'bob',
    });
    r.approve(MemberName.of('human'));
    r.execute(MemberName.of('alice'));
    r.complete(MemberName.of('alice'));
    r.addReview(
      Review.create({ by: 'bob', lense: 'devil', verdict: 'ok', comment: 'lgtm' }),
    );
    assert.equal(deriveSuggestedNext(r, cfg), null);
  } finally {
    cleanup();
  }
});

test('terminal states (denied/failed) return null', () => {
  const { cfg, cleanup } = mkConfig(['human']);
  try {
    const denied = Request.create({
      id: RequestId.generate(d, 1),
      from: 'alice',
      action: 'a',
      reason: 'r',
    });
    denied.deny(MemberName.of('human'), 'nope');
    assert.equal(deriveSuggestedNext(denied, cfg), null);

    const failed = Request.create({
      id: RequestId.generate(d, 2),
      from: 'alice',
      action: 'a',
      reason: 'r',
      executor: 'alice',
    });
    failed.approve(MemberName.of('human'));
    failed.execute(MemberName.of('alice'));
    failed.fail(MemberName.of('alice'), 'broken');
    assert.equal(deriveSuggestedNext(failed, cfg), null);
  } finally {
    cleanup();
  }
});
