import { ParsedArgs, optionalOption } from '../../shared/parseArgs.js';
import { C } from './internal.js';
import { deriveBootSuggestedNext, BootSuggestedNext } from './boot.js';

/**
 * gate suggest [--format json|text]
 *
 * The tight-loop sibling of `gate boot`. Returns ONLY the
 * suggested_next triple (or null) — no tail, no utterances, no
 * health check, no inbox unread. Designed for the pattern:
 *
 *   while s=$(gate suggest --format json);
 *         verb=$(echo $s | jq -r '.verb // "null"');
 *         [ "$verb" != "null" ]; do
 *     # dispatch s.verb with s.args, then loop
 *   done
 *
 * `gate boot` remains the orientation call: the comprehensive
 * snapshot an agent wants once per session. `gate suggest` is the
 * hot-loop call: what's the ONE next thing, right now, based on the
 * same priority ladder boot already uses.
 *
 * Reuses deriveBootSuggestedNext so the two calls cannot diverge —
 * if boot suggests X, suggest suggests X, and vice versa.
 */

interface SuggestPayload {
  suggested_next: BootSuggestedNext | null;
}

export async function suggestCmd(c: C, args: ParsedArgs): Promise<number> {
  const format = optionalOption(args, 'format') ?? 'json';
  if (format !== 'json' && format !== 'text') {
    throw new Error(`--format must be 'json' or 'text', got: ${format}`);
  }

  const envActor = process.env['GUILD_ACTOR'];
  const actor = envActor && envActor.length > 0 ? envActor : null;

  // Role resolution mirrors bootCmd. Suggest must succeed without an
  // identity so tool layers can probe `gate suggest` from a cold
  // session and still get the register/export onboarding hint.
  const members = await c.memberUC.list();
  let role: 'member' | 'host' | 'unknown' | null = null;
  if (actor) {
    const actorLower = actor.toLowerCase();
    const isMember = members.some((m) => m.name.value === actorLower);
    const isHost = c.config.hostNames.includes(actorLower);
    role = isMember ? 'member' : isHost ? 'host' : 'unknown';
  }

  const allRequests = await c.requestUC.listAll();
  const suggestion = deriveBootSuggestedNext(actor, role, members, allRequests);

  const payload: SuggestPayload = { suggested_next: suggestion };

  if (format === 'json') {
    process.stdout.write(JSON.stringify(payload) + '\n');
  } else {
    if (suggestion === null) {
      process.stdout.write('(nothing urgent)\n');
    } else {
      // Compact text form: one line for verb + args, one for reason,
      // one trailing advisory footer. The footer goes to stderr so
      // stdout stays clean for `$(gate suggest ...)` shell composition
      // but a human scanning the terminal still sees it next to the
      // output. Keeps the reminder that suggested_next is a heuristic
      // at the point where the user reads the suggestion.
      const argsStr = Object.entries(suggestion.args)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      process.stdout.write(`→ ${suggestion.verb} ${argsStr}\n`);
      process.stdout.write(`  ${suggestion.reason}\n`);
      process.stderr.write('# advisory — override freely\n');
    }
  }
  return 0;
}
