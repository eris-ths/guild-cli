import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { C } from './internal.js';

const RESUME_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format', 'locale']);
import { Request, StatusLogEntry } from '../../../domain/request/Request.js';
import { collectUtterances, Utterance, RequestJSON } from '../voices.js';
import { deriveSuggestedNext, SuggestedNext } from './writeFormat.js';
import { UnrespondedConcernsEntry } from '../../../application/concern/UnrespondedConcernsQuery.js';

/**
 * gate resume [--format json|text]
 *
 * Reconstruct what the actor was doing when the last session ended.
 *
 * The verb exists because agents are, by default, stateless across
 * sessions — context window closes, memory resets. guild-cli's
 * file-based record means a session ending is not the same as work
 * ending: the YAML under content_root preserves everything the actor
 * said and did. `gate resume` reads that record from the actor's
 * perspective and composes a restoration prompt — not a dump, a
 * short narrative that lets the new session pick up where the old
 * one stopped.
 *
 * The payload intentionally carries two redundant shapes:
 *  - structured fields (last_utterance, last_transition, open_loops)
 *    for programmatic consumers / LLM tool layers
 *  - `restoration_prose`, plain text, for the agent itself to read
 *    back as continuity. The prose is deterministic; no LLM call
 *    happens inside the tool — the narrative is templated from the
 *    same structured facts.
 *
 * GUILD_ACTOR is required (resume is inherently first-person). The
 * actor may be a member, a host, or a name not otherwise in the
 * record — we report what we find.
 *
 * Scope — same-actor continuation, not full orientation:
 *   resume reconstructs what THIS actor was doing. It intentionally
 *   does not surface cross-actor signals:
 *     - inbox unread (boot surfaces this)
 *     - requests where the actor is named in `--with` but didn't
 *       author or execute (pair-mode receiver)
 *   These are orientation concerns, and the orientation lense is
 *   `gate boot`. Resume's empty-path prose points at boot so a
 *   newcomer who ran resume as part of a handoff learns the right
 *   verb to reach for.
 *
 *   Requests where the actor IS executor (`approved` → waiting to
 *   start, `executing` → waiting to complete) ARE surfaced as open
 *   loops even when the actor never authored — those are direct
 *   next-actions, not cross-actor signals.
 */

interface OpenLoop {
  readonly type:
    | 'awaiting_execution'
    | 'executing'
    | 'pending_review'
    | 'unreviewed_completion';
  readonly id: string;
  readonly action: string;
  readonly role: 'author' | 'executor' | 'reviewer';
  readonly age_hint: string;
  readonly since: string;
}

// Wire-format projection of StatusLogEntry for JSON emission. The
// in-memory field is `invokedBy` (camelCase); every YAML / JSON
// surface uses `invoked_by` (snake_case). Request.toJSON already
// does this conversion for status_log; resume has its own payload
// shape and needs the same flattening.
interface TransitionJSON {
  state: string;
  by: string;
  at: string;
  note?: string;
  invoked_by?: string;
  request_id: string;
}

interface ResumePayload {
  actor: string;
  session_hint: string | null;
  last_context: {
    summary: string;
    last_utterance: Utterance | null;
    last_transition: TransitionJSON | null;
    open_loops: OpenLoop[];
  };
  // Deliberately a sibling of `last_context`, not merged into
  // open_loops: the two are different kinds of commitment.
  //   open_loops        = state-machine waits ("you must transition X")
  //   unresponded_concerns = review criticism with no follow-up yet
  //                       ("somebody named a concern and nothing later
  //                        in the record references it")
  // Merging them would muddy the state-vs-dialogue distinction that is
  // actually load-bearing for readers. Kept narrow on purpose.
  unresponded_concerns: ReadonlyArray<UnrespondedConcernsEntry>;
  suggested_next: SuggestedNext | null;
  restoration_prose: string;
}

export async function resumeCmd(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, RESUME_KNOWN_FLAGS, 'resume');
  const format = optionalOption(args, 'format') ?? 'json';
  if (format !== 'json' && format !== 'text') {
    throw new Error(`--format must be 'json' or 'text', got: ${format}`);
  }
  const actor = process.env['GUILD_ACTOR'];
  if (!actor || actor.length === 0) {
    process.stderr.write(
      'gate resume requires GUILD_ACTOR (resume is inherently first-person).\n' +
        'Export it: export GUILD_ACTOR=<your-name>\n',
    );
    return 1;
  }
  const actorLower = actor.toLowerCase();

  const all = await c.requestUC.listAll();
  const allJson: RequestJSON[] = all.map((r) => r.toJSON() as unknown as RequestJSON);

  // The actor's most recent utterance — authored OR reviewed.
  // collectUtterances already merges both shapes so the selector
  // captures "whatever I last said on the record".
  const mine = collectUtterances(allJson, { name: actor, limit: 1, order: 'desc' });
  const lastUtterance = mine[0] ?? null;

  // The actor's most recent participation as a status_log author.
  // Distinct from last_utterance: a transition is a lifecycle event,
  // an utterance is speech. Both matter for "where was I".
  const lastTransition = findLastTransition(all, actorLower);

  // Enumerate "open loops" — commitments where the actor is blocking
  // progress. Sorted by urgency below so suggested_next surfaces the
  // most pressing. Exhaustively matches the four lifecycle roles the
  // actor can inhabit:
  //   executor of approved   → awaiting_execution  (must start)
  //   executor of executing  → executing           (must finish)
  //   reviewer of completed  → pending_review      (must review)
  //   author of completed    → unreviewed_completion (waiting on own reviewer)
  const openLoops = collectOpenLoops(all, actorLower);

  // Priority: "things that block others" > "things only block self".
  //   executing: partial work, may strand collaborators
  //   awaiting_execution: queue position occupied, executor not started
  //   pending_review: author blocked, waiting on this reviewer
  //   unreviewed_completion: author waiting passively; lower urgency
  const priority: Record<OpenLoop['type'], number> = {
    executing: 0,
    awaiting_execution: 1,
    pending_review: 2,
    unreviewed_completion: 3,
  };
  openLoops.sort((a, b) => priority[a.type] - priority[b.type]);

  // suggested_next: derive from the top open loop's request. Reuses
  // the same function that write-verb responses use, so the hint is
  // consistent across `gate resume` / `gate complete` / `gate boot`.
  let suggested: SuggestedNext | null = null;
  if (openLoops.length > 0) {
    const top = openLoops[0]!;
    const req = all.find((r) => r.id.value === top.id);
    if (req) suggested = deriveSuggestedNext(req, c.config, actor);
  }

  // Unresponded concerns: concern/reject verdicts on the actor's
  // authored (or pair-made) requests that have no follow-up yet. Pure
  // derivation — no state, just a read over listAll. See
  // UnrespondedConcernsQuery for the definition and its deliberate
  // coarseness (does not detect partial-close; the reader does).
  const unrespondedConcerns = await c.unrespondedConcernsQ.run({
    actor,
    now: new Date(),
  });

  // Session hint: the last timestamp the actor appears at anywhere
  // in the record. Null when the actor hasn't spoken yet.
  const sessionHint = lastUtterance?.at ?? lastTransition?.at ?? null;

  // Locale resolution: --locale takes precedence, then GUILD_LOCALE,
  // then default 'en'. Kept narrow (en / ja) because the templates
  // live in this file; adding a locale means writing the prose here.
  // If the requested locale is unknown we fall back to English and
  // leave a hint in the prose so the agent knows what happened.
  const requestedLocale =
    optionalOption(args, 'locale') ?? process.env['GUILD_LOCALE'] ?? 'en';
  const locale: 'en' | 'ja' =
    requestedLocale === 'ja' ? 'ja' : 'en';

  const summary = composeSummary(actor, lastUtterance, openLoops, locale);
  const restorationProse = composeRestorationProse({
    actor,
    lastUtterance,
    lastTransition,
    openLoops,
    unrespondedConcerns,
    suggested,
    locale,
  });

  const payload: ResumePayload = {
    actor,
    session_hint: sessionHint,
    last_context: {
      summary,
      last_utterance: lastUtterance,
      last_transition:
        lastTransition === null ? null : transitionToJSON(lastTransition),
      open_loops: openLoops,
    },
    unresponded_concerns: unrespondedConcerns,
    suggested_next: suggested,
    restoration_prose: restorationProse,
  };

  if (format === 'json') {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stdout.write(restorationProse + '\n');
  }
  return 0;
}

function transitionToJSON(
  entry: StatusLogEntry & { request_id: string },
): TransitionJSON {
  const out: TransitionJSON = {
    state: entry.state,
    by: entry.by,
    at: entry.at,
    request_id: entry.request_id,
  };
  if (entry.note !== undefined) out.note = entry.note;
  if (entry.invokedBy !== undefined) out.invoked_by = entry.invokedBy;
  return out;
}

function findLastTransition(
  all: readonly Request[],
  actorLower: string,
): (StatusLogEntry & { request_id: string }) | null {
  let latest: (StatusLogEntry & { request_id: string }) | null = null;
  for (const r of all) {
    for (const entry of r.statusLog) {
      if (entry.by !== actorLower) continue;
      if (!latest || entry.at > latest.at) {
        latest = { ...entry, request_id: r.id.value };
      }
    }
  }
  return latest;
}

function collectOpenLoops(
  all: readonly Request[],
  actorLower: string,
): OpenLoop[] {
  const loops: OpenLoop[] = [];
  const now = new Date().toISOString();
  for (const r of all) {
    const last = r.statusLog[r.statusLog.length - 1];
    const at = last?.at ?? r.statusLog[0]?.at ?? now;
    const loopBase = {
      id: r.id.value,
      action: r.action,
      since: at,
      age_hint: ageHint(at, now),
    };
    if (r.state === 'approved' && r.executor?.value === actorLower) {
      loops.push({ ...loopBase, type: 'awaiting_execution', role: 'executor' });
    } else if (r.state === 'executing' && r.executor?.value === actorLower) {
      loops.push({ ...loopBase, type: 'executing', role: 'executor' });
    } else if (r.state === 'completed' && r.autoReview?.value === actorLower) {
      const alreadyReviewed = r.reviews.some(
        (rev) => rev.by.value === actorLower,
      );
      if (!alreadyReviewed) {
        loops.push({ ...loopBase, type: 'pending_review', role: 'reviewer' });
      }
    } else if (r.state === 'completed' && r.from.value === actorLower && r.autoReview) {
      const reviewerValue = r.autoReview.value;
      const reviewed = r.reviews.some((rev) => rev.by.value === reviewerValue);
      if (!reviewed) {
        loops.push({
          ...loopBase,
          type: 'unreviewed_completion',
          role: 'author',
        });
      }
    }
  }
  return loops;
}

// Approximate human-readable age. Not precise — the point is to
// give the agent a feel for "was this just now or yesterday", not
// a timestamp. Scales: seconds / minutes / hours / days.
//
// Future timestamps (negative delta) are labeled explicitly as "in
// the future" rather than silently collapsed to "just now" — clock
// skew between machines can produce them and hiding that under a
// cheerful label would strip evidence the operator should see.
export function ageHint(from: string, now: string): string {
  const deltaMs = Date.parse(now) - Date.parse(from);
  if (!Number.isFinite(deltaMs)) return 'unknown';
  if (deltaMs < -5_000) return 'in the future (clock skew?)';
  if (deltaMs < 0) return 'just now';
  const secs = Math.floor(deltaMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function composeSummary(
  actor: string,
  last: Utterance | null,
  loops: readonly OpenLoop[],
  locale: 'en' | 'ja',
): string {
  if (locale === 'ja') {
    if (!last && loops.length === 0) {
      return `${actor} はこの content_root に記録も open loop もありません。`;
    }
    const parts: string[] = [];
    if (last) {
      const kindWord = last.kind === 'review' ? 'レビュー' : '起票';
      parts.push(`${actor} は ${last.at} に最後に ${kindWord}`);
    }
    if (loops.length > 0) {
      parts.push(`open loop: ${loops.length} 件`);
    }
    return parts.join(' / ') + '。';
  }
  if (!last && loops.length === 0) {
    return `${actor} has no recorded activity and no open loops in this content_root.`;
  }
  const parts: string[] = [];
  if (last) {
    const kindWord = last.kind === 'review' ? 'reviewed' : 'authored';
    parts.push(`${actor} last ${kindWord} at ${last.at}`);
  }
  if (loops.length > 0) {
    parts.push(`${loops.length} open loop${loops.length === 1 ? '' : 's'}`);
  }
  return parts.join('; ') + '.';
}

function composeRestorationProse(ctx: {
  actor: string;
  lastUtterance: Utterance | null;
  lastTransition: (StatusLogEntry & { request_id: string }) | null;
  openLoops: readonly OpenLoop[];
  unrespondedConcerns: ReadonlyArray<UnrespondedConcernsEntry>;
  suggested: SuggestedNext | null;
  locale: 'en' | 'ja';
}): string {
  if (ctx.locale === 'ja') return composeRestorationProseJa(ctx);
  return composeRestorationProseEn(ctx);
}

function composeRestorationProseEn(ctx: {
  actor: string;
  lastUtterance: Utterance | null;
  lastTransition: (StatusLogEntry & { request_id: string }) | null;
  openLoops: readonly OpenLoop[];
  unrespondedConcerns: ReadonlyArray<UnrespondedConcernsEntry>;
  suggested: SuggestedNext | null;
}): string {
  const { actor, lastUtterance, lastTransition, openLoops, unrespondedConcerns, suggested } = ctx;
  const lines: string[] = [];
  lines.push(`# resuming as ${actor}`);
  lines.push('');

  // "Utterance" = a voice (authored / reviewed) — something you said
  // that now lives in the record as text others can read.
  // "Transition" = a lifecycle step (pending → approved, etc.) —
  // something you did that moved a request's state. Keep them
  // separate in prose even when they coincide.
  if (lastUtterance) {
    const age = ageHint(lastUtterance.at, new Date().toISOString());
    if (lastUtterance.kind === 'review') {
      const proxyHint = lastUtterance.invokedBy
        ? ` (invoked by ${lastUtterance.invokedBy})`
        : '';
      lines.push(
        `Your last voice (utterance, ${age}) was a review on req=${lastUtterance.requestId} — [${lastUtterance.lense}/${lastUtterance.verdict}]${proxyHint}:`,
      );
      lines.push(`  "${truncate(lastUtterance.comment, 240)}"`);
    } else if (lastUtterance.kind === 'thank') {
      const proxyHint = lastUtterance.invokedBy
        ? ` (invoked by ${lastUtterance.invokedBy})`
        : '';
      lines.push(
        `Your last voice (utterance, ${age}) was a thank → ${lastUtterance.to} on req=${lastUtterance.requestId}${proxyHint}:`,
      );
      lines.push(`  re: ${truncate(lastUtterance.action, 120)}`);
      if (lastUtterance.reason !== undefined) {
        lines.push(`  "${truncate(lastUtterance.reason, 200)}"`);
      }
    } else {
      const withHint =
        lastUtterance.with && lastUtterance.with.length > 0
          ? ` (shaped with ${lastUtterance.with.join(', ')})`
          : '';
      const proxyHint = lastUtterance.invokedBy
        ? ` (invoked by ${lastUtterance.invokedBy})`
        : '';
      lines.push(
        `Your last voice (utterance, ${age}) was authoring req=${lastUtterance.requestId}${proxyHint}${withHint}:`,
      );
      lines.push(`  action: ${truncate(lastUtterance.action, 120)}`);
      if (lastUtterance.completionNote) {
        lines.push(`  note:   ${truncate(lastUtterance.completionNote, 240)}`);
      }
    }
  } else {
    lines.push(`No prior utterance on this content_root — you are arriving fresh.`);
  }

  if (
    lastTransition &&
    (!lastUtterance || lastTransition.at !== lastUtterance.at)
  ) {
    const age = ageHint(lastTransition.at, new Date().toISOString());
    const proxy = lastTransition.invokedBy
      ? ` (invoked by ${lastTransition.invokedBy})`
      : '';
    lines.push('');
    lines.push(
      `Your last lifecycle step (transition, ${age}): req=${lastTransition.request_id} → ${lastTransition.state}${proxy}${lastTransition.note ? ` — ${truncate(lastTransition.note, 180)}` : ''}`,
    );
  }

  if (openLoops.length > 0) {
    lines.push('');
    lines.push(`Open loops waiting on you (${openLoops.length}):`);
    for (const loop of openLoops) {
      const label = loopLabel(loop.type, 'en');
      lines.push(
        `  - [${loop.age_hint}] ${loop.id} (${loop.role}): ${label} — "${truncate(loop.action, 80)}"`,
      );
    }
  } else {
    lines.push('');
    lines.push('No open loops — you are not blocking anyone.');
  }

  if (unrespondedConcerns.length > 0) {
    lines.push('');
    lines.push(
      `Unresponded concerns on your record (${unrespondedConcerns.length}):`,
    );
    lines.push(
      '  (no follow-up yet references these; tool shows them but does not',
    );
    lines.push(
      '   judge whether your eventual response addresses them — `gate chain`',
    );
    lines.push('   walks references if you want to verify coverage)');
    for (const entry of unrespondedConcerns) {
      lines.push(
        `  - ${entry.request_id}: "${truncate(entry.action, 72)}"`,
      );
      for (const c of entry.concerns) {
        lines.push(
          `      [${c.lense}/${c.verdict}] by ${c.by} (${c.age_days}d ago)`,
        );
      }
    }
  }

  if (suggested) {
    // If multiple loops share the top-urgency type, the suggestion
    // picks one arbitrarily from the head of the sorted list.
    // Surface the count so the agent knows not to rubber-stamp it.
    const topType = openLoops[0]?.type;
    const sameTypeCount = openLoops.filter((l) => l.type === topType).length;
    const peerHint =
      sameTypeCount > 1
        ? ` (1 of ${sameTypeCount} loops of this type — review the full list above before following)`
        : '';
    lines.push('');
    const argsStr = Object.entries(suggested.args)
      .map(([k, v]) => `--${k} ${v}`)
      .join(' ');
    lines.push(`Suggested next: gate ${suggested.verb} ${argsStr}${peerHint}`);
    lines.push(`  reason: ${suggested.reason}`);
  } else if (openLoops.length === 0) {
    lines.push('');
    lines.push(
      'Nothing is waiting — pick up fresh work (`gate pending`) or file a new request.',
    );
    // resume is a same-actor continuation lense: it reconstructs what
    // THIS actor was doing. Cross-actor signals (inbox unread,
    // named-as-`--with` on someone else's request, etc.) are not part
    // of its scope by design. Point at `gate boot` so a newcomer who
    // ran resume as part of a handoff doesn't walk away thinking
    // there's no work — the incoming work is in boot's orientation
    // payload.
    lines.push(
      'If you just arrived on this content_root, try `gate boot` — it surfaces cross-actor work (inbox, assignments, pair-mode partners) that resume does not.',
    );
  }

  return lines.join('\n');
}

function composeRestorationProseJa(ctx: {
  actor: string;
  lastUtterance: Utterance | null;
  lastTransition: (StatusLogEntry & { request_id: string }) | null;
  openLoops: readonly OpenLoop[];
  unrespondedConcerns: ReadonlyArray<UnrespondedConcernsEntry>;
  suggested: SuggestedNext | null;
}): string {
  const { actor, lastUtterance, lastTransition, openLoops, unrespondedConcerns, suggested } = ctx;
  const lines: string[] = [];
  lines.push(`# ${actor} として再開`);
  lines.push('');

  if (lastUtterance) {
    const age = ageHint(lastUtterance.at, new Date().toISOString());
    if (lastUtterance.kind === 'review') {
      const proxyHint = lastUtterance.invokedBy
        ? `（${lastUtterance.invokedBy} が代行）`
        : '';
      lines.push(
        `直近の発話 (utterance, ${age}): req=${lastUtterance.requestId} へのレビュー — [${lastUtterance.lense}/${lastUtterance.verdict}]${proxyHint}:`,
      );
      lines.push(`  「${truncate(lastUtterance.comment, 240)}」`);
    } else if (lastUtterance.kind === 'thank') {
      const proxyHint = lastUtterance.invokedBy
        ? `（${lastUtterance.invokedBy} が代行）`
        : '';
      lines.push(
        `直近の発話 (utterance, ${age}): req=${lastUtterance.requestId} への感謝 → ${lastUtterance.to}${proxyHint}:`,
      );
      lines.push(`  re: ${truncate(lastUtterance.action, 120)}`);
      if (lastUtterance.reason !== undefined) {
        lines.push(`  「${truncate(lastUtterance.reason, 200)}」`);
      }
    } else {
      const withHint =
        lastUtterance.with && lastUtterance.with.length > 0
          ? `（${lastUtterance.with.join('、')} と一緒に）`
          : '';
      const proxyHint = lastUtterance.invokedBy
        ? `（${lastUtterance.invokedBy} が代行）`
        : '';
      lines.push(
        `直近の発話 (utterance, ${age}): req=${lastUtterance.requestId} の起票${proxyHint}${withHint}:`,
      );
      lines.push(`  action: ${truncate(lastUtterance.action, 120)}`);
      if (lastUtterance.completionNote) {
        lines.push(`  note:   ${truncate(lastUtterance.completionNote, 240)}`);
      }
    }
  } else {
    lines.push(`この content_root にあなたの発話はまだなし — 新規参加です。`);
  }

  if (
    lastTransition &&
    (!lastUtterance || lastTransition.at !== lastUtterance.at)
  ) {
    const age = ageHint(lastTransition.at, new Date().toISOString());
    const proxy = lastTransition.invokedBy
      ? `（${lastTransition.invokedBy} が代行）`
      : '';
    lines.push('');
    lines.push(
      `直近の所作 (transition, ${age}): req=${lastTransition.request_id} → ${lastTransition.state}${proxy}${lastTransition.note ? ` — ${truncate(lastTransition.note, 180)}` : ''}`,
    );
  }

  if (openLoops.length > 0) {
    lines.push('');
    lines.push(`あなた待ちの open loop (${openLoops.length} 件):`);
    for (const loop of openLoops) {
      const label = loopLabel(loop.type, 'ja');
      lines.push(
        `  - [${loop.age_hint}] ${loop.id} (${loop.role}): ${label} — 「${truncate(loop.action, 80)}」`,
      );
    }
  } else {
    lines.push('');
    lines.push('open loop なし — あなたは誰もブロックしていません。');
  }

  if (unrespondedConcerns.length > 0) {
    lines.push('');
    lines.push(
      `未応答の concern (${unrespondedConcerns.length} 件):`,
    );
    lines.push(
      '  （これらを参照する後続 request/issue はまだ無い。tool は',
    );
    lines.push(
      '   「参照が無い」ことだけ示し、応答が concern を addressed したか',
    );
    lines.push(
      '   は判断しない — カバレッジ確認には `gate chain` を使う）',
    );
    for (const entry of unrespondedConcerns) {
      lines.push(
        `  - ${entry.request_id}: 「${truncate(entry.action, 72)}」`,
      );
      for (const c of entry.concerns) {
        lines.push(
          `      [${c.lense}/${c.verdict}] by ${c.by} (${c.age_days} 日前)`,
        );
      }
    }
  }

  if (suggested) {
    const topType = openLoops[0]?.type;
    const sameTypeCount = openLoops.filter((l) => l.type === topType).length;
    const peerHint =
      sameTypeCount > 1
        ? `（同種 ${sameTypeCount} 件中の1件 — 上のリストを確認してから）`
        : '';
    lines.push('');
    const argsStr = Object.entries(suggested.args)
      .map(([k, v]) => `--${k} ${v}`)
      .join(' ');
    lines.push(`次の一手: gate ${suggested.verb} ${argsStr}${peerHint}`);
    lines.push(`  理由: ${suggested.reason}`);
  } else if (openLoops.length === 0) {
    lines.push('');
    lines.push(
      '待ちなし — `gate pending` で新しい仕事を拾うか、`gate request` で起票を。',
    );
    lines.push(
      'この content_root に初めて降り立ったのなら `gate boot` を — resume が見ていない cross-actor の信号 (inbox、アサイン、pair-mode) が見える。',
    );
  }

  return lines.join('\n');
}

function loopLabel(type: OpenLoop['type'], locale: 'en' | 'ja'): string {
  if (locale === 'ja') {
    switch (type) {
      case 'awaiting_execution':
        return 'approved 済み、あなたの着手待ち';
      case 'executing':
        return '着手済み、未完了';
      case 'pending_review':
        return 'completed 済み、あなたのレビュー待ち';
      case 'unreviewed_completion':
        return 'あなたの仕事は完了、レビュアー待ち';
    }
  }
  switch (type) {
    case 'awaiting_execution':
      return 'approved, waiting for you to execute';
    case 'executing':
      return 'you started; not yet completed';
    case 'pending_review':
      return 'completed, waiting for your review';
    case 'unreviewed_completion':
      return 'your work is done but your reviewer has not weighed in';
  }
}

function truncate(s: string, max: number): string {
  const arr = Array.from(s);
  if (arr.length <= max) return s;
  return arr.slice(0, max - 3).join('') + '...';
}
