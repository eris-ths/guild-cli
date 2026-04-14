import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageUseCases } from '../../src/application/message/MessageUseCases.js';
import { Member } from '../../src/domain/member/Member.js';
import { MemberName } from '../../src/domain/member/MemberName.js';
import { DomainError } from '../../src/domain/shared/DomainError.js';
import { MemberRepository } from '../../src/application/ports/MemberRepository.js';
import {
  InboxMessage,
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
  async save(_m: Member): Promise<void> {}
  async listHostNames(): Promise<string[]> {
    return this.hosts;
  }
}

class FakeNotifier implements NotificationPort {
  posted: Notification[] = [];
  failFor: Set<string> = new Set();
  async post(n: Notification): Promise<void> {
    if (this.failFor.has(n.to.value)) {
      throw new Error(`simulated failure for ${n.to.value}`);
    }
    this.posted.push(n);
  }
  async listFor(member: MemberName): Promise<InboxMessage[]> {
    return this.posted
      .filter((n) => n.to.value === member.value)
      .map((n) => ({
        from: n.from,
        to: n.to.value,
        type: n.type,
        text: n.text,
        at: n.at ?? '',
        read: false,
      }));
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
