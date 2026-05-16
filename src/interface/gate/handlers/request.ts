// Request creation + fast-track handlers.
//
// Originally request.ts mixed all gate-request verbs (create, list,
// show, lifecycle, fast-track) in a single 1656-line module. During
// the 2026-05-13 split (#3xx) read-side (list/show/text-format) moved
// to requestReads.ts and state-transition handlers (approve / deny /
// execute / complete / fail) moved to requestLifecycle.ts. What
// remains here is the wave's two entry-creating verbs (`request` and
// `fast-track`) plus the input-list parsers they both rely on.
//
// `parseExecutorsList` is exported because `handlers/issues.ts`
// imports it for its own `--executors` validation on issue promotion.

import { resolveGuildActor } from '../../shared/resolveGuildActor.js';
import { resolveGuildSessionId } from '../../shared/resolveGuildSessionId.js';
import {
  ParsedArgs,
  requireOption,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import {
  fireBeforeHook,
  fireAfterHook,
  emitHookVeto,
} from '../../../application/plugin/HookBus.js';
import { AgoraPlayBridge } from '../../../application/request/AgoraPlayBridge.js';
import { PlayIdAmbiguous } from '../../../passages/agora/interface/handlers/resolvePlay.js';
import {
  C,
  readStdin,
  deriveInvokedBy,
  emitInvokedByNotice,
  resolveInvokedBy,
  normalizeActor,
} from './internal.js';
import { emitWriteResponse } from './writeFormat.js';
import { parseFormat } from '../../shared/parseFormat.js';
import { renderVoice } from '../../shared/voiceRender.js';

// Known flags per write-verb. Silent-ignore of unknown flags (e.g.
// `--executr noir` instead of `--executor noir`) would let a typo
// slip through as "no executor assigned" with no error — the exact
// fail-open class that `tail` already opts into. See
// i-2026-04-22-0001 (hiroba) / devil review 2026-04-22-0001.
const REQUEST_CREATE_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'from',
  'action',
  'reason',
  'executors',
  'target',
  'depth',
  'auto-review',
  'with',
  'format',
  // from-agora <play_id> bridges an agora-play most-recent suspension
  // cliff/invitation into action/reason (issue #232). The `game` flag
  // disambiguates cross-game play-id collisions (each agora game uses
  // its own per-day sequence, so two games can both produce a
  // YYYY-MM-DD-001) — same shape as the agora cliff verb game flag.
  // (Apostrophes and backticks intentionally avoided in this comment:
  // the schema drift detector parses Set-body string literals via a
  // quote-pair regex (single, double, OR backtick), so any quote
  // character in a comment can pair with one further down and slurp
  // the in-between text into a fake flag entry. See
  // schemaInputDriftDetector.test.ts.)
  'from-agora',
  'game',
  // #235 wave-brief template registry: --template name expands a brief
  // skeleton; explicit --action and --reason override the defaults.
  // Mutually exclusive with --from-agora (both supply action/reason
  // defaults; combining them would make precedence ambiguous).
  'template',
]);
const FAST_TRACK_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'from',
  'action',
  'reason',
  'executors',
  'auto-review',
  'note',
  'with',
  'format',
]);

export async function reqCreate(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, REQUEST_CREATE_KNOWN_FLAGS, 'request');
  const from = normalizeActor(
    requireOption(args, 'from', '<m>', 'GUILD_ACTOR'),
  );
  // --from-agora <play_id> (#232): when present, lifts the play's
  // most-recent cliff/invitation into action/reason. Either flag may
  // still be supplied explicitly to override the corresponding lift
  // (action override → invitation lift dropped; reason override →
  // cliff lift dropped). Plain `gate request` (no --from-agora) keeps
  // the historical require-both contract.
  const fromAgoraRaw = optionalOption(args, 'from-agora');
  const gameFilter = optionalOption(args, 'game');
  // --game without --from-agora is meaningless on `gate request`
  // (the gate request surface has no other use for a game qualifier).
  // Refuse up front rather than silently ignoring — silent ignore is
  // the same fail-open class rejectUnknownFlags exists to prevent.
  if (gameFilter !== undefined && fromAgoraRaw === undefined) {
    process.stderr.write(
      `error: --game requires --from-agora <play_id> ` +
        `(--game disambiguates cross-game play-id collisions; it has ` +
        `no meaning on a plain gate request).\n`,
    );
    return 1;
  }

  // #235 — wave-brief template skeleton expansion.
  // When `--template <name>` is supplied, the template's `intended_use`
  // becomes the default `--reason`, and a `wave-brief: <name>` summary
  // becomes the default `--action`. Explicit `--action` / `--reason`
  // override the skeleton; the template stamp itself (template name,
  // version, gate-required acknowledgement) survives caller overrides.
  //
  // Mutex with --from-agora: both supply action/reason defaults, so
  // combining them would make precedence ambiguous (does the play's
  // invitation win, or the template's wave-brief stub?). Refuse up
  // front rather than silently picking one — same fail-open class
  // rejectUnknownFlags is built to prevent.
  const templateName = optionalOption(args, 'template');
  if (templateName !== undefined && fromAgoraRaw !== undefined) {
    process.stderr.write(
      `error: --template and --from-agora are mutually exclusive ` +
        `(both supply default --action / --reason; precedence would be ` +
        `ambiguous). Pick one: use --template <name> for a wave-brief ` +
        `skeleton, or --from-agora <play_id> to bridge an agora play.\n`,
    );
    return 1;
  }
  let templateMeta:
    | { name: string; version: number; intendedUse: string; gateRequired: boolean }
    | undefined;
  if (templateName !== undefined) {
    const t = c.templateUC.show(templateName);
    if (!t) {
      const available = c.templateUC.list().map((s) => s.name);
      const hint =
        available.length === 0
          ? `  (registry empty at ${c.templateUC.registryDir()})`
          : `  available: ${available.join(', ')}`;
      process.stderr.write(`error: unknown template "${templateName}"\n${hint}\n`);
      return 1;
    }
    templateMeta = {
      name: t.name,
      version: t.version,
      intendedUse: t.intendedUse,
      gateRequired: t.gateRequired,
    };
  }

  const actionRaw = optionalOption(args, 'action');
  let reasonRaw = optionalOption(args, 'reason');
  // `--reason -` reads from stdin — parity with `gate review --comment -`.
  // Trim because heredoc / echo append a trailing newline that clutters
  // the rendered status_log note.
  if (reasonRaw === '-') reasonRaw = (await readStdin()).trim();

  let action: string;
  let reason: string;
  let sourceAgoraPlay: string | undefined;

  if (fromAgoraRaw !== undefined) {
    const bridge = new AgoraPlayBridge(c.playRepo, c.config);
    let result;
    try {
      result = await bridge.resolve(fromAgoraRaw, gameFilter);
    } catch (err) {
      if (err instanceof PlayIdAmbiguous) {
        // Surface the same shape `agora cliff` does on cross-game
        // collision — let the caller's outer envelope catch it. Re-
        // throwing keeps a single source of truth for the message.
        throw err;
      }
      throw err;
    }
    if (!result.ok) {
      const r = result.refusal;
      switch (r.kind) {
        case 'invalid_id':
          process.stderr.write(
            `error: --from-agora "${r.raw}": ${r.detail}\n` +
              `  hint: play ids look like 2026-05-08-001 (YYYY-MM-DD-NNN).\n`,
          );
          return 1;
        case 'not_found':
          process.stderr.write(
            `error: --from-agora ${r.playId}: play not found in ${r.agoraRoot}/agora.\n` +
              `  next: list candidates with \`agora list\` or check the play id.\n`,
          );
          return 1;
        case 'concluded':
          process.stderr.write(
            `error: --from-agora ${r.playId}: play is concluded (game=${r.game}); ` +
              `cannot bridge a closed thread into a new request.\n` +
              `  next: open a fresh play (\`agora play --game ${r.game}\`) or ` +
              `file the request without --from-agora.\n`,
          );
          return 1;
        case 'no_suspension':
          process.stderr.write(
            `error: --from-agora ${r.playId}: play has no suspension on record ` +
              `(state=${r.state}, game=${r.game}); nothing to bridge.\n` +
              `  next: \`agora suspend ${r.playId} --cliff "..." --invitation "..."\` ` +
              `to record a cliff first, or file the request without --from-agora.\n`,
          );
          return 1;
      }
    }
    const lift = result.value;
    sourceAgoraPlay = lift.playId;
    // Lift policy (#232):
    //   action  ← invitation  (the "what to do next" half — matches
    //                          gate request's action semantics)
    //   reason  ← cliff       (the "why / what was happening" half —
    //                          matches gate request's reason semantics)
    // Either explicit flag overrides its corresponding lift; the lifted
    // half on the other axis is preserved. The structural sourceAgoraPlay
    // record is kept regardless of overrides because the link is the
    // point of the bridge — a request derived from a play stays linked
    // even when the operator rewrote both fields.
    action = actionRaw !== undefined && actionRaw.trim().length > 0
      ? actionRaw
      : lift.invitation;
    reason = reasonRaw !== undefined && reasonRaw.trim().length > 0
      ? reasonRaw
      : lift.cliff;
  } else if (templateMeta !== undefined) {
    // #235 — template skeleton path. Defaults derive from the template;
    // explicit --action / --reason override. The template stamp itself
    // (name + version + gate_required ack) is set further below and
    // survives any caller override of action/reason.
    action =
      actionRaw !== undefined && actionRaw.trim().length > 0
        ? actionRaw
        : `wave-brief: ${templateMeta.name}`;
    if (reasonRaw !== undefined && reasonRaw.trim().length > 0) {
      reason = reasonRaw;
    } else if (templateMeta.intendedUse.length > 0) {
      reason = templateMeta.intendedUse;
    } else {
      reason = `wave-brief template ${templateMeta.name} (v${templateMeta.version})`;
    }
  } else {
    // Plain `gate request` — action/reason are both required, same
    // contract as before #232. requireOption surfaces the usage hint
    // when missing; we re-call it here so the error message stays
    // identical to the historical one.
    action = requireOption(args, 'action', '"..."');
    reason = requireOption(args, 'reason', '"..."');
    if (reason === '-') reason = (await readStdin()).trim();
  }
  const input: Parameters<typeof c.requestUC.create>[0] = {
    from,
    action,
    reason,
  };
  if (sourceAgoraPlay !== undefined) input.sourceAgoraPlay = sourceAgoraPlay;
  if (templateMeta !== undefined) {
    input.template = templateMeta.name;
    input.templateVersion = templateMeta.version;
    input.gateRequiredAcknowledged = true;
  }
  const executorsRaw = optionalOption(args, 'executors');
  const target = optionalOption(args, 'target');
  const depth = optionalOption(args, 'depth');
  const autoReview = optionalOption(args, 'auto-review');
  const withPartners = parseWithList(optionalOption(args, 'with'));
  if (executorsRaw !== undefined) {
    const parsed = parseExecutorsList(executorsRaw);
    if (parsed.error) {
      process.stderr.write(`error: --executors ${parsed.error}\n`);
      return 1;
    }
    if (parsed.list.length > 0) input.executors = parsed.list;
  }
  if (target !== undefined) input.target = target;
  // Worktree-isolation gating (#231). Two effects, both keyed on
  // "is this a parallel wave?" (executors.length > 1):
  //   - profile=swarm  → stamp `requires_worktree_isolation: true`
  //                       so `gate execute` later refuses a same-cwd
  //                       collision (filesystem-layer guard).
  //   - profile=standard → emit a warning notice (no stamp).
  // Single-executor requests are never gated, regardless of profile —
  // there is no race to gate against.
  const parallelExecutors =
    Array.isArray(input.executors) && input.executors.length > 1;
  if (parallelExecutors) {
    if (c.config.features.worktreeRequiredForParallel) {
      input.requiresWorktreeIsolation = true;
    } else {
      process.stderr.write(
        `notice: parallel executors (${input.executors!.length}) under ` +
          `profile=${c.config.profile} — same-cwd collisions are NOT refused. ` +
          `Set 'profile: swarm' (or 'features.worktree_required_for_parallel: true') ` +
          `in guild.config.yaml to enforce per-cwd isolation.\n`,
      );
    }
  }
  // #235 — profile=swarm gating for parallel-shaped templates. Stub:
  // the brief catalogue carries `template_name` like `parallel-impl`
  // / `compare-and-ratify` that imply >1 executor; under swarm we
  // *should* require `--template` for parallel-executor waves so the
  // brief is on record. Phase 1 emits a warning notice only;
  // enforcement (refuse without --template) is the follow-up. Single-
  // executor and standard-profile callers are silent.
  if (
    c.config.profile === 'swarm' &&
    parallelExecutors &&
    templateMeta === undefined
  ) {
    process.stderr.write(
      `notice: parallel executors under profile=swarm without --template ` +
        `(#235 phase 1: warning only; enforcement is follow-up). ` +
        `Consider \`gate templates list\` to find a wave-brief template, ` +
        `or pass --template <name> when filing this request.\n`,
    );
  }
  // depth (issue #221): pre-check at the interface boundary so the
  // caller sees a flag-shaped error before the domain layer fires.
  // The advisory framing — 'shallow ⇒ surface point-check, deep ⇒
  // arch / threat model' — lives in `gate request --help` and the
  // schema description. Per principle 02, the value is advisory:
  // the substrate carries it through, the reviewer agent is the one
  // who chooses whether to honour it.
  if (depth !== undefined) {
    if (depth !== 'shallow' && depth !== 'standard' && depth !== 'deep') {
      process.stderr.write(
        `error: --depth must be one of shallow|standard|deep, got: ${depth}\n`,
      );
      return 1;
    }
    input.depth = depth;
  }
  if (autoReview !== undefined) input.autoReview = autoReview;
  if (withPartners.length > 0) input.with = withPartners;
  // Request creation is a proxy-eligible verb same as approve/review:
  // when GUILD_ACTOR differs from --from, the agent is filing on a
  // member's behalf. Derive the invoker pre-create so it lands on
  // the initial status_log entry; emit the stderr notice after the
  // id is allocated.
  const invokedBy = deriveInvokedBy(from);
  if (invokedBy !== undefined) input.invokedBy = invokedBy;
  // Boot-context session_id (#249 slice 2). Read GUILD_SESSION_ID via
  // the shared resolver — invalid values are treated as unset (the
  // resolver emits a one-time stderr notice). Absence stays absent on
  // disk so pre-#249 records and same-body unstamped writes both
  // round-trip byte-identical YAML.
  const sessionId = resolveGuildSessionId();
  if (sessionId !== undefined) input.openedBySession = sessionId;
  const r = await c.requestUC.create(input);
  if (invokedBy !== undefined) {
    emitInvokedByNotice(from, invokedBy, 'request', r.id.value);
  }
  // Self-wave fast-track hint (#228 sub-task 3). When the author lists
  // themselves as the (only) executor — "I'm filing AND running this"
  // — surface `gate fast-track` as a one-shot shortcut alongside the
  // normal approve. Discoverability lives at the *request* moment so
  // the author sees it before the approve step, not just at the
  // self-approve warning later. Only fires for the truly self-only
  // shape (single executor, equal to from); pair waves and external
  // executors keep the standard suggested_next without a fast-track
  // nudge. Text mode only — JSON consumers read suggested_next, which
  // already pre-fills approve with the host actor.
  const executorList = r.executors.map((m) => m.value);
  // executorList[0] is already MemberName.value (canonical: trim+lower).
  // from is raw CLI input — normalize via trim+lower so whitespace
  // padding (`--from 'alice '`) doesn't hide a true self-wave.
  const isSelfWave =
    executorList.length === 1 &&
    executorList[0]! === from.trim().toLowerCase();
  const extraLines: string[] = [];
  if (isSelfWave) {
    extraLines.push(
      `  suggested_next: gate approve ${r.id.value} ` +
        `(or gate fast-track for the self-flow shortcut)`,
    );
  }
  emitWriteResponse(
    parseFormat(args),
    r,
    `✓ created: ${r.id.value} (state=pending)`,
    c.config,
    extraLines,
  );
  return 0;
}

/**
 * Parse `--with eris,alice` (comma-separated) into a clean string list.
 * Empty entries and whitespace-only entries are dropped so
 * `--with "eris, , alice"` behaves the way it reads. Exact name
 * validation happens upstream (MemberName.of / assertActor).
 */
/**
 * Parse `--executors a,b,c` (issue #230) into a clean string list with
 * structural validation done at the interface boundary so the user sees
 * a flag-shaped error before any domain hydration occurs.
 *
 * Rules (per spec):
 *   - Empty / whitespace-only entry  → error  (`--executors miki,` is a typo, not "no second")
 *   - Duplicate entry                → error  (silent dedupe would mask the typo)
 *   - Per-entry charset              → MemberName.of validates regex / reserved names
 *
 * Returns either `{ list, error: undefined }` on success or
 * `{ list: [], error: <message> }` on failure. Caller writes the
 * message to stderr and returns exit 1.
 */
export function parseExecutorsList(
  raw: string,
): { list: string[]; error?: string } {
  const parts = raw.split(',').map((s) => s.trim());
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    if (p.length === 0) {
      return {
        list: [],
        error:
          'contains empty entry — comma-separated list must have no blanks ' +
          '(e.g. "miki,leysia", not "miki," or "miki,,leysia")',
      };
    }
    const lower = p.toLowerCase();
    if (seen.has(lower)) {
      return {
        list: [],
        error: `contains duplicate executor "${lower}" — each name may appear at most once`,
      };
    }
    seen.add(lower);
    out.push(p);
  }
  return { list: out };
}

function parseWithList(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function reqFastTrack(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, FAST_TRACK_KNOWN_FLAGS, 'fast-track');
  // Canonicalize the author once at entry so every downstream use
  // (executor defaulting, invoked-by surface, env-actor compare) sees
  // the same value as `Request.from` will after MemberName.of()
  // normalizes it inside the use case.
  const from = normalizeActor(
    requireOption(args, 'from', '<m>', 'GUILD_ACTOR'),
  );
  const action = requireOption(args, 'action', '"..."');
  let reason = requireOption(args, 'reason', '"..."');
  if (reason === '-') reason = (await readStdin()).trim();
  const executorsRaw = optionalOption(args, 'executors');
  const autoReview = optionalOption(args, 'auto-review');
  const note = optionalOption(args, 'note');
  const withPartners = parseWithList(optionalOption(args, 'with'));
  // Fast-track defaults to self-execute when --executors is omitted:
  // the author is the sole executor. Explicit `--executors a,b`
  // overrides for multi-executor waves (rare in fast-track, valid
  // for compress-pattern flows).
  let executorsList: readonly string[];
  if (executorsRaw !== undefined) {
    const parsed = parseExecutorsList(executorsRaw);
    if (parsed.error) {
      process.stderr.write(`error: --executors ${parsed.error}\n`);
      return 1;
    }
    executorsList = parsed.list.length > 0 ? parsed.list : [from];
  } else {
    executorsList = [from];
  }

  const createInput: Parameters<typeof c.requestUC.create>[0] = {
    from,
    action,
    reason,
    executors: executorsList,
  };
  if (autoReview !== undefined) createInput.autoReview = autoReview;
  if (withPartners.length > 0) createInput.with = withPartners;
  // Same env-driven session stamp as `gate request` — fast-track is a
  // single user-facing verb that compresses request → approve →
  // execute → complete, but the create step is the legitimate carrier
  // of `opened_by_session`.
  const fastTrackSessionId = resolveGuildSessionId();
  if (fastTrackSessionId !== undefined)
    createInput.openedBySession = fastTrackSessionId;
  const created = await c.requestUC.create(createInput);
  const id = created.id.value;

  // Fast-track is one user-facing command even though it executes
  // three transitions. Resolve the invoker once (which also prints
  // the delegation notice exactly once) and pass it to each step.
  const invokedByFrom = resolveInvokedBy(from, 'fast-track', id);
  // For the execute/complete steps fast-track needs ONE actor on
  // record. With --executors a,b the substrate genuinely doesn't know
  // which one ran the work — pick the first as the on-record actor
  // (deterministic, explicit in the assignment list) and let the
  // status_log + invoked_by capture the rest. Single-executor defaults
  // to the author (see executorsList construction above).
  const execActor = executorsList[0] ?? from;
  // `execActor` may legitimately differ from `from`; when it does we
  // don't emit a second notice here — the env actor vs executor
  // mismatch is the same delegation already surfaced above.
  const envActor = resolveGuildActor();
  const invokedByExec =
    envActor && envActor.length > 0 && envActor !== execActor
      ? envActor
      : undefined;
  // Lifecycle hook fires (#279). Fast-track is a single user-facing
  // verb that compresses three transitions; each transition is a
  // first-class lifecycle event the substrate records, so each must
  // run through the hook bus identically to the multi-step path.
  // Without these fires, `after:approve` audit-log plugins miss every
  // self-flow wave and `before:approve` policy plugins are silently
  // bypassed — exactly the path those policies were designed to govern.
  //
  // veto on any before-hook aborts the chain and exits non-zero. The
  // request stays in whatever state the chain reached before the veto
  // (pending if before:approve vetoed, approved if before:execute, ...)
  // — matching the multi-step path's contract that a vetoed transition
  // leaves the substrate in the pre-transition state, not a synthetic
  // "fast-track aborted" state. Re-running the user-side multi-step
  // path is the recovery from a partial fast-track.
  const beforeApproveVeto = await fireBeforeHook(c.hookSubscriptions, 'approve', created, from);
  if (beforeApproveVeto) return emitHookVeto('approve', id, beforeApproveVeto);
  const approved = await c.requestUC.approve(id, from, 'fast-track: self-approved', invokedByFrom);
  await fireAfterHook(c.hookSubscriptions, 'approve', approved, from);

  const beforeExecuteVeto = await fireBeforeHook(c.hookSubscriptions, 'execute', approved, execActor);
  if (beforeExecuteVeto) return emitHookVeto('execute', id, beforeExecuteVeto);
  const executing = await c.requestUC.execute(id, execActor, 'fast-track: self-executed', invokedByExec);
  await fireAfterHook(c.hookSubscriptions, 'execute', executing, execActor);

  const beforeCompleteVeto = await fireBeforeHook(c.hookSubscriptions, 'complete', executing, execActor);
  if (beforeCompleteVeto) return emitHookVeto('complete', id, beforeCompleteVeto);
  const completed = await c.requestUC.complete(id, execActor, note, invokedByExec);
  await fireAfterHook(c.hookSubscriptions, 'complete', completed, execActor);

  const extraLines: string[] = [];
  if (completed.autoReview) {
    const reviewer = completed.autoReview.value;
    const tpl =
      `gate review ${id} --by ${reviewer} --lense devil ` +
      `--verdict <ok|concern|reject> "<comment>"`;
    extraLines.push(`→ auto-review pending for: ${reviewer}`);
    extraLines.push(`  ${tpl}`);
  }
  // Ornamental voice on fast-track: dogfood-driven addition (#382
  // follow-up). fast-track is the daily-use shortcut; with the v1
  // wire-up only firing on `gate complete` direct invocation, the
  // most common write surface was silent. Voice fires on the
  // `complete` segment of the chain — same semantic as gate complete
  // proper. (#37x — eris-first refinement polish PR-A1)
  const voice = renderVoice(c.voicePlugins, 'complete', completed, c.config);
  emitWriteResponse(
    parseFormat(args),
    completed,
    `✓ fast-tracked: ${id} (pending→completed)`,
    c.config,
    extraLines,
    { voice },
  );
  return 0;
}
