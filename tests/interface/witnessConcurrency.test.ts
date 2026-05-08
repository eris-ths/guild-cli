// True-concurrency coverage for witness / unwitness / claim
// (issue #244 Devil REJECT root-cause regression suite).
//
// The pre-fix bug:
//   - claim, witness, unwitness mutate state without appending to
//     status_log / reviews / thanks. The optimistic-lock token was
//     defined as the sum of those three array lengths, so two
//     concurrent witnesses BOTH read the same length, both passed
//     the lock check, and last-writer-wins atomic rename silently
//     dropped one of the two writes.
//   - Devil's repro: 4 parallel witnesses → only 1 in the array.
//                    parallel unwitness → loser silently dropped.
//                    claim ⊥ witness mixed → both lost intermittently.
//
// The fix:
//   - mutation_seq: number monotonic counter on Request, bumped on
//     every real claim/witness/unwitness mutation (and per cleared
//     actor on terminal auto-reset). computeVersion adds it. The
//     repository's optimistic-lock check now sees the bump and
//     throws RequestVersionConflict on a true race.
//   - The use case (RequestUseCases.{claim,witness,unwitness}) wraps
//     the load → mutate → save in a bounded retry on
//     RequestVersionConflict. Domain verbs are idempotent on no-op
//     and refuse on genuine conflict, so retry is safe.
//
// Why this lives below the gate CLI layer:
//   `withGuildLock` (#155) serialises CLI writes at the file lock,
//   so two concurrent CLI invocations on the same content root never
//   actually race save() — the loser exits with lock_busy. The
//   optimistic-lock + mutation_seq fix is defence-in-depth: it
//   protects scenarios that bypass the file lock (in-process batch
//   ops, future lock-free fast paths, lock metadata corruption,
//   plus the lock_busy-retry post-release window). The tests below
//   exercise the save() race directly so the bug is reproducible.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GuildConfig } from '../../src/infrastructure/config/GuildConfig.js';
import { YamlRequestRepository } from '../../src/infrastructure/persistence/YamlRequestRepository.js';
import { Request } from '../../src/domain/request/Request.js';
import { RequestId } from '../../src/domain/request/RequestId.js';
import { MemberName } from '../../src/domain/member/MemberName.js';
import {
  RequestVersionConflict,
} from '../../src/application/ports/RequestRepository.js';

interface Harness {
  root: string;
  repo: YamlRequestRepository;
  cleanup: () => void;
}

function bootstrap(): Harness {
  const root = mkdtempSync(join(tmpdir(), 'witness-conc-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  const cfg = GuildConfig.load(root, () => {});
  const repo = new YamlRequestRepository(cfg);
  return { root, repo, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function newRequestOnDisk(
  repo: YamlRequestRepository,
  seq: number,
): Promise<string> {
  const id = RequestId.generate(new Date('2026-05-08T00:00:00Z'), seq);
  const r = Request.create({ id, from: 'alice', action: 'a', reason: 'r' });
  await repo.saveNew(r);
  return id.value;
}

// Mirrors the use-case retry helper exactly: load → mutate → save,
// retry on RequestVersionConflict. Inlined here so the test itself
// drives the race (separate concurrent callers each running this loop)
// without coupling to RequestUseCases construction (which depends on
// member/inbox repos this test doesn't need).
async function applyMutationWithRetry(
  repo: YamlRequestRepository,
  id: string,
  mutate: (r: Request) => boolean /* true if the mutation should save */,
): Promise<void> {
  const maxAttempts = 16;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const r = await repo.findById(RequestId.of(id));
      if (!r) throw new Error(`Request not found: ${id}`);
      const shouldSave = mutate(r);
      if (shouldSave) await repo.save(r);
      return;
    } catch (e) {
      if (!(e instanceof RequestVersionConflict)) throw e;
      lastErr = e;
      // Tiny stagger to spread contention.
      await new Promise((res) => setTimeout(res, 2 * (attempt + 1)));
    }
  }
  throw lastErr;
}

test('concurrent witness: 4 parallel witnesses all land (no silent drop)', async (t) => {
  const h = bootstrap();
  t.after(h.cleanup);
  const id = await newRequestOnDisk(h.repo, 1);

  // Pre-fix: each loaded copy saw the same status_log+reviews+thanks
  // length and the optimistic-lock check passed every save; last-
  // writer-wins kept exactly one in the array. Post-fix: the first
  // save bumps mutation_seq and the next three see
  // RequestVersionConflict — the retry helper reloads and re-applies.
  await Promise.all(
    ['a', 'b', 'c', 'd'].map((name) =>
      applyMutationWithRetry(h.repo, id, (r) => {
        const before = r.witnesses.length;
        r.witness(MemberName.of(name));
        return r.witnesses.length !== before;
      }),
    ),
  );

  const final = (await h.repo.findById(RequestId.of(id)))!;
  const witnesses = final.witnesses.map((m) => m.value).sort();
  assert.deepEqual(
    witnesses,
    ['a', 'b', 'c', 'd'],
    'all 4 concurrent witnesses must coexist (the #244 core promise)',
  );
});

test('concurrent unwitness: two actors removing themselves both reflect', async (t) => {
  const h = bootstrap();
  t.after(h.cleanup);
  const id = await newRequestOnDisk(h.repo, 2);

  // Pre-state (sequential): a, b, c all witnessing.
  for (const name of ['a', 'b', 'c']) {
    await applyMutationWithRetry(h.repo, id, (r) => {
      r.witness(MemberName.of(name));
      return true;
    });
  }

  // Concurrent unwitness: b and c each remove themselves. Pre-fix
  // both pass the length-only lock and last-writer-wins drops one
  // removal — final array would be {a, b} or {a, c} instead of {a}.
  await Promise.all(
    ['b', 'c'].map((name) =>
      applyMutationWithRetry(h.repo, id, (r) => {
        r.unwitness(MemberName.of(name));
        return true;
      }),
    ),
  );

  const final = (await h.repo.findById(RequestId.of(id)))!;
  assert.deepEqual(
    final.witnesses.map((m) => m.value),
    ['a'],
    'both unwitness calls must land — only "a" should remain',
  );
});

test('concurrent claim ⊥ witness: claim and witness coexist (#244 core promise)', async (t) => {
  const h = bootstrap();
  t.after(h.cleanup);
  const id = await newRequestOnDisk(h.repo, 3);

  // Mixed race: one claim + three witnesses, all in parallel. The
  // #244 core promise is "witness coexists with any claim" — pre-fix
  // any of these could vanish under last-writer-wins on the same
  // length-version token.
  await Promise.all([
    applyMutationWithRetry(h.repo, id, (r) => {
      const before = r.claimedBy?.value;
      r.claim(MemberName.of('claimant'), new Date().toISOString());
      return r.claimedBy?.value !== before;
    }),
    applyMutationWithRetry(h.repo, id, (r) => {
      const before = r.witnesses.length;
      r.witness(MemberName.of('w1'));
      return r.witnesses.length !== before;
    }),
    applyMutationWithRetry(h.repo, id, (r) => {
      const before = r.witnesses.length;
      r.witness(MemberName.of('w2'));
      return r.witnesses.length !== before;
    }),
    applyMutationWithRetry(h.repo, id, (r) => {
      const before = r.witnesses.length;
      r.witness(MemberName.of('w3'));
      return r.witnesses.length !== before;
    }),
  ]);

  const final = (await h.repo.findById(RequestId.of(id)))!;
  assert.equal(
    final.claimedBy?.value,
    'claimant',
    'claim must survive concurrent witness writes',
  );
  const witnesses = final.witnesses.map((m) => m.value).sort();
  assert.deepEqual(
    witnesses,
    ['w1', 'w2', 'w3'],
    'all witnesses must coexist with the claim — #244 core promise',
  );
});

test('concurrent claim: two different actors race — exactly one wins, other refuses', async (t) => {
  const h = bootstrap();
  t.after(h.cleanup);
  const id = await newRequestOnDisk(h.repo, 4);

  // Both a and b try to claim simultaneously. claim is exclusive —
  // exactly one must succeed; the other must surface the domain
  // conflict ("already claimed by") rather than a silent overwrite.
  // Pre-fix the version-lock could pass both, and last-writer-wins
  // would seat whichever raced last with the first claim's record
  // silently overwritten.
  const settled = await Promise.allSettled([
    applyMutationWithRetry(h.repo, id, (r) => {
      const before = r.claimedBy?.value;
      r.claim(MemberName.of('a'), new Date().toISOString());
      return r.claimedBy?.value !== before;
    }),
    applyMutationWithRetry(h.repo, id, (r) => {
      const before = r.claimedBy?.value;
      r.claim(MemberName.of('b'), new Date().toISOString());
      return r.claimedBy?.value !== before;
    }),
  ]);
  const fulfilled = settled.filter((s) => s.status === 'fulfilled');
  const rejected = settled.filter((s) => s.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one claim must succeed');
  assert.equal(rejected.length, 1, 'the other must refuse');
  const reason = (rejected[0] as PromiseRejectedResult).reason as Error;
  assert.match(
    reason.message,
    /already claimed/,
    'the loser must see the domain conflict — not a silent drop or generic version error',
  );

  const final = (await h.repo.findById(RequestId.of(id)))!;
  const claimedBy = final.claimedBy?.value;
  assert.ok(
    claimedBy === 'a' || claimedBy === 'b',
    `claimant must be one of the racers: ${claimedBy}`,
  );
});

test('concurrent same-actor re-witness: idempotent under concurrency (no duplicates)', async (t) => {
  const h = bootstrap();
  t.after(h.cleanup);
  const id = await newRequestOnDisk(h.repo, 5);

  // Four parallel witness calls by the SAME actor. The first lands
  // and bumps mutation_seq; the others reload, see "already
  // witnessing", and no-op. None should duplicate.
  await Promise.all(
    [0, 1, 2, 3].map(() =>
      applyMutationWithRetry(h.repo, id, (r) => {
        const before = r.witnesses.length;
        r.witness(MemberName.of('a'));
        return r.witnesses.length !== before;
      }),
    ),
  );

  const final = (await h.repo.findById(RequestId.of(id)))!;
  assert.deepEqual(
    final.witnesses.map((m) => m.value),
    ['a'],
    'idempotent re-witness must not duplicate under concurrency',
  );
});

test('mutation_seq is monotonic across the witness/claim lifecycle', async (t) => {
  const h = bootstrap();
  t.after(h.cleanup);
  const id = await newRequestOnDisk(h.repo, 6);

  const seq = async () => (await h.repo.findById(RequestId.of(id)))!.mutationSeq;

  assert.equal(await seq(), 0, 'fresh request must have mutation_seq=0');

  await applyMutationWithRetry(h.repo, id, (r) => {
    r.witness(MemberName.of('a'));
    return true;
  });
  assert.equal(await seq(), 1, 'first witness bumps to 1');

  await applyMutationWithRetry(h.repo, id, (r) => {
    r.witness(MemberName.of('b'));
    return true;
  });
  assert.equal(await seq(), 2, 'second witness bumps to 2');

  // Re-witness same actor — domain no-op, save skipped, mutation_seq
  // must NOT bump.
  await applyMutationWithRetry(h.repo, id, (r) => {
    const before = r.witnesses.length;
    r.witness(MemberName.of('a'));
    return r.witnesses.length !== before;
  });
  assert.equal(
    await seq(),
    2,
    'idempotent re-witness must not bump mutation_seq',
  );

  await applyMutationWithRetry(h.repo, id, (r) => {
    r.claim(MemberName.of('a'), new Date().toISOString());
    return true;
  });
  assert.equal(await seq(), 3, 'first claim bumps to 3');

  await applyMutationWithRetry(h.repo, id, (r) => {
    r.unwitness(MemberName.of('b'));
    return true;
  });
  assert.equal(await seq(), 4, 'unwitness bumps to 4');
});

test('byte-stable: pre-#244-fix records (no mutation_seq field) round-trip clean', async (t) => {
  // A never-mediated record (mutation_seq=0) must NOT emit the field
  // in YAML — pre-#244 records on disk lack the field entirely, and
  // a fresh post-fix record must round-trip identically so dogfooded
  // records don't churn diffs.
  const h = bootstrap();
  t.after(h.cleanup);
  const id = await newRequestOnDisk(h.repo, 7);
  const yamlPath = join(h.root, 'requests', 'pending', `${id}.yaml`);
  const yaml = readFileSync(yamlPath, 'utf8');
  assert.doesNotMatch(
    yaml,
    /mutation_seq/,
    'never-mediated record must omit mutation_seq for byte-stable round-trip with pre-#244 YAML',
  );
});

test('mutation_seq emitted in YAML only after first mutation', async (t) => {
  const h = bootstrap();
  t.after(h.cleanup);
  const id = await newRequestOnDisk(h.repo, 8);
  await applyMutationWithRetry(h.repo, id, (r) => {
    r.witness(MemberName.of('observer'));
    return true;
  });

  const yamlPath = join(h.root, 'requests', 'pending', `${id}.yaml`);
  const yaml = readFileSync(yamlPath, 'utf8');
  assert.match(
    yaml,
    /mutation_seq:\s*1/,
    'after one mutation, mutation_seq: 1 must surface in YAML',
  );
});

test('repo: stale-load + concurrent witness throws RequestVersionConflict', async (t) => {
  // Belt-and-braces: a stale-loaded request that tries to save AFTER
  // a concurrent mutation must throw RequestVersionConflict (the
  // signal the retry helper relies on). Exercises the repo directly,
  // past the retry, to confirm the optimistic-lock check sees
  // mutation_seq movement — without this the retry helper would loop
  // forever on a silent overwrite.
  const h = bootstrap();
  t.after(h.cleanup);
  const id = await newRequestOnDisk(h.repo, 9);

  // Snapshot 1: load fresh (loadedVersion = create's status_log = 1).
  const snapshot = (await h.repo.findById(RequestId.of(id)))!;
  // Concurrent path: a different agent witnesses and saves first.
  await applyMutationWithRetry(h.repo, id, (r) => {
    r.witness(MemberName.of('a'));
    return true;
  });
  // Now `snapshot` is stale. Try to mutate and save it.
  snapshot.witness(MemberName.of('b'));
  await assert.rejects(
    () => h.repo.save(snapshot),
    (e: unknown) => e instanceof RequestVersionConflict,
    'save() on a stale aggregate after a concurrent witness must throw RequestVersionConflict — that is the signal the retry helper relies on',
  );
});

test('terminal auto-reset bumps mutation_seq per cleared actor', async (t) => {
  // Per-actor accounting: a terminal frontier collapsing one claim
  // and N witnesses bumps mutation_seq by 1 + N (one for the claim,
  // one per witness). The test sets up "claim + 3 witnesses" then
  // walks to a terminal state and asserts the delta — keeps "how
  // many actors were mediating at close" recoverable from the seq.
  const h = bootstrap();
  t.after(h.cleanup);
  const id = await newRequestOnDisk(h.repo, 10);

  for (const name of ['w1', 'w2', 'w3']) {
    await applyMutationWithRetry(h.repo, id, (r) => {
      r.witness(MemberName.of(name));
      return true;
    });
  }
  await applyMutationWithRetry(h.repo, id, (r) => {
    r.claim(MemberName.of('c'), new Date().toISOString());
    return true;
  });

  const before = (await h.repo.findById(RequestId.of(id)))!.mutationSeq;
  assert.equal(before, 4, '3 witnesses + 1 claim = 4 mutation_seq');

  // Walk to denied (terminal) — releases claim and resets witnesses.
  await applyMutationWithRetry(h.repo, id, (r) => {
    r.deny(MemberName.of('eris'), 'no');
    return true;
  });

  const after = (await h.repo.findById(RequestId.of(id)))!;
  assert.equal(
    after.mutationSeq,
    before + 1 /* claim cleared */ + 3 /* witnesses cleared */,
    'terminal auto-reset must bump per-actor (claim +1, each witness +1)',
  );
  assert.equal(after.claimedBy, undefined);
  assert.equal(after.witnesses.length, 0);
});
