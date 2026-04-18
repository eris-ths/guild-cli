import { MemberName } from '../../domain/member/MemberName.js';
import { DomainError } from '../../domain/shared/DomainError.js';
import { MemberRepository } from '../ports/MemberRepository.js';
import {
  InboxMessage,
  MarkReadResult,
  NotificationPort,
} from '../ports/NotificationPort.js';
import { Clock } from '../ports/Clock.js';
import { assertActor } from '../shared/assertActor.js';

const MAX_MESSAGE_TEXT = 2048;

export interface MessageUseCasesDeps {
  members: MemberRepository;
  notifier: NotificationPort;
  clock: Clock;
}

export interface BroadcastResult {
  delivered: string[];
  failed: Array<{ to: string; error: string }>;
}

/**
 * Free-form messaging between members. Unlike Request, Message has no
 * lifecycle — each message is an append-only row in the recipient's
 * inbox. Broadcasting is implemented as a fan-out of single posts so
 * callers can inspect delivery per-recipient.
 */
export class MessageUseCases {
  constructor(private readonly deps: MessageUseCasesDeps) {}

  async send(input: {
    from: string;
    to: string;
    text: string;
    type?: string;
    related?: string;
    invokedBy?: string;
  }): Promise<void> {
    const from = await assertActor(input.from, '--from', this.deps.members);
    // --to must be a real registered member — we can't deliver to a host
    // name because there's no inbox file for them. Two distinct
    // onboarding cues live here: if the target is a registered host,
    // nudge toward guild-style "share a request they can see"; if it
    // just doesn't exist yet, point at `gate register`.
    const toName = MemberName.of(input.to);
    const toMember = await this.deps.members.findByName(toName);
    if (!toMember) {
      const hosts = await this.deps.members.listHostNames();
      if (hosts.includes(toName.value)) {
        throw new DomainError(
          [
            `Cannot message host "${toName.value}" — hosts do not have inboxes.`,
            `  Hosts are content_root operators, not message recipients.`,
            `  Share what you want to say where the host will see it:`,
            `    gate request --from ${from.value} --action ... --reason ...`,
            `    gate fast-track --from ${from.value} --action ... --reason ...`,
            `    gate issues add --from ${from.value} --severity low --area ... "..."`,
            `  The host can then read the guild via \`gate tail\` or \`gate voices\`.`,
          ].join('\n'),
          'to',
        );
      }
      throw new DomainError(
        [
          `Recipient "${toName.value}" is not a registered member.`,
          `  If they should exist, register them:`,
          `    gate register --name ${toName.value}`,
          `  Or double-check the spelling — names are lowercase ASCII (see members/).`,
        ].join('\n'),
        'to',
      );
    }
    const text = sanitizeMessageText(input.text);
    const invokedBy =
      input.invokedBy !== undefined && input.invokedBy !== from.value
        ? input.invokedBy
        : undefined;
    await this.deps.notifier.post({
      from: from.value,
      to: toMember.name,
      type: input.type ?? 'message',
      text,
      ...(input.related !== undefined ? { related: input.related } : {}),
      ...(invokedBy !== undefined ? { invokedBy } : {}),
      at: this.deps.clock.now().toISOString(),
    });
  }


  /**
   * Fan-out post to every active member except `from`. Returns a
   * delivery report so the caller can surface partial failure.
   * Delivery is sequential to keep output ordering predictable and
   * avoid overwhelming the filesystem for large guilds; callers that
   * need parallelism can post individually.
   */
  async broadcast(input: {
    from: string;
    text: string;
    type?: string;
    invokedBy?: string;
  }): Promise<BroadcastResult> {
    const from = await assertActor(input.from, '--from', this.deps.members);
    const text = sanitizeMessageText(input.text);
    const all = await this.deps.members.listAll();
    const targets = all
      .filter((m) => m.active && m.name.value !== from.value)
      .map((m) => m.name);
    const now = this.deps.clock.now().toISOString();
    const invokedBy =
      input.invokedBy !== undefined && input.invokedBy !== from.value
        ? input.invokedBy
        : undefined;
    const delivered: string[] = [];
    const failed: Array<{ to: string; error: string }> = [];
    for (const to of targets) {
      try {
        await this.deps.notifier.post({
          from: from.value,
          to,
          type: input.type ?? 'broadcast',
          text,
          at: now,
          ...(invokedBy !== undefined ? { invokedBy } : {}),
        });
        delivered.push(to.value);
      } catch (e) {
        failed.push({
          to: to.value,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return { delivered, failed };
  }

  async inbox(name: string): Promise<InboxMessage[]> {
    // Intentionally does NOT go through assertActor — reading an inbox
    // does not require the owner to be the current actor.
    await this.assertInboxOwner(name);
    return this.deps.notifier.listFor(MemberName.of(name));
  }

  /**
   * Mark messages in `name`'s inbox as read. When `index` is provided,
   * only that 1-based message is flipped; otherwise every unread
   * message is marked. Returns a report so the caller can say
   * "marked N (K already read)".
   *
   * Reading is itself an act worth recording: mark-read is the
   * trace that "I received this and acknowledged it". The --unread
   * filter on `gate inbox` depends on this verb existing to be
   * meaningful.
   *
   * `by` is the actor that ran the command — stored alongside
   * `read_at` so audits can distinguish "sentinel read this" from
   * "eris marked it read on sentinel's behalf". Defaults to the
   * inbox owner when omitted (typical self-reader case).
   */
  async markRead(
    name: string,
    by?: string,
    index?: number,
  ): Promise<MarkReadResult> {
    await this.assertInboxOwner(name);
    const actor = by ?? name;
    return this.deps.notifier.markRead(
      MemberName.of(name),
      this.deps.clock.now().toISOString(),
      actor,
      index,
    );
  }

  private async assertInboxOwner(name: string): Promise<void> {
    const member = await this.deps.members.findByName(MemberName.of(name));
    if (member) return;
    const hosts = await this.deps.members.listHostNames();
    if (hosts.includes(name)) {
      throw new DomainError(
        [
          `"${name}" is a host, not a member — hosts do not have inboxes.`,
          `  To observe the guild activity instead:`,
          `    gate tail                # last events across all actors`,
          `    gate voices <member>     # one actor's utterances`,
          `    gate list --state <s>    # requests in a given state`,
        ].join('\n'),
        'for',
      );
    }
    throw new DomainError(
      [
        `"${name}" is not a registered member.`,
        `  Register first:`,
        `    gate register --name ${name}`,
        `  Or pick an existing member (ls members/).`,
      ].join('\n'),
      'for',
    );
  }
}

function sanitizeMessageText(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new DomainError('text must be a string', 'text');
  }
  const cleaned = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  if (!cleaned) throw new DomainError('text required', 'text');
  if (cleaned.length > MAX_MESSAGE_TEXT) {
    throw new DomainError(
      `text too long (max ${MAX_MESSAGE_TEXT})`,
      'text',
    );
  }
  return cleaned;
}
