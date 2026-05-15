// gate next — one-call read-and-dispatch of the top actionable verb.
//
// Composes `boot.verbs_available_now.actionable[0]` (read) with verb
// dispatch (write) so an agent loop can chain `gate boot && gate
// next --confirm` to drain its actionable ladder. Without --confirm,
// the verb is a read: it prints the plan but does not mutate.
//
// Auto-dispatch is gated on whether the actionable verb needs only
// `--by <actor>` (the common simple case). Verbs that require
// additional input (`review` needs `--lense`/`--verdict`/`--comment`;
// `deny`/`fail` need `--reason`) are NOT auto-dispatched — the
// handler surfaces the missing args and exits non-zero, leaving the
// caller to invoke the verb manually with the right inputs.
//
// Exit codes (matches the "drain in a loop" idiom):
//   0   — plan rendered (read) or dispatched (write) with the
//         dispatched verb's own exit 0.
//   1   — gate next itself errored (bad args, no actor, etc.).
//   2   — no actionable: nothing for `gate next` to do.
//   >2  — the dispatched verb exited with that code; passed through
//         unchanged so failure modes stay visible.
//
// Pattern doc: memory/eris_first_overrides.md default rubric
// (pure shape, AI-first universal, no eris-specific content).
// Sibling of `gate boot --since` and the structured `error.recovery`
// surface — same family of "agent loop ergonomics" improvements.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { maybeEmitExplain } from '../../shared/explain.js';
import { resolveGuildActor } from '../../shared/resolveGuildActor.js';
import { C } from './internal.js';
import {
  deriveBootSuggestedNext,
} from './bootActionable.js';
// `deriveVerbsAvailableNow` is not exported from boot.ts's surface
// re-exports today; import directly from the derivation module so
// `gate next` reads the same actionable ladder bootCmd assembles.
import { deriveVerbsAvailableNow } from './bootActionable.js';
import { parseFormat } from '../../shared/parseFormat.js';

const NEXT_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'confirm',
  'format',
]);

// Verbs whose actionable entry needs only `--by <actor>` to dispatch.
// Everything else needs caller-supplied input (--reason / --lense /
// --verdict / --comment) and is NOT auto-dispatched — the handler
// surfaces the missing flags and refuses. The list is conservative
// on purpose: better to refuse a dispatch than to send a half-
// populated mutation.
const AUTO_DISPATCHABLE: ReadonlySet<string> = new Set([
  'complete',
  'execute',
  'approve',
  'show', // read-only, no --by needed; still safe to auto-dispatch
]);

// Verbs that genuinely need extra args from the caller. Named here
// so the refusal message can list which flags would have to be
// supplied — better friction than just "can't dispatch".
const NEEDS_EXTRA_ARGS: Record<string, readonly string[]> = {
  review: ['--lense <l>', '--verdict <v>', '--comment "<c>"'],
  deny: ['--reason "<r>"'],
  fail: ['--reason "<r>"'],
};

interface Plan {
  verb: string;
  id: string;
  reason: string;
  by: string;
  /** Whether `gate next --confirm` will run this verb automatically. */
  can_auto_dispatch: boolean;
  /** When `can_auto_dispatch` is false, the flags the caller must supply. */
  needs_extra_args?: readonly string[];
  /** A copy-paste-ready command line for human inspection. */
  command: string;
}

export async function nextCmd(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, NEXT_KNOWN_FLAGS, 'next');
  maybeEmitExplain(args, 'next');
  const format = parseFormat(args);
  const confirm = args.options['confirm'] === true;

  const envActor = resolveGuildActor();
  const actor = envActor && envActor.length > 0 ? envActor : null;
  if (actor === null) {
    // No GUILD_ACTOR — boot would suggest `export GUILD_ACTOR=...`,
    // but `next` is specifically about actor-scoped actionable work.
    // Refuse rather than auto-dispatch a meaningless suggestion.
    process.stderr.write(
      'error: GUILD_ACTOR is not set. ' +
        'Set it before asking gate next what to do — the actionable ' +
        'ladder is actor-scoped.\n' +
        '  next: export GUILD_ACTOR=<your-name>\n',
    );
    return 1;
  }

  // Reuse boot's derivation modules so the actionable ladder gate
  // next dispatches from is byte-identical to what `gate boot` shows.
  // No re-implementation, no drift.
  const members = await c.memberUC.list();
  const actorLower = actor.toLowerCase();
  const isMember = members.some((m) => m.name.value === actorLower);
  const isHost = c.config.hostNames.includes(actorLower);
  const role: 'member' | 'host' | 'unknown' = isMember
    ? 'member'
    : isHost
      ? 'host'
      : 'unknown';
  if (role === 'unknown') {
    process.stderr.write(
      `error: GUILD_ACTOR=${actor} is not a registered member or host. ` +
        `gate boot would suggest registering — run that first.\n` +
        `  next: gate register --name ${actor}\n`,
    );
    return 1;
  }

  const allRequests = await c.requestUC.listAll();
  const verbs = deriveVerbsAvailableNow(
    actor,
    role,
    allRequests,
    c.config.hostNames,
  );

  // Pick the top actionable. Fall back to suggested_next when the
  // actionable list is empty — register/export hints surface here
  // as plans even though they're not "verbs" per se. They're not
  // auto-dispatchable (they need caller input or are shell builtins),
  // so they always print and never run.
  const top = verbs.actionable[0];
  if (!top) {
    const fallback = deriveBootSuggestedNext(actor, role, members, allRequests);
    if (!fallback) {
      // Nothing to do.
      if (format === 'json') {
        process.stdout.write(JSON.stringify({ plan: null, dispatched: false }, null, 2) + '\n');
      } else {
        process.stdout.write('(no actionable work for ' + actor + ')\n');
      }
      return 2;
    }
    // Render the suggested_next as a non-dispatchable plan.
    const plan: Plan = {
      verb: fallback.verb,
      id: typeof fallback.args['id'] === 'string' ? fallback.args['id'] : '',
      reason: fallback.reason,
      by: actor,
      can_auto_dispatch: false,
      needs_extra_args: ['(see boot.suggested_next.reason for orientation)'],
      command: renderCommand(fallback.verb, fallback.args),
    };
    emitPlan(plan, format, confirm);
    return 2;
  }

  // Build the dispatch plan from the actionable[0] entry.
  const canAuto = AUTO_DISPATCHABLE.has(top.verb);
  const plan: Plan = {
    verb: top.verb,
    id: top.id,
    reason: top.reason,
    by: actor,
    can_auto_dispatch: canAuto,
    ...(canAuto
      ? {}
      : { needs_extra_args: NEEDS_EXTRA_ARGS[top.verb] ?? ['(verb-specific args required)'] }),
    command: renderActionableCommand(top.verb, top.id, actor),
  };

  if (!confirm) {
    emitPlan(plan, format, false);
    return 0;
  }

  if (!canAuto) {
    emitPlan(plan, format, true);
    process.stderr.write(
      `error: '${top.verb}' needs caller-supplied args and won't be ` +
        `auto-dispatched. Run the command shown above with your inputs filled in.\n`,
    );
    return 1;
  }

  // Dispatch via subprocess so the verb runs through its normal code
  // path (rejectUnknownFlags, hooks, write guards) without `gate next`
  // re-implementing any of it. Subprocess overhead (~50ms per spawn)
  // is acceptable for a meta-verb sitting at the agent-loop boundary.
  const gatePath = resolveGateEntry();
  const argv = buildDispatchArgv(top.verb, top.id, actor);
  if (format !== 'json') {
    process.stdout.write(`→ running: ${plan.command}\n\n`);
  }
  const result = spawnSync(process.execPath, [gatePath, ...argv], {
    stdio: 'inherit',
    env: { ...process.env },
  });
  if (format === 'json') {
    const envelope = {
      plan,
      dispatched: true,
      exit_code: result.status ?? 1,
    };
    process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
  }
  return result.status ?? 1;
}

function emitPlan(plan: Plan, format: string, dispatched: boolean): void {
  if (format === 'json') {
    process.stdout.write(
      JSON.stringify({ plan, dispatched }, null, 2) + '\n',
    );
    return;
  }
  process.stdout.write(`→ next: ${plan.command}\n`);
  process.stdout.write(`  (${plan.reason})\n`);
  if (!plan.can_auto_dispatch) {
    const missing = plan.needs_extra_args ?? [];
    if (missing.length > 0) {
      process.stdout.write(
        `  (needs additional args: ${missing.join(', ')})\n`,
      );
    }
  }
}

function renderActionableCommand(
  verb: string,
  id: string,
  actor: string,
): string {
  const needsBy = verb !== 'show';
  return needsBy ? `gate ${verb} ${id} --by ${actor}` : `gate ${verb} ${id}`;
}

function renderCommand(verb: string, args: Record<string, string>): string {
  if (verb === 'export') {
    const [k, v] = Object.entries(args)[0] ?? ['GUILD_ACTOR', '<your-name>'];
    return `export ${k}=${v}`;
  }
  const argsStr = Object.entries(args)
    .map(([k, v]) => `--${k} ${v}`)
    .join(' ');
  return `gate ${verb}${argsStr ? ' ' + argsStr : ''}`;
}

function buildDispatchArgv(
  verb: string,
  id: string,
  actor: string,
): string[] {
  const out = [verb, id];
  if (verb !== 'show') {
    out.push('--by', actor);
  }
  return out;
}

function resolveGateEntry(): string {
  // Walk up from this file's compiled location (dist/src/interface/
  // gate/handlers/) to the repo root, then into bin/gate.mjs.
  // Mirrors the path other test files use; falls back to a relative
  // path if import.meta.url isn't a file URL (impossible in node, but
  // explicit-narrow keeps the type checker quiet).
  const here = dirname(fileURLToPath(import.meta.url));
  return resolvePath(here, '../../../../../bin/gate.mjs');
}
