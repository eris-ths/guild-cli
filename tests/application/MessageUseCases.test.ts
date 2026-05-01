import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageUseCases } from '../../src/application/message/MessageUseCases.js';
import { Member } from '../../src/domain/member/Member.js';
import { MemberName } from '../../src/domain/member/MemberName.js';
import { DomainError } from '../../src/domain/shared/DomainError.js';
import { MemberRepository } from '../../src/application/ports/MemberRepository.js';
import {
  InboxMessage,
  MarkReadResult,
  Notification,
  NotificationPort,
} from '../../src/application/ports/NotificationPort.js';
import { Clock } from '../../src/application/ports/Clock.js';

class FakeMemberRepo implements MemberRepository {
  private members = new Map<string, Member>();
  private hosts: string[] = [];

  add(name: string, active = true): void {
    this.members.set(
      name,
      Member.create({ name, category: 'professional', active }),
    );
  }
  setHosts(hosts: string[]): void {
    this.hosts = hosts;
  }
  async findByName(name: MemberName): Promise<Member | null> {
    return this.members.get(name.value) ?? null;
  }
  async exists(name: MemberName): Promise<boolean> {
    return this.members.has(name.value);
  }
  async listAll(): Promise<Member[]> {
    return Array.from(this.members.values());
  }
  async listUnrecognizedFiles(): Promise<
    Array<{ path: string; kind: 'file' | 'directory'; reason: string }>
  > {
    return [];
  }
  async save(_m: Member): Promise<void> {}
  async listHostNames(): Promise<string[]> {
    return this.hosts;
  }
}

class FakeNotifier implements NotificationPort {
  posted: Notification[] = [];
  // `readMarks[i]` tracks whether posted[i] has been flipped to read.
  readMarks: boolean[] = [];
  readAtStamps: (string | undefined)[] = [];
  readByStamps: (string | undefined)[] = [];
  failFor: Set<string> = new Set();
  async post(n: Notification): Promise<void> {
    if (this.failFor.has(n.to.value)) {
      throw new Error(`simulated failure for ${n.to.value}`);
    }
    this.posted.push(n);
    this.readMarks.push(false);
    this.readAtStamps.push(undefined);
    this.readByStamps.push(undefined);
  }
  async listFor(member: MemberName): Promise<InboxMessage[]> {
    const out: InboxMessage[] = [];
    for (let i = 0; i < this.posted.length; i++) {
      const n = this.posted[i]!;
      if (n.to.value !== member.value) continue;
      const msg: InboxMessage = {
        from: n.from,
        to: n.to.value,
        type: n.type,
        text: n.text,
        at: n.at ?? '',
        read: this.readMarks[i] === true,
      };
      const readAt = this.readAtStamps[i];
      if (readAt !== undefined) msg.readAt = readAt;
      const readBy = this.readByStamps[i];
      if (readBy !== undefined) msg.readBy = readBy;
      out.push(msg);
    }
    return out;
  }
  async markRead(
    member: MemberName,
    readAt: string,
    readBy: string,
    index?: number,
  ): Promise<MarkReadResult> {
    // Map the recipient's 1-based index into the underlying flat
    // posted[] array. Only messages addressed to `member` are counted.
    const recipientIndices: number[] = [];
    for (let i = 0; i < this.posted.length; i++) {
      if (this.posted[i]!.to.value === member.value) {
        recipientIndices.push(i);
      }
    }
    const total = recipientIndices.length;
    if (index !== undefined) {
      if (!Number.isInteger(index) || index < 1 || index > total) {
        throw new DomainError(
          `inbox index out of range: ${index} (inbox has ${total} message(s))`,
          'index',
        );
      }
    }
    let marked = 0;
    let alreadyRead = 0;
    for (let k = 0; k < recipientIndices.length; k++) {
      if (index !== undefined && k + 1 !== index) continue;
      const i = recipientIndices[k]!;
      if (this.readMarks[i] === true) {
        alreadyRead++;
        continue;
      }
      this.readMarks[i] = true;
      this.readAtStamps[i] = readAt;
      this.readByStamps[i] = readBy;
      marked++;
    }
    return { marked, alreadyRead, total };
  }
}

const frozenClock: Clock = {
  now: () => new Date('2026-04-14T12:00:00Z'),
};

function build(): {
  uc: MessageUseCases;
  members: FakeMemberRepo;
  notifier: FakeNotifier;
} {
  const members = new FakeMemberRepo();
  const notifier = new FakeNotifier();
  const uc = new MessageUseCases({ members, notifier, clock: frozenClock });
  return { uc, members, notifier };
}

test('send delivers to registered member', async () => {
  const { uc, members, notifier } = build();
  members.add('kiri');
  members.add('noir');
  await uc.send({ from: 'kiri', to: 'noir', text: 'hello' });
  assert.equal(notifier.posted.length, 1);
  assert.equal(notifier.posted[0]!.to.value, 'noir');
  assert.equal(notifier.posted[0]!.from, 'kiri');
  assert.equal(notifier.posted[0]!.type, 'message');
});

test('send rejects unknown recipient', async () => {
  const { uc, members } = build();
  members.add('kiri');
  await assert.rejects(
    () => uc.send({ from: 'kiri', to: 'ghost', text: 'hi' }),
    DomainError,
  );
});

test('send rejects empty text', async () => {
  const { uc, members } = build();
  members.add('kiri');
  members.add('noir');
  await assert.rejects(
    () => uc.send({ from: 'kiri', to: 'noir', text: '   ' }),
    DomainError,
  );
});

test('send strips control characters from text', async () => {
  const { uc, members, notifier } = build();
  members.add('kiri');
  members.add('noir');
  await uc.send({ from: 'kiri', to: 'noir', text: 'hello\x00world' });
  assert.equal(notifier.posted[0]!.text, 'helloworld');
});

test('broadcast fans out to active members except sender', async () => {
  const { uc, members, notifier } = build();
  members.add('kiri');
  members.add('noir');
  members.add('rin');
  const result = await uc.broadcast({ from: 'kiri', text: 'hi all' });
  assert.deepEqual(result.delivered.sort(), ['noir', 'rin']);
  assert.equal(result.failed.length, 0);
  assert.equal(notifier.posted.length, 2);
});

test('broadcast excludes inactive members', async () => {
  const { uc, members } = build();
  members.add('kiri');
  members.add('noir');
  members.add('rin', false); // inactive
  const result = await uc.broadcast({ from: 'kiri', text: 'hi' });
  assert.deepEqual(result.delivered, ['noir']);
});

test('broadcast collects partial failures instead of throwing', async () => {
  const { uc, members, notifier } = build();
  members.add('kiri');
  members.add('noir');
  members.add('rin');
  notifier.failFor.add('rin');
  const result = await uc.broadcast({ from: 'kiri', text: 'hi' });
  assert.deepEqual(result.delivered, ['noir']);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0]!.to, 'rin');
  assert.match(result.failed[0]!.error, /simulated/);
});

test('inbox returns messages for member', async () => {
  const { uc, members, notifier } = build();
  members.add('kiri');
  members.add('noir');
  await uc.send({ from: 'kiri', to: 'noir', text: 'one' });
  await uc.send({ from: 'kiri', to: 'noir', text: 'two' });
  const msgs = await uc.inbox('noir');
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0]!.text, 'one');
  assert.equal(msgs[1]!.text, 'two');
  void notifier; // suppress unused
});

test('inbox for host name gives descriptive error', async () => {
  const { uc, members } = build();
  members.add('kiri');
  members.setHosts(['human']);
  await assert.rejects(
    () => uc.inbox('human'),
    (e: unknown) => {
      assert.ok(e instanceof DomainError);
      assert.match(e.message, /hosts do not have inboxes/);
      return true;
    },
  );
});

test('inbox for host surfaces guild-observation hints (tail / voices / list)', async () => {
  // The hint is the onboarding signal: someone who ran `gate inbox
  // --for <host>` almost certainly wants to see guild activity, and
  // the error should say what the right verb is. Pinned so this
  // guidance can't silently regress.
  const { uc, members } = build();
  members.add('kiri');
  members.setHosts(['human']);
  await assert.rejects(
    () => uc.inbox('human'),
    (e: unknown) => {
      assert.ok(e instanceof DomainError);
      assert.match(e.message, /gate tail/);
      assert.match(e.message, /gate voices/);
      return true;
    },
  );
});

test('inbox for unknown-and-not-host gives plain error', async () => {
  const { uc, members } = build();
  members.add('kiri');
  await assert.rejects(
    () => uc.inbox('nobody'),
    (e: unknown) => {
      assert.ok(e instanceof DomainError);
      assert.match(e.message, /not a registered member/);
      return true;
    },
  );
});

test('inbox for unknown surfaces the gate register hint', async () => {
  const { uc, members } = build();
  members.add('kiri');
  await assert.rejects(
    () => uc.inbox('newcomer'),
    (e: unknown) => {
      assert.ok(e instanceof DomainError);
      assert.match(e.message, /gate register --name newcomer/);
      return true;
    },
  );
});

test('send to host is rejected with share-a-request hint', async () => {
  // A host cannot receive a message directly — that's the existing
  // behaviour. The new hint tells the sender what to do instead:
  // share a request/issue where the host can see it via tail/voices.
  const { uc, members } = build();
  members.add('kiri');
  members.setHosts(['human']);
  await assert.rejects(
    () => uc.send({ from: 'kiri', to: 'human', text: 'hi' }),
    (e: unknown) => {
      assert.ok(e instanceof DomainError);
      assert.match(e.message, /Cannot message host/);
      assert.match(e.message, /gate request/);
      assert.match(e.message, /gate fast-track/);
      assert.match(e.message, /gate issues add/);
      return true;
    },
  );
});

test('send to unknown recipient surfaces the gate register hint', async () => {
  const { uc, members } = build();
  members.add('kiri');
  await assert.rejects(
    () => uc.send({ from: 'kiri', to: 'ghost', text: 'hi' }),
    (e: unknown) => {
      assert.ok(e instanceof DomainError);
      assert.match(e.message, /not a registered member/);
      assert.match(e.message, /gate register --name ghost/);
      return true;
    },
  );
});

test('markRead flips all unread messages when no index', async () => {
  const { uc, members } = build();
  members.add('kiri');
  members.add('noir');
  await uc.send({ from: 'kiri', to: 'noir', text: 'one' });
  await uc.send({ from: 'kiri', to: 'noir', text: 'two' });
  await uc.send({ from: 'kiri', to: 'noir', text: 'three' });

  const result = await uc.markRead('noir');
  assert.equal(result.marked, 3);
  assert.equal(result.alreadyRead, 0);
  assert.equal(result.total, 3);

  const msgs = await uc.inbox('noir');
  assert.ok(msgs.every((m) => m.read === true));
});

test('markRead is idempotent: second call marks nothing, reports alreadyRead', async () => {
  const { uc, members } = build();
  members.add('kiri');
  members.add('noir');
  await uc.send({ from: 'kiri', to: 'noir', text: 'one' });
  await uc.send({ from: 'kiri', to: 'noir', text: 'two' });

  await uc.markRead('noir');
  const result = await uc.markRead('noir');
  assert.equal(result.marked, 0);
  assert.equal(result.alreadyRead, 2);
  assert.equal(result.total, 2);
});

test('markRead with index marks just that message (1-based)', async () => {
  const { uc, members } = build();
  members.add('kiri');
  members.add('noir');
  await uc.send({ from: 'kiri', to: 'noir', text: 'one' });
  await uc.send({ from: 'kiri', to: 'noir', text: 'two' });
  await uc.send({ from: 'kiri', to: 'noir', text: 'three' });

  const result = await uc.markRead('noir', undefined, 2);
  assert.equal(result.marked, 1);
  assert.equal(result.alreadyRead, 0);
  assert.equal(result.total, 3);

  const msgs = await uc.inbox('noir');
  assert.equal(msgs[0]!.read, false);
  assert.equal(msgs[1]!.read, true);
  assert.equal(msgs[2]!.read, false);
});

test('markRead with out-of-range index throws DomainError', async () => {
  const { uc, members } = build();
  members.add('kiri');
  members.add('noir');
  await uc.send({ from: 'kiri', to: 'noir', text: 'one' });

  await assert.rejects(
    () => uc.markRead('noir', undefined, 5),
    (e: unknown) => {
      assert.ok(e instanceof DomainError);
      assert.match(e.message, /out of range/);
      return true;
    },
  );
});

test('markRead for empty inbox returns zeros without error', async () => {
  const { uc, members } = build();
  members.add('kiri');
  members.add('noir');
  // noir exists but has no messages
  const result = await uc.markRead('noir');
  assert.equal(result.marked, 0);
  assert.equal(result.alreadyRead, 0);
  assert.equal(result.total, 0);
});

test('markRead defaults read_by to the inbox owner (self-read)', async () => {
  const { uc, members, notifier } = build();
  members.add('kiri');
  members.add('noir');
  await uc.send({ from: 'kiri', to: 'noir', text: 'one' });
  await uc.markRead('noir');
  const msgs = await uc.inbox('noir');
  assert.equal(msgs[0]!.readBy, 'noir');
  void notifier;
});

test('markRead records read_by when a different actor reads on behalf', async () => {
  // The audit trail must distinguish "sentinel acknowledged this"
  // from "eris ran mark-read --for sentinel". Without read_by the
  // two cases are indistinguishable in YAML.
  const { uc, members } = build();
  members.add('eris');
  members.add('sentinel');
  members.add('noir');
  await uc.send({ from: 'noir', to: 'sentinel', text: 'hello' });
  await uc.markRead('sentinel', 'eris');
  const msgs = await uc.inbox('sentinel');
  assert.equal(msgs[0]!.read, true);
  assert.equal(msgs[0]!.readBy, 'eris');
});

test('markRead for host name raises the inbox-owner error', async () => {
  const { uc, members } = build();
  members.add('kiri');
  members.setHosts(['human']);
  await assert.rejects(
    () => uc.markRead('human'),
    (e: unknown) => {
      assert.ok(e instanceof DomainError);
      assert.match(e.message, /hosts do not have inboxes/);
      return true;
    },
  );
});

// ── invoked_by on send / broadcast ──

test('send stamps invoked_by on the Notification when differs from from', () => {
  const { uc, members, notifier } = build();
  members.add('eris');
  members.add('noir');
  return uc
    .send({ from: 'eris', to: 'noir', text: 'hi', invokedBy: 'claude' })
    .then(() => {
      assert.equal(notifier.posted[0]!.invokedBy, 'claude');
    });
});

test('send drops invoked_by when it equals from (no clutter)', () => {
  const { uc, members, notifier } = build();
  members.add('eris');
  members.add('noir');
  return uc
    .send({ from: 'eris', to: 'noir', text: 'hi', invokedBy: 'eris' })
    .then(() => {
      assert.equal(notifier.posted[0]!.invokedBy, undefined);
    });
});

test('broadcast stamps invoked_by on every fan-out envelope', () => {
  const { uc, members, notifier } = build();
  members.add('eris');
  members.add('noir');
  members.add('rin');
  return uc
    .broadcast({ from: 'eris', text: 'hi', invokedBy: 'claude' })
    .then(() => {
      assert.equal(notifier.posted.length, 2);
      for (const p of notifier.posted) {
        assert.equal(p.invokedBy, 'claude');
      }
    });
});
