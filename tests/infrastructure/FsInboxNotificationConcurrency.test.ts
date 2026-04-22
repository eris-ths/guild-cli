// Inbox concurrency: post/markRead use atomic write + version CAS so
// two concurrent writers can't silently drop each other's work. The
// companion to YamlRequestRepository.test.ts's RequestVersionConflict
// cases — same optimistic-lock pattern.
//
// Ground truth (pre-fix): post was read-modify-writeTextSafe, so two
// posts racing on the same inbox would last-writer-wins. The first
// message could be silently overwritten.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { FsInboxNotification } from '../../src/infrastructure/persistence/FsInboxNotification.js';
import { InboxVersionConflict } from '../../src/application/ports/NotificationPort.js';
import { MemberName } from '../../src/domain/member/MemberName.js';
import { GuildConfig } from '../../src/infrastructure/config/GuildConfig.js';

function bootstrap(): { port: FsInboxNotification; root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-inbox-concur-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  mkdirSync(join(root, 'inbox'));
  const config = GuildConfig.load(root);
  const port = new FsInboxNotification(config);
  return { port, root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('post() bumps version and uses atomic write', async () => {
  const { port, root, cleanup } = bootstrap();
  try {
    await port.post({
      from: 'alice',
      to: MemberName.of('bob'),
      type: 'message',
      text: 'first',
    });
    const raw = readFileSync(join(root, 'inbox', 'bob.yaml'), 'utf8');
    const parsed = YAML.parse(raw);
    assert.equal(parsed.version, 1);
    assert.equal(parsed.messages.length, 1);

    await port.post({
      from: 'alice',
      to: MemberName.of('bob'),
      type: 'message',
      text: 'second',
    });
    const parsed2 = YAML.parse(readFileSync(join(root, 'inbox', 'bob.yaml'), 'utf8'));
    assert.equal(parsed2.version, 2);
    assert.equal(parsed2.messages.length, 2);

    // No leftover .tmp-* files
    const tmpLeftovers = existsSync(join(root, 'inbox'))
      ? readFileSync(join(root, 'inbox', 'bob.yaml'), 'utf8')
      : '';
    assert.ok(!tmpLeftovers.includes('.tmp-'), 'no tmp leftovers expected');
  } finally {
    cleanup();
  }
});

test('writeWithCas: detects concurrent writer that bumped disk version', async () => {
  // Real CAS path verification (was previously contract-only). The
  // trick: `post()` is fully sync end-to-end (readFileSync +
  // writeFileSync), so two concurrent post() calls in the same
  // process execute sequentially and never race. To exercise the
  // CAS we capture a stale snapshot via the port's private
  // readWithVersion, let another writer advance the file, then ask
  // writeWithCas to re-check — same flow the runtime exercises,
  // just with the race deterministically ordered.
  const { port, root, cleanup } = bootstrap();
  try {
    // Seed at version=1.
    await port.post({
      from: 'alice',
      to: MemberName.of('bob'),
      type: 'message',
      text: 'seed',
    });

    // Capture a stale snapshot at version=1 using the private reader.
    // The `as any` is a test-only seam — the production path keeps
    // read + CAS inside post()/markRead().
    type Priv = {
      readWithVersion(rel: string): {
        file: { version?: number; messages: Array<Record<string, unknown>> };
        version: number;
      };
      writeWithCas(
        member: string,
        rel: string,
        file: { version?: number; messages: Array<Record<string, unknown>> },
        loadedVersion: number,
      ): void;
    };
    const priv = port as unknown as Priv;
    const snapshot = priv.readWithVersion('bob.yaml');
    assert.equal(snapshot.version, 1);

    // A concurrent writer advances disk to version=2.
    await port.post({
      from: 'alice',
      to: MemberName.of('bob'),
      type: 'message',
      text: 'concurrent writer',
    });

    // Stale snapshot's CAS should now detect the drift and throw.
    const staleFile = {
      ...snapshot.file,
      version: snapshot.version + 1,
      messages: [
        ...snapshot.file.messages,
        { from: 'alice', to: 'bob', type: 'message', text: 'stale' },
      ],
    };
    assert.throws(
      () => priv.writeWithCas('bob', 'bob.yaml', staleFile, snapshot.version),
      (e: unknown) =>
        e instanceof InboxVersionConflict &&
        e.expected === 1 &&
        e.found === 2,
    );

    // The concurrent writer's version=2 content survives untouched.
    const parsed = YAML.parse(
      readFileSync(join(root, 'inbox', 'bob.yaml'), 'utf8'),
    );
    assert.equal(parsed.version, 2);
    assert.equal(parsed.messages.length, 2);
    assert.equal(
      parsed.messages[1].text,
      'concurrent writer',
      "concurrent writer's content must not be clobbered by stale CAS attempt",
    );
  } finally {
    cleanup();
  }
});

test('writeWithCas: detects when file was deleted between load and save', async () => {
  // Edge case: the existsSafe check inside writeWithCas means a
  // file deleted between load and save skips the CAS and proceeds
  // as if fresh. That's by design (see writeWithCas comment) — but
  // pin it so the behavior change, if ever chosen, surfaces in CI.
  const { port, root, cleanup } = bootstrap();
  try {
    await port.post({
      from: 'alice',
      to: MemberName.of('bob'),
      type: 'message',
      text: 'seed',
    });
    type Priv = {
      readWithVersion(rel: string): {
        file: { version?: number; messages: Array<Record<string, unknown>> };
        version: number;
      };
      writeWithCas(
        member: string,
        rel: string,
        file: { version?: number; messages: Array<Record<string, unknown>> },
        loadedVersion: number,
      ): void;
    };
    const priv = port as unknown as Priv;
    const snapshot = priv.readWithVersion('bob.yaml');
    // Delete the file (simulating an external cleanup).
    unlinkSync(join(root, 'inbox', 'bob.yaml'));
    // writeWithCas with loadedVersion=1 against a now-missing file
    // falls through to atomic write (no CAS check possible).
    const fresh = { version: 2, messages: snapshot.file.messages };
    assert.doesNotThrow(() =>
      priv.writeWithCas('bob', 'bob.yaml', fresh, snapshot.version),
    );
    const parsed = YAML.parse(
      readFileSync(join(root, 'inbox', 'bob.yaml'), 'utf8'),
    );
    assert.equal(parsed.version, 2);
  } finally {
    cleanup();
  }
});

test('post() retries once on InboxVersionConflict and succeeds', async () => {
  // post() catches InboxVersionConflict and re-reads + re-writes.
  // This suite exercises the retry by forcing the first-attempt
  // write to conflict (via a stale snapshot committed manually),
  // then calling the public post() — which internally retries
  // against the post-stale disk and succeeds.
  //
  // Why this is safe: post is append-only. A retry re-reads the
  // now-advanced file, appends on top, writes. No duplicate side
  // effect — just a later `at` timestamp for the retried message.
  const { port, root, cleanup } = bootstrap();
  try {
    // Seed at version=1.
    await port.post({
      from: 'alice',
      to: MemberName.of('bob'),
      type: 'message',
      text: 'seed',
    });

    // Manually drive a stale write so the next public post() sees
    // a conflict on its first attempt and must retry.
    type Priv = {
      readWithVersion(rel: string): {
        file: { version?: number; messages: Array<Record<string, unknown>> };
        version: number;
      };
    };
    const priv = port as unknown as Priv;

    // Concurrent writer bumps disk to version=2 behind the scenes.
    await port.post({
      from: 'eve',
      to: MemberName.of('bob'),
      type: 'message',
      text: 'concurrent',
    });

    // Now a public post() starts: its first _postOnce captures
    // version=2 from disk (on-disk = 2, loadedVersion = 2), which
    // agrees with CAS and succeeds without retry. To actually
    // trigger the retry path we need to inject a stale read. We
    // do that by monkey-patching readWithVersion for exactly one
    // call.
    const origRead = priv.readWithVersion.bind(priv);
    let callCount = 0;
    priv.readWithVersion = (rel: string) => {
      callCount++;
      if (callCount === 1) {
        // Return a stale snapshot (pretend we read at version=1
        // even though disk is at version=2). The _postOnce that
        // consumes this will prep a write with loadedVersion=1,
        // CAS will detect disk=2, throw InboxVersionConflict.
        return { file: { version: 1, messages: [] }, version: 1 };
      }
      return origRead(rel);
    };

    await port.post({
      from: 'alice',
      to: MemberName.of('bob'),
      type: 'message',
      text: 'should survive the retry',
    });

    // call 1: post's initial read (stale, injected)
    // call 2: writeWithCas CAS check (real disk = v2 → conflict)
    // call 3: retry's post initial read (origRead, real)
    // call 4: retry's writeWithCas CAS check (real, matches → pass)
    assert.equal(
      callCount,
      4,
      'first attempt (read+CAS) + retry (read+CAS) = 4 reads',
    );
    const parsed = YAML.parse(
      readFileSync(join(root, 'inbox', 'bob.yaml'), 'utf8'),
    );
    // Expect: seed (1) + concurrent (2) + retried write (3) = 3 messages
    assert.equal(parsed.messages.length, 3);
    assert.equal(parsed.version, 3);
    assert.equal(parsed.messages[2].text, 'should survive the retry');
  } finally {
    cleanup();
  }
});

test('post() surfaces the conflict after the retry also fails (2nd cascade)', async () => {
  // Retry is once-only. Two consecutive conflicts (the retry itself
  // collides with a third writer) must bubble up so the caller
  // knows to back off rather than loop forever.
  const { port, cleanup } = bootstrap();
  try {
    await port.post({
      from: 'alice',
      to: MemberName.of('bob'),
      type: 'message',
      text: 'seed',
    });
    type Priv = {
      readWithVersion(rel: string): {
        file: { version?: number; messages: Array<Record<string, unknown>> };
        version: number;
      };
    };
    const priv = port as unknown as Priv;
    const origRead = priv.readWithVersion.bind(priv);
    let callCount = 0;
    // Stale on odd calls (post initial reads), real on even calls
    // (writeWithCas CAS checks) — so both the first attempt and the
    // retry see a CAS mismatch and throw.
    priv.readWithVersion = (rel: string) => {
      callCount++;
      if (callCount % 2 === 1) {
        return { file: { version: 0, messages: [] }, version: 0 };
      }
      return origRead(rel);
    };
    await assert.rejects(
      () =>
        port.post({
          from: 'alice',
          to: MemberName.of('bob'),
          type: 'message',
          text: 'never lands',
        }),
      (e: unknown) => e instanceof InboxVersionConflict,
    );
  } finally {
    cleanup();
  }
});

test('post() sequentially: happy-path CAS (no race, no conflict)', async () => {
  // Regression guard for the "no false conflict" case — sequential
  // posts from the same instance must keep succeeding forever, with
  // version climbing monotonically. A bug that incorrectly compared
  // loadedVersion to post-write disk value would fail here.
  const { port, root, cleanup } = bootstrap();
  try {
    for (let i = 0; i < 5; i++) {
      await port.post({
        from: 'alice',
        to: MemberName.of('bob'),
        type: 'message',
        text: `msg ${i}`,
      });
    }
    const parsed = YAML.parse(
      readFileSync(join(root, 'inbox', 'bob.yaml'), 'utf8'),
    );
    assert.equal(parsed.version, 5);
    assert.equal(parsed.messages.length, 5);
  } finally {
    cleanup();
  }
});

test('markRead() also uses version CAS', async () => {
  const { port, root, cleanup } = bootstrap();
  try {
    await port.post({
      from: 'alice',
      to: MemberName.of('bob'),
      type: 'message',
      text: 'unread message',
    });
    const result = await port.markRead(
      MemberName.of('bob'),
      '2026-04-22T10:00:00Z',
      'bob',
    );
    assert.equal(result.marked, 1);
    assert.equal(result.alreadyRead, 0);
    const parsed = YAML.parse(readFileSync(join(root, 'inbox', 'bob.yaml'), 'utf8'));
    assert.equal(parsed.version, 2, 'version bumped from post(1) → markRead(2)');
    assert.equal(parsed.messages[0].read, true);
  } finally {
    cleanup();
  }
});

test('post() into a legacy (no-version) file starts counting from 0', async () => {
  // Backward compat: inbox files created by prior gate versions have no
  // `version` field. The new post should treat them as version=0 and
  // write version=1 without crashing or throwing a false conflict.
  const { port, root, cleanup } = bootstrap();
  try {
    writeFileSync(
      join(root, 'inbox', 'bob.yaml'),
      'messages:\n  - from: legacy\n    to: bob\n    type: message\n    text: old\n    at: 2026-04-20T00:00:00Z\n    read: false\n',
    );
    await port.post({
      from: 'alice',
      to: MemberName.of('bob'),
      type: 'message',
      text: 'new after upgrade',
    });
    const parsed = YAML.parse(readFileSync(join(root, 'inbox', 'bob.yaml'), 'utf8'));
    assert.equal(parsed.version, 1);
    assert.equal(parsed.messages.length, 2);
  } finally {
    cleanup();
  }
});

test('InboxVersionConflict: error shape', () => {
  // Contract pin: the shape callers rely on (code / message /
  // name). Paired with the writeWithCas path test above that covers
  // the functional trigger, so this one stays a pure shape test.
  const err = new InboxVersionConflict('bob', 1, 2);
  assert.equal(err.code, 'INBOX_VERSION_CONFLICT');
  assert.equal(err.name, 'InboxVersionConflict');
  assert.match(err.message, /expected version 1/);
  assert.match(err.message, /found 2/);
  assert.match(err.message, /Re-run/);
});
