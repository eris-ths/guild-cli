import { resolve as resolvePath } from 'node:path';
import { realpathSync } from 'node:fs';
import { resolveGuildActor } from '../../shared/resolveGuildActor.js';
import { resolveGuildSessionId } from '../../shared/resolveGuildSessionId.js';
import {
  ParsedArgs,
  requireOption,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { notFoundMessage } from '../../shared/notFoundHint.js';
import {
  fireBeforeHook,
  fireAfterHook,
  emitHookVeto,
} from '../../../application/plugin/HookBus.js';

// Known flags per write-verb. Silent-ignore of unknown flags (e.g.
// `--executr noir` instead of `--executor noir`) would let a typo
// slip through as "no executor assigned" with no error — the exact
// fail-open class that `tail` already opts into. See
// i-2026-04-22-0001 (hiroba) / devil review 2026-04-22-0001.
const REQUEST_CREATE_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'from',
  'action',
  'reason',
  'executor',
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
const APPROVE_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'note',
  'dry-run',
  'format',
]);
const DENY_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'reason',
  'note',
  'dry-run',
  'format',
]);
const EXECUTE_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'note',
  'cwd',
  'dry-run',
  'format',
]);
const COMPLETE_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'note',
  'dry-run',
  'format',
]);
const FAIL_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'reason',
  'note',
  'dry-run',
  'format',
]);
const FAST_TRACK_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'from',
  'action',
  'reason',
  'executor',
  'executors',
  'auto-review',
  'note',
  'with',
  'format',
]);
// `gate list` and `gate pending` share `reqList`. pending only takes
// `--for`; list adds the four narrowing filters. The list set is the
// superset and is used at the reqList layer; the index dispatch
// pre-checks the pending case before delegating, so unknown flags on
// `gate pending` (e.g. `--from x`) are still caught with the right
// verb name in the error.
const LIST_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'state',
  'for',
  'from',
  'executor',
  'auto-review',
  'format',
]);
const PENDING_KNOWN_FLAGS: ReadonlySet<string> = new Set(['for', 'format']);
const SHOW_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'plain',
  'format',
  'fields',
]);
import { Request } from '../../../domain/request/Request.js';
import { AgoraPlayBridge } from '../../../application/request/AgoraPlayBridge.js';
import { PlayIdAmbiguous } from '../../../passages/agora/interface/handlers/resolvePlay.js';
import { formatDelta, pushMultilineField } from '../voices.js';
import {
  C,
  readStdin,
  deriveInvokedBy,
  emitInvokedByNotice,
  resolveInvokedBy,
  isDryRun,
  emitDryRunPreview,
  normalizeActor,
} from './internal.js';
import { emitWriteResponse, parseFormat } from './writeFormat.js';

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
  const executor = optionalOption(args, 'executor');
  const executorsRaw = optionalOption(args, 'executors');
  const target = optionalOption(args, 'target');
  const depth = optionalOption(args, 'depth');
  const autoReview = optionalOption(args, 'auto-review');
  const withPartners = parseWithList(optionalOption(args, 'with'));
  // Mutual-exclusion: --executor (singular) and --executors (plural)
  // share semantics; allowing both would invite ambiguity ("which one
  // wins?") and let a typo go silent. Reject up front with a flag-
  // shaped message — same treatment as --reason vs positional reason
  // collisions elsewhere. Issue #230.
  if (executor !== undefined && executorsRaw !== undefined) {
    process.stderr.write(
      `error: --executor and --executors are mutually exclusive (got both). ` +
        `Use --executors a,b,c for multiple, or --executor <m> for one.\n`,
    );
    return 1;
  }
  if (executorsRaw !== undefined) {
    const parsed = parseExecutorsList(executorsRaw);
    if (parsed.error) {
      process.stderr.write(`error: --executors ${parsed.error}\n`);
      return 1;
    }
    if (parsed.list.length > 0) input.executors = parsed.list;
  }
  if (executor !== undefined) {
    // Deprecation: `--executor` (singular) was kept for back-compat
    // through the v0.6 cycle (#230). Removal scheduled for v0.7.0
    // (#239). Surface a notice so explicit callers migrate to
    // `--executors` ahead of the cut.
    process.stderr.write(
      `notice: --executor (singular) is deprecated and will be removed in v0.7.0; use --executors <name> instead. (issue #239)\n`,
    );
    input.executor = executor;
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

export async function reqList(
  c: C,
  state: string,
  args: ParsedArgs,
  verb: 'list' | 'pending' = 'list',
): Promise<number> {
  // Different known-flag sets per verb so a typo on `gate pending`
  // doesn't get a list-grade hint, and the error names the right verb.
  rejectUnknownFlags(
    args,
    verb === 'pending' ? PENDING_KNOWN_FLAGS : LIST_KNOWN_FLAGS,
    verb,
  );
  const fromFilter = optionalOption(args, 'from');
  const executorFilter = optionalOption(args, 'executor');
  const autoReviewFilter = optionalOption(args, 'auto-review');
  const explicitFor = optionalOption(args, 'for');
  const envActor =
    explicitFor === undefined && resolveGuildActor()
      ? resolveGuildActor()
      : undefined;
  const forFilter = explicitFor ?? envActor;

  // `--state all` is sugar for "every state, no filter" — parity with
  // `gate issues list --state all`. Implemented at the interface layer
  // because `all` is a CLI-level affordance, not a domain state;
  // parseRequestState rejects it. The asymmetry where one list verb
  // accepted the sugar and the other errored was the touch-feel gap
  // surfaced in P3 dogfood.
  let items =
    state === 'all'
      ? await c.requestUC.listAll()
      : await c.requestUC.listByState(state);
  if (fromFilter !== undefined) {
    items = items.filter((r) => r.from.value === fromFilter);
  }
  if (executorFilter !== undefined) {
    // Multi-executor (issue #230): match if the filter name appears
    // anywhere in the assigned list. Single-executor records still
    // hit because their `executors` is a one-element array.
    items = items.filter((r) =>
      r.executors.some((m) => m.value === executorFilter),
    );
  }
  if (autoReviewFilter !== undefined) {
    items = items.filter((r) => r.autoReview?.value === autoReviewFilter);
  }
  if (forFilter !== undefined) {
    items = items.filter(
      (r) =>
        r.from.value === forFilter ||
        r.executors.some((m) => m.value === forFilter) ||
        r.autoReview?.value === forFilter,
    );
  }

  if (envActor !== undefined) {
    process.stderr.write(
      `# filtered by GUILD_ACTOR=${envActor} (use --for <m> or unset GUILD_ACTOR to override)\n`,
    );
  }

  // --format closes the asymmetry surfaced in the post-merge bird's-eye
  // check (2026-05-03): every other gate read verb (board / status /
  // voices / tail / show / why / summarize) accepts --format json|text;
  // list / pending were text-only. JSON envelope mirrors board's shape:
  // top-level `requests` array of full request.toJSON(), `_meta` carries
  // the state being listed (informational for both list and pending) and
  // any active filter so a JSON consumer sees what the stderr notice
  // shows to humans.
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    throw new Error(`--format must be 'json' or 'text', got: ${format}`);
  }

  if (format === 'json') {
    const filterEcho: Record<string, string> = {};
    if (fromFilter !== undefined) filterEcho['from'] = fromFilter;
    if (executorFilter !== undefined) filterEcho['executor'] = executorFilter;
    if (autoReviewFilter !== undefined) filterEcho['auto_review'] = autoReviewFilter;
    if (forFilter !== undefined) {
      filterEcho['for'] = forFilter;
      filterEcho['for_source'] = explicitFor !== undefined ? '--for' : 'GUILD_ACTOR';
    }
    const payload: Record<string, unknown> = {
      // toRenderJSON keeps the deprecated `executor` alias visible
      // alongside the new `executors` array (issue #230 back-compat).
      requests: items.map((r) => r.toRenderJSON()),
      _meta: {
        state,
        verb,
        ...(Object.keys(filterEcho).length > 0 ? { filter: filterEcho } : {}),
      },
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return 0;
  }

  if (items.length === 0) {
    const suffix = describeFilters({
      from: fromFilter,
      executor: executorFilter,
      'auto-review': autoReviewFilter,
      for: forFilter,
    });
    process.stdout.write(`(no requests in ${state}${suffix})\n`);
    return 0;
  }
  const markerWidth = computeReviewMarkerWidth(items);
  for (const r of items) printSummary(r, markerWidth);
  return 0;
}

// Compute the widest review-marker string across a list of requests,
// returning at least the fallback minimum. Used to align the action
// column in `gate list` / `gate pending` output.
export function computeReviewMarkerWidth(
  items: ReadonlyArray<Request>,
  fallbackMin = 16,
): number {
  let max = fallbackMin;
  for (const r of items) {
    const natural = formatReviewMarkers(r.toJSON()['reviews'], 0);
    if (natural.length > max) max = natural.length;
  }
  return max + 2;
}

function describeFilters(filters: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined) parts.push(`${k}=${v}`);
  }
  return parts.length === 0 ? '' : ` with ${parts.join(', ')}`;
}

export async function reqShow(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, SHOW_KNOWN_FLAGS, 'show');
  const id = args.positional[0];
  if (!id)
    throw new Error(
      'Usage: gate show <id> [--format json|text] [--fields k1,k2,...] [--plain]',
    );
  const plain = args.options['plain'] === true;
  const format = optionalOption(args, 'format') ?? (plain ? 'plain' : 'json');
  if (format !== 'json' && format !== 'text' && format !== 'plain') {
    throw new Error(`--format must be 'json' or 'text', got: ${format}`);
  }
  const r = await c.requestUC.show(id);
  if (!r) {
    process.stderr.write(notFoundMessage('request', id));
    return 1;
  }
  const fields = optionalOption(args, 'fields');
  if (plain || format === 'plain') {
    // --plain is for shell composition: `$(gate show $id --fields
    // state --plain)` returns just `approved` without JSON quoting.
    // Requires exactly one --fields entry; the "one value, no
    // envelope" contract is what makes it pipeline-friendly.
    const keep = (fields ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (keep.length !== 1) {
      throw new Error(
        '--plain requires exactly one field (use --fields <key>). ' +
          'For multiple fields, drop --plain and read the JSON object.',
      );
    }
    // toRenderJSON: JSON-side back-compat surface (issue #230 — Devil
    // review blocker 2). `gate show --fields executor --plain $id` was
    // a documented selector; preserve it by emitting the deprecated
    // alias on the render path. Persistence still writes only the new
    // `executors` key.
    const payload = r.toRenderJSON();
    const key = keep[0]!;
    if (!(key in payload)) {
      // Missing field: emit nothing, exit 1 so shell `[ -z "$v" ]`
      // handles it without hallucinating a default.
      return 1;
    }
    const v = payload[key];
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      process.stdout.write(String(v) + '\n');
    } else {
      // Objects / arrays — fall back to compact JSON so callers
      // still get something usable. Rare in practice (most useful
      // fields are scalars).
      process.stdout.write(JSON.stringify(v) + '\n');
    }
    return 0;
  }
  if (format === 'json') {
    // `--fields state,executor` trims the payload to what the caller
    // actually needs. A full `show` JSON runs ~400-800 bytes; for an
    // agent checking just `state` in a tight loop, that's a lot of
    // tokens for one boolean-ish answer. Only available in JSON mode
    // (text already has its own compact summary).
    // toRenderJSON: include the deprecated `executor` alias so the
    // documented `--fields state,executor` shape keeps working. See
    // toRenderJSON for the deprecation timeline.
    let payload: Record<string, unknown> = r.toRenderJSON();
    if (fields !== undefined) {
      const keep = fields
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const picked: Record<string, unknown> = {};
      for (const k of keep) {
        if (k in payload) picked[k] = payload[k];
      }
      payload = picked;
    }
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stdout.write(formatRequestText(r) + '\n');
  }
  return 0;
}

function formatRequestText(r: Request): string {
  const j = r.toJSON();
  const lines: string[] = [];
  lines.push(`${j['id']}  [${j['state']}]`);
  lines.push(`  from:     ${j['from']}`);
  // executors: new wire form (array) — render as `executors: a, b`.
  // Records that hydrated from the legacy `executor: <string>` shape
  // come through toJSON as a single-element array. The label is
  // pluralised even for one entry so the schema is uniform; the
  // single-name case still reads naturally (`executors: alice`).
  // Issue #230.
  // Read via the domain getter — slice-closure (issue #294) doesn't
  // affect this row; status surfaces through dedicated verbs (e.g.
  // `gate wave-status`).
  const execNames = r.executors.map((m) => m.value);
  if (execNames.length > 0) {
    lines.push(`  executors: ${execNames.join(', ')}`);
  }
  if (j['target']) lines.push(`  target:   ${j['target']}`);
  if (j['auto_review']) lines.push(`  reviewer: ${j['auto_review']}`);
  if (Array.isArray(j['with']) && j['with'].length > 0) {
    lines.push(`  with:     ${(j['with'] as string[]).join(', ')}`);
  }
  if (j['promoted_from']) {
    lines.push(`  promoted_from: ${j['promoted_from']}`);
  }
  // source_agora_play (#232) — agora play this request was bridged
  // from via `gate request --from-agora`. Rendered next to
  // promoted_from because both are tool-stamped backlinks ("this came
  // out of <X>") and a reader scanning the header pairs them mentally.
  if (j['source_agora_play']) {
    lines.push(`  source_agora_play: ${j['source_agora_play']}`);
  }
  // opened_by_session (#249 slice 3) — the request author's boot
  // session at create time. Sits with the other tool-stamped
  // backlinks (promoted_from / source_agora_play) for the same
  // "where did this come from" mental cluster. Absence is the
  // common case (pre-#249 records, unstamped post-#249 writes); the
  // line drops out entirely so byte-stable text rendering survives.
  if (typeof j['opened_by_session'] === 'string' && j['opened_by_session'].length > 0) {
    lines.push(`  opened_by_session: ${j['opened_by_session']}`);
  }
  lines.push(`  created:  ${j['created_at']}`);
  lines.push('');
  pushMultilineField(lines, '  action:   ', String(j['action']));
  pushMultilineField(lines, '  reason:   ', String(j['reason']));
  if (j['completion_note']) {
    pushMultilineField(lines, '  note:     ', String(j['completion_note']));
  }
  if (j['deny_reason']) {
    pushMultilineField(lines, '  denied:   ', String(j['deny_reason']));
  }
  if (j['failure_reason']) {
    pushMultilineField(lines, '  failed:   ', String(j['failure_reason']));
  }

  const log = Array.isArray(j['status_log']) ? j['status_log'] : [];
  if (log.length > 0) {
    lines.push('');
    lines.push(`  status_log (${log.length}):`);
    // Pad the state column to the max width in *this* log so the
    // `by X` column doesn't shuffle column-wise per row. Computed
    // per-render rather than hard-coded to the REQUEST_STATES max,
    // so logs that never reached executing/completed stay compact.
    const stateWidth = Math.max(
      ...(log as Array<Record<string, unknown>>).map(
        (e) => String(e['state']).length,
      ),
    );
    let prevAt: string | undefined;
    for (const entry of log as Array<Record<string, unknown>>) {
      const at = String(entry['at']);
      const note = entry['note'] ? ` — ${entry['note']}` : '';
      const delta = prevAt ? ` (${formatDelta(prevAt, at)})` : '';
      const invokedBy = entry['invoked_by']
        ? ` [invoked_by=${entry['invoked_by']}]`
        : '';
      const state = String(entry['state']).padEnd(stateWidth);
      lines.push(
        `    ${at}  ${state}  by ${entry['by']}${invokedBy}${delta}${note}`,
      );
      prevAt = at;
    }
  }

  // Stake markers (issues #226 / #244): claim and witnesses sit on
  // the "who has this right now / who has eyes on it" axis. Rendered
  // as their own sub-section below status_log so they don't read as
  // a transition entry — same indentation under the same header was
  // misleading scanners (#245). Only emitted when at least one is
  // set; an unstaked record produces no `stake:` block.
  const hasClaim =
    typeof j['claimed_by'] === 'string' && typeof j['claimed_at'] === 'string';
  const hasWitnesses =
    Array.isArray(j['witnesses']) && (j['witnesses'] as unknown[]).length > 0;
  if (hasClaim || hasWitnesses) {
    lines.push('');
    lines.push('  stake:');
    if (hasClaim) {
      // Optional claim_note (issue #246) appended after an em-dash
      // separator. Stays on one line so the stake block scans
      // compactly even with several witnesses.
      const claimNote =
        typeof j['claim_note'] === 'string' && j['claim_note'].length > 0
          ? ` — ${j['claim_note']}`
          : '';
      // claimed_by_session (#249 slice 3): inline `[session=<id>]`
      // tag between actor and timestamp. Bracket form (rather than
      // parens) keeps it visually distinct from claim_note's em-dash
      // suffix so a reader scanning the line sees three independent
      // axes: who, when, attribution.
      const claimSession =
        typeof j['claimed_by_session'] === 'string' && j['claimed_by_session'].length > 0
          ? ` [session=${j['claimed_by_session']}]`
          : '';
      lines.push(
        `    claimed by: ${j['claimed_by']}${claimSession} at ${j['claimed_at']}${claimNote}`,
      );
    }
    if (hasWitnesses) {
      // Per-witness notes (issue #246) emitted inline as
      // `name (note)` so a 5-witness wave with mixed annotations
      // reads naturally:  `witnesses: alice (watching dedup), bob, carol (perf)`.
      const witnessNotes =
        j['witness_notes'] && typeof j['witness_notes'] === 'object' && !Array.isArray(j['witness_notes'])
          ? (j['witness_notes'] as Record<string, string>)
          : {};
      // Per-witness session_id (#249 slice 3) surfaces as a
      // bracket-tagged `[session=<id>]` suffix on the actor name.
      // Mirrors the claim line's tagging shape so a reader sees one
      // consistent annotation grammar across both stake variants.
      const witnessSessions =
        j['witness_sessions'] && typeof j['witness_sessions'] === 'object' && !Array.isArray(j['witness_sessions'])
          ? (j['witness_sessions'] as Record<string, string>)
          : {};
      const names = (j['witnesses'] as unknown[]).map((w) => {
        const name = String(w);
        const note = witnessNotes[name];
        const session = witnessSessions[name];
        const noteSuffix =
          typeof note === 'string' && note.length > 0 ? ` (${note})` : '';
        const sessionSuffix =
          typeof session === 'string' && session.length > 0
            ? ` [session=${session}]`
            : '';
        return `${name}${noteSuffix}${sessionSuffix}`;
      }).join(', ');
      lines.push(`    witnesses: ${names}`);
    }
  }

  // Template stamp (issue #235): wave-brief provenance. Lifted out
  // of status_log alongside the stake markers (#245) — the same
  // "looks like a log entry" anti-pattern applied here.
  if (typeof j['template'] === 'string') {
    const v =
      typeof j['template_version'] === 'number' ? ` (v${j['template_version']})` : '';
    const ack = j['gate_required_acknowledged'] === true ? ' [gate-ack]' : '';
    lines.push('');
    lines.push(`  template: ${j['template']}${v}${ack}`);
  }

  const reviews = Array.isArray(j['reviews']) ? j['reviews'] : [];
  if (reviews.length > 0) {
    lines.push('');
    lines.push(`  reviews (${reviews.length}):`);
    const lastLogAt =
      log.length > 0
        ? String((log[log.length - 1] as Record<string, unknown>)['at'])
        : undefined;
    let prevAt = lastLogAt;
    for (const rv of reviews as Array<Record<string, unknown>>) {
      const at = String(rv['at']);
      const delta = prevAt ? ` (${formatDelta(prevAt, at)})` : '';
      const invokedBy = rv['invoked_by']
        ? ` [invoked_by=${rv['invoked_by']}]`
        : '';
      lines.push(
        `    [${rv['lense']}/${rv['verdict']}] by ${rv['by']}${invokedBy} at ${at}${delta}`,
      );
      const comment = String(rv['comment'] ?? '');
      for (const line of comment.split('\n')) {
        lines.push(`      ${line}`);
      }
      prevAt = at;
    }
  }

  // Chain hint: detect full-id references (YYYY-MM-DD-NNN...) in free
  // text fields so the reader can notice whether `gate chain <id>` will
  // surface anything. Pure read-time signal; the write path is
  // untouched, preserving "write forgivingness" (free-form text) while
  // surfacing structural awareness at read time. Short-form references
  // like "(0004)" are intentionally not detected — the full ID format
  // is what `chain` walks, and hinting otherwise would mislead.
  const REF_PATTERN = /\b\d{4}-\d{2}-\d{2}-\d+\b/g;
  const selfId = String(j['id'] ?? '');
  const refs = new Set<string>();
  const scanText = (value: unknown): void => {
    if (typeof value !== 'string') return;
    const matches = value.match(REF_PATTERN);
    if (matches) for (const m of matches) refs.add(m);
  };
  scanText(j['action']);
  scanText(j['reason']);
  scanText(j['completion_note']);
  scanText(j['deny_reason']);
  scanText(j['failure_reason']);
  for (const entry of log as Array<Record<string, unknown>>) {
    scanText(entry['note']);
  }
  for (const rv of reviews as Array<Record<string, unknown>>) {
    scanText(rv['comment']);
  }
  refs.delete(selfId);
  const refList = [...refs].sort();
  lines.push('');
  if (refList.length === 0) {
    lines.push(
      `  chain hint: no outbound id references detected (gate chain ${selfId} will return nothing)`,
    );
  } else {
    const noun = refList.length === 1 ? 'reference' : 'references';
    lines.push(
      `  chain hint: ${refList.length} outbound ${noun} detected — ${refList.join(', ')}`,
    );
  }

  // Concern marker: a 3-state existence signal, not a count. Counting
  // ("3 concerns, 1 follow-up") would invite the reader to play a
  // "drive the number down" game — performance-for-the-record
  // (principle 03). Three states keep perception engaged without
  // setting a target:
  //   - no concerns recorded
  //   - concern recorded; no inbound reference
  //   - concern recorded; inbound reference present
  // The reader walks `gate chain` to see the actual references and
  // judges for themselves whether they address the concerns. The
  // tool only asserts existence.
  const hasConcernReview = (reviews as Array<Record<string, unknown>>).some(
    (rv) => rv['verdict'] === 'concern' || rv['verdict'] === 'reject',
  );
  if (hasConcernReview) {
    // We don't have the cross-record inbound count here without an
    // extra repository pass; instead say "see gate chain" and let
    // the reader resolve presence vs absence with one command. This
    // keeps formatRequestText synchronous + repo-free.
    lines.push(
      `  concern marker: concern recorded — ` +
        `walk \`gate chain ${selfId}\` to see inbound references (if any)`,
    );
  } else {
    lines.push('  concern marker: no concerns recorded');
  }

  return lines.join('\n');
}

export async function reqApprove(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, APPROVE_KNOWN_FLAGS, 'approve');
  const id = args.positional[0];
  if (!id) throw new Error('Usage: gate approve <id> --by <m> [--dry-run]');
  // Canonicalize `--by` BEFORE the self-detection compare and BEFORE
  // any user-facing notice/invoked-by line is emitted. The raw CLI
  // arg (`ALICE`, `alice `, etc.) survives into the comparison
  // otherwise — `prior.from.value` was canonicalized at create time,
  // so a raw compare let `--by ALICE` slip past the swarm
  // `forbidden` policy (#233 follow-up Asteria critical bypass).
  const by = normalizeActor(
    requireOption(args, 'by', '<m>', 'GUILD_ACTOR'),
  );
  const note = optionalOption(args, 'note');
  const invokedBy = resolveInvokedBy(by, 'approve', id);
  if (isDryRun(args)) {
    const prior = await c.requestUC.show(id);
    if (!prior) throw new Error(`Request not found: ${id}`);
    const fromState = prior.state;
    const r = await c.requestUC.approve(id, by, note, invokedBy, { dryRun: true });
    emitDryRunPreview({ verb: 'approve', id, by, fromState, toState: r.state, after: r, format: parseFormat(args) });
    return 0;
  }
  // Self-approve gate (#233). The detect runs BEFORE applying the
  // transition: under `forbidden` we must not mutate the record. The
  // `from` field is the canonical author (immutable post-creation);
  // comparing on string value matches the historical notice path.
  const prior = await c.requestUC.show(id);
  const isSelf = prior !== null && by === prior.from.value;
  if (isSelf) {
    const policy = c.config.features.selfApprove;
    if (policy === 'forbidden') {
      const profile = c.config.profile;
      process.stderr.write(
        `error: self-approve forbidden in this profile (${profile}).\n` +
          `  Options:\n` +
          `    - Use \`gate fast-track <id>\` for legitimate single-step self-flow\n` +
          `    - Have another actor approve: \`gate approve <id> --by <other>\`\n` +
          `    - Switch profile to \`standard\` or set \`self_approve: warn\` if this guild allows self-approve\n`,
      );
      return 1;
    }
  }
  // Lifecycle hook fire point (#36 Phase 1 step 5). `before:approve`
  // sees the pre-mutation request snapshot; a veto blocks the
  // transition. Fired AFTER the built-in self-approve check because
  // a hook policy that depends on actor identity should compose with
  // (not duplicate) the hard-coded gate.
  if (prior !== null) {
    const veto = await fireBeforeHook(c.hookSubscriptions, 'approve', prior, by);
    if (veto) return emitHookVeto('approve', id, veto);
  }
  const r = await c.requestUC.approve(id, by, note, invokedBy);
  await fireAfterHook(c.hookSubscriptions, 'approve', r, by);
  // Self-approval notice. Suppressed under `allowed` (deployments that
  // actively rely on self-approve and don't want the audit line).
  // Preserved under `warn` — the historical default — so the
  // no-second-pair-of-eyes case never happens silently.
  if (by === r.from.value && c.config.features.selfApprove === 'warn') {
    process.stderr.write(
      `notice: ${by} approved their own request ${id} ` +
        `(no second reviewer; for a single-step self-flow use ` +
        `'gate fast-track').\n`,
    );
  }
  emitWriteResponse(parseFormat(args), r, `✓ approved: ${id}`, c.config);
  return 0;
}

export async function reqDeny(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, DENY_KNOWN_FLAGS, 'deny');
  const id = args.positional[0];
  const reason = await resolveReason(args, 'deny');
  if (!id || !reason) {
    throw new Error(
      'Usage: gate deny <id> --by <m> [--note <s> | --reason <s> | <reason>] [--dry-run]' +
        dashedValueHint(args, ['reason', 'note']),
    );
  }
  const by = normalizeActor(
    requireOption(args, 'by', '<m>', 'GUILD_ACTOR'),
  );
  const invokedBy = resolveInvokedBy(by, 'deny', id);
  if (isDryRun(args)) {
    const prior = await c.requestUC.show(id);
    if (!prior) throw new Error(`Request not found: ${id}`);
    const fromState = prior.state;
    const r = await c.requestUC.deny(id, by, reason, invokedBy, { dryRun: true });
    emitDryRunPreview({ verb: 'deny', id, by, fromState, toState: r.state, after: r, format: parseFormat(args) });
    return 0;
  }
  const priorDeny = await c.requestUC.show(id);
  if (priorDeny !== null) {
    const veto = await fireBeforeHook(c.hookSubscriptions, 'deny', priorDeny, by);
    if (veto) return emitHookVeto('deny', id, veto);
  }
  const r = await c.requestUC.deny(id, by, reason, invokedBy);
  await fireAfterHook(c.hookSubscriptions, 'deny', r, by);
  emitWriteResponse(parseFormat(args), r, `✓ denied: ${id}`, c.config);
  return 0;
}

export async function reqExecute(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, EXECUTE_KNOWN_FLAGS, 'execute');
  const id = args.positional[0];
  if (!id)
    throw new Error('Usage: gate execute <id> --by <m> [--cwd <path>] [--dry-run]');
  const by = normalizeActor(
    requireOption(args, 'by', '<m>', 'GUILD_ACTOR'),
  );
  const note = optionalOption(args, 'note');
  // --cwd lets a caller declare "I'm running from THIS filesystem"
  // explicitly. Defaults to process.cwd() because every real call
  // path already runs from the agent's worktree; the override exists
  // mainly for tests (which spawn a subprocess and want to assert
  // the cwd-collision check fires deterministically) and for tools
  // that proxy the verb without changing process directories.
  // Issue #231.
  const cwdFlag = optionalOption(args, 'cwd');
  // Canonicalize via realpath so symlink farms collapse to a single
  // identity. Devil HIGH-1 (#231 follow-up): plain `path.resolve`
  // leaves `/var/foo` and `/private/var/foo` distinct strings even
  // though they name the same physical directory — on darwin the
  // tmpdir is the canonical example. The collision check compares
  // against `peer.lastExecutingCwd` which was ALSO realpath'd at
  // write time below, so equality reflects "same physical worktree"
  // and not "same string". Falls back to the resolved (un-canonical)
  // path on EACCES / ENOENT so a missing parent doesn't crash a
  // legitimate execute — the comparison is best-effort by design
  // (race window noted in CHANGELOG; advisory lock is follow-up).
  const cwdResolved =
    cwdFlag !== undefined ? resolvePath(cwdFlag) : process.cwd();
  let cwd: string;
  try {
    cwd = realpathSync(cwdResolved);
  } catch {
    cwd = cwdResolved;
  }
  const invokedBy = resolveInvokedBy(by, 'execute', id);

  // Worktree-isolation collision check (#231). Runs only for
  // requests that were stamped at creation time (profile=swarm +
  // executors > 1). The check is best-effort, not transactional:
  //   1. Load the target request.
  //   2. Find every OTHER request with the same `target` whose state
  //      is `executing`.
  //   3. If any of them last entered `executing` from THIS cwd,
  //      refuse — the operator must spawn a separate worktree.
  // Race window between this check and the save() inside
  // requestUC.execute is intentional: filesystem layer is one of
  // three race-mitigations (record + agent loop + filesystem), and
  // the optimistic-lock in YamlRequestRepository.save catches any
  // residual collision at the *record* layer.
  const target = await c.requestUC.show(id);
  if (target && target.requiresWorktreeIsolation && target.target !== undefined) {
    const peers = await c.requestUC.listByState('executing');
    for (const peer of peers) {
      if (peer.id.value === id) continue;
      if (peer.target !== target.target) continue;
      const peerCwd = peer.lastExecutingCwd;
      if (peerCwd !== undefined && peerCwd === cwd) {
        process.stderr.write(
          `error: refusing to execute ${id} from cwd=${cwd}: ` +
            `peer request ${peer.id.value} (target=${peer.target}) is already ` +
            `executing from the same filesystem. This wave was created with ` +
            `requires_worktree_isolation=true (profile=swarm); ` +
            `spawn this executor in a separate git worktree and retry.\n`,
        );
        return 1;
      }
    }
  }

  if (isDryRun(args)) {
    const prior = await c.requestUC.show(id);
    if (!prior) throw new Error(`Request not found: ${id}`);
    const fromState = prior.state;
    const r = await c.requestUC.execute(id, by, note, invokedBy, { dryRun: true, cwd });
    emitDryRunPreview({ verb: 'execute', id, by, fromState, toState: r.state, after: r, format: parseFormat(args) });
    return 0;
  }
  if (target !== null) {
    const veto = await fireBeforeHook(c.hookSubscriptions, 'execute', target, by);
    if (veto) return emitHookVeto('execute', id, veto);
  }
  const r = await c.requestUC.execute(id, by, note, invokedBy, { cwd });
  await fireAfterHook(c.hookSubscriptions, 'execute', r, by);
  // `--executor` / `--executors` is informational, not access
  // control: the substrate records both the assignment and the actual
  // actor, but does not refuse a mismatched execute. Surface a notice
  // so a fresh agent who reads `--executor bob` doesn't silently
  // interpret it as a gate. See issue #168 for the design rationale
  // ("anyone may execute; the audit trail captures who did"). Mirrors
  // the shape of the self-approve notice on `gate approve`.
  //
  // Multi-executor (issue #230 — Devil review blocker 1): the notice
  // fires only when `by` is NOT in the assigned set. Earlier shape
  // (`assignedExecutor !== by` against scalar first-of-list) would
  // print "assigned to miki" when leysia executed a request with
  // `--executors miki,leysia` — a false-positive misdirection that
  // contradicts the actual record. Membership check resolves both
  // false-positives and silent drops.
  const assigned = r.executors;
  if (assigned.length > 0 && !r.hasExecutor(by)) {
    const assignedList = assigned.map((m) => m.value).join(', ');
    const noun = assigned.length === 1 ? 'assigned to' : 'assigned to one of';
    process.stderr.write(
      `notice: ${by} executed request ${id} (${noun} ` +
        `${assignedList}); --executor records intent, not access.\n`,
    );
  }
  emitWriteResponse(parseFormat(args), r, `✓ executing: ${id}`, c.config);
  return 0;
}

/**
 * Issue #294 / miki concern #1.
 *
 * When a wave has assigned executors and `by` is not one of them,
 * `complete` / `fail` must refuse before writing — otherwise Slice A's
 * domain fallback (which routes to wave-level transition when
 * `hasExecutor(by)` is false, for pre-#294 / executors-empty records)
 * would silently close the whole wave on a `--by` typo (e.g. `miik`
 * instead of `miki`). The fallback is correct for executors-empty
 * records (legacy single-executor or wave-only waves) but dangerous
 * when executors is non-empty. Returning `null` means "go ahead";
 * returning an exit code means "we already wrote the error message".
 */
function rejectIfNonMember(
  prior: Request,
  by: string,
  verb: 'complete' | 'fail',
): number | null {
  const assigned = prior.executors;
  if (assigned.length === 0) return null; // pre-#294 / executors-empty — fallback path is safe
  if (prior.hasExecutor(by)) return null; // member: slice-close path
  const list = assigned.map((m) => m.value).join(', ');
  process.stderr.write(
    `error: ${by} is not in this wave's executors (${list}); ` +
      `typo? --by must match one of: ${list}\n` +
      `  next: re-run 'gate ${verb} <id> --by <name>' with one of the assigned actors.\n`,
  );
  return 1;
}

/**
 * Issue #294: render the slice-only close notice. Fires when the
 * caller closed *their* slice but other executors remain open — wave
 * state is unchanged, the wave-level transition is deferred until the
 * last slice closes. Surfaces the remaining open slices (with their
 * status, so a reader can distinguish `pending` from `unknown` —
 * `unknown` means the slice predates #294 and was never explicitly
 * stamped, so the caller likely wants to ask whoever owns it whether
 * they intend to close it).
 */
function emitSliceClose(
  r: Request,
  by: string,
  verb: 'complete' | 'fail',
  config: unknown,
  format: ReturnType<typeof parseFormat>,
  extraLines: readonly string[],
): void {
  const verbPast = verb === 'complete' ? 'closed' : 'failed';
  const remaining = r.executorRecords.filter(
    (rec) => rec.status === 'pending' || rec.status === 'unknown',
  );
  const lines: string[] = [];
  lines.push(`✓ slice ${verbPast}: ${r.id.value} by ${by}`);
  if (remaining.length > 0) {
    lines.push('open slices remaining:');
    for (const rec of remaining) {
      lines.push(`  - ${rec.name.value} (status: ${rec.status})`);
    }
    lines.push(
      `next: each remaining executor must run \`gate ${verb} ${r.id.value} --by <name>\` to terminate the wave.`,
    );
  }
  for (const e of extraLines) lines.push(e);
  emitWriteResponse(format, r, lines.join('\n'), config as Parameters<typeof emitWriteResponse>[3]);
}

export async function reqComplete(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, COMPLETE_KNOWN_FLAGS, 'complete');
  const id = args.positional[0];
  if (!id) throw new Error('Usage: gate complete <id> --by <m> [--dry-run]');
  const by = normalizeActor(
    requireOption(args, 'by', '<m>', 'GUILD_ACTOR'),
  );
  const note = optionalOption(args, 'note');
  const invokedBy = resolveInvokedBy(by, 'complete', id);
  if (isDryRun(args)) {
    const prior = await c.requestUC.show(id);
    if (!prior) throw new Error(`Request not found: ${id}`);
    const fromState = prior.state;
    const r = await c.requestUC.complete(id, by, note, invokedBy, { dryRun: true });
    emitDryRunPreview({ verb: 'complete', id, by, fromState, toState: r.state, after: r, format: parseFormat(args) });
    return 0;
  }
  const priorComplete = await c.requestUC.show(id);
  if (priorComplete !== null) {
    // Issue #294 (miki concern #1): when the wave has assigned
    // executors and `by` is not one of them, refuse before writing.
    // Pre-#294 fallback (Slice A's domain `complete`) silently routes
    // to wave-level transition when `hasExecutor(by)` is false; that's
    // correct for executors-empty records (legacy single-executor or
    // no-executor waves) but dangerous when executors is non-empty —
    // a typo (`--by miik`) would close the whole wave without ever
    // matching a slice. Reject at the handler boundary so the trail
    // never records the false transition.
    const sliceReject = rejectIfNonMember(priorComplete, by, 'complete');
    if (sliceReject !== null) return sliceReject;

    const veto = await fireBeforeHook(c.hookSubscriptions, 'complete', priorComplete, by);
    if (veto) return emitHookVeto('complete', id, veto);
  }
  const priorState = priorComplete?.state;
  const r = await c.requestUC.complete(id, by, note, invokedBy);
  await fireAfterHook(c.hookSubscriptions, 'complete', r, by);
  const extraLines: string[] = [];
  if (r.autoReview) {
    const reviewer = r.autoReview.value;
    const tpl =
      `gate review ${id} --by ${reviewer} --lense devil ` +
      `--verdict <ok|concern|reject> "<comment>"`;
    extraLines.push(`→ auto-review pending for: ${reviewer}`);
    extraLines.push(`  ${tpl}`);
  }
  // Issue #294: slice-only vs wave-terminal output split.
  //   - Wave terminal: state changed (e.g. executing → completed).
  //     Existing output kept ("✓ completed: <id>").
  //   - Slice only: state unchanged (e.g. executing → executing) —
  //     the actor closed their slice but other executors are still
  //     pending. Surface "✓ slice closed" plus the remaining open
  //     slices so the caller knows the wave isn't done.
  const stateUnchanged = priorState !== undefined && priorState === r.state;
  const isSliceOnly = stateUnchanged && r.hasExecutor(by);
  if (isSliceOnly) {
    emitSliceClose(r, by, 'complete', c.config, parseFormat(args), extraLines);
    return 0;
  }
  emitWriteResponse(parseFormat(args), r, `✓ completed: ${id}`, c.config, extraLines);
  return 0;
}

export async function reqFail(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, FAIL_KNOWN_FLAGS, 'fail');
  const id = args.positional[0];
  const reason = await resolveReason(args, 'fail');
  if (!id || !reason) {
    throw new Error(
      'Usage: gate fail <id> --by <m> [--note <s> | --reason <s> | <reason>] [--dry-run]' +
        dashedValueHint(args, ['reason', 'note']),
    );
  }
  const by = normalizeActor(
    requireOption(args, 'by', '<m>', 'GUILD_ACTOR'),
  );
  const invokedBy = resolveInvokedBy(by, 'fail', id);
  if (isDryRun(args)) {
    const prior = await c.requestUC.show(id);
    if (!prior) throw new Error(`Request not found: ${id}`);
    const fromState = prior.state;
    const r = await c.requestUC.fail(id, by, reason, invokedBy, { dryRun: true });
    emitDryRunPreview({ verb: 'fail', id, by, fromState, toState: r.state, after: r, format: parseFormat(args) });
    return 0;
  }
  const priorFail = await c.requestUC.show(id);
  if (priorFail !== null) {
    // See reqComplete: issue #294 / miki concern #1 — refuse fail
    // when wave has executors and `by` is not one of them. Same
    // typo-safety rationale as complete: a misspelt `--by` would
    // otherwise close the wave without matching a slice.
    const sliceReject = rejectIfNonMember(priorFail, by, 'fail');
    if (sliceReject !== null) return sliceReject;

    const veto = await fireBeforeHook(c.hookSubscriptions, 'fail', priorFail, by);
    if (veto) return emitHookVeto('fail', id, veto);
  }
  const priorState = priorFail?.state;
  const r = await c.requestUC.fail(id, by, reason, invokedBy);
  await fireAfterHook(c.hookSubscriptions, 'fail', r, by);
  // Issue #294: slice-only vs wave-terminal split (see reqComplete).
  const stateUnchanged = priorState !== undefined && priorState === r.state;
  const isSliceOnly = stateUnchanged && r.hasExecutor(by);
  if (isSliceOnly) {
    emitSliceClose(r, by, 'fail', c.config, parseFormat(args), []);
    return 0;
  }
  emitWriteResponse(parseFormat(args), r, `✓ failed: ${id}`, c.config);
  return 0;
}

// Append a short hint to usage errors when one of the string-valued
// flags landed as boolean (meaning the user passed a value that began
// with "--" and the parser refused to consume it). Parallels the same
// hint added inline in requireOption. Returns an empty string when no
// flag is in that state, so the usage message stays clean in the
// common forgot-the-arg case.
function dashedValueHint(args: ParsedArgs, keys: readonly string[]): string {
  const tripped = keys.filter((k) => args.options[k] === true);
  if (tripped.length === 0) return '';
  const pairs = tripped.map((k) => `--${k}=<value>`).join(' / ');
  return (
    `\n  (Your ${tripped.map((k) => '--' + k).join(' / ')} value began with "--" ` +
    `and was not consumed. Use ${pairs} or put "-- <value>" after the other flags.)`
  );
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

// Resolve the closure reason for deny/fail accepting any of:
//   --reason <s>    explicit & semantically precise
//   --reason -      STDIN (parity with `gate review --comment -`)
//   --note <s>      muscle-memory parity with approve/execute/complete
//   --note -        STDIN
//   <positional>    legacy form retained for back-compat
// Explicit options take precedence over positional.
async function resolveReason(args: ParsedArgs, _verb: string): Promise<string> {
  const reasonOpt = optionalOption(args, 'reason');
  const noteOpt = optionalOption(args, 'note');
  if (reasonOpt === '-') return (await readStdin()).trim();
  if (reasonOpt !== undefined && reasonOpt.trim()) return reasonOpt;
  if (noteOpt === '-') return (await readStdin()).trim();
  if (noteOpt !== undefined && noteOpt.trim()) return noteOpt;
  return args.positional.slice(1).join(' ');
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
  const executorOpt = optionalOption(args, 'executor');
  const executorsRaw = optionalOption(args, 'executors');
  const autoReview = optionalOption(args, 'auto-review');
  const note = optionalOption(args, 'note');
  const withPartners = parseWithList(optionalOption(args, 'with'));
  // Same mutual-exclusion as `gate request`. Fast-track defaults the
  // single-executor case to `from` (self-execute) when neither flag
  // is supplied; the multi-executor case must be explicit.
  if (executorOpt !== undefined && executorsRaw !== undefined) {
    process.stderr.write(
      `error: --executor and --executors are mutually exclusive (got both).\n`,
    );
    return 1;
  }
  let executorsList: readonly string[] | undefined;
  if (executorsRaw !== undefined) {
    const parsed = parseExecutorsList(executorsRaw);
    if (parsed.error) {
      process.stderr.write(`error: --executors ${parsed.error}\n`);
      return 1;
    }
    if (parsed.list.length > 0) executorsList = parsed.list;
  }
  // Single-executor surface: explicit --executor wins, else default
  // to the author for the self-execute happy path.
  if (executorOpt !== undefined) {
    // Deprecation notice — same policy as reqCreate (#239). Only warn
    // on explicit user input, not the implicit `from` fallback.
    process.stderr.write(
      `notice: --executor (singular) is deprecated and will be removed in v0.7.0; use --executors <name> instead. (issue #239)\n`,
    );
  }
  const executor = executorsList === undefined
    ? (executorOpt ?? from)
    : undefined;

  const createInput: Parameters<typeof c.requestUC.create>[0] = {
    from,
    action,
    reason,
  };
  if (executor !== undefined) createInput.executor = executor;
  if (executorsList !== undefined) createInput.executors = executorsList;
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
  // status_log + invoked_by capture the rest. Single-executor stays
  // exactly as before.
  const execActor = executor ?? executorsList?.[0] ?? from;
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
  emitWriteResponse(
    parseFormat(args),
    completed,
    `✓ fast-tracked: ${id} (pending→completed)`,
    c.config,
    extraLines,
  );
  return 0;
}

function printSummary(r: Request, markerWidth = 16): void {
  const j = r.toJSON();
  const markers = formatReviewMarkers(j['reviews'], markerWidth);
  process.stdout.write(
    `${j['id']}  [${j['state']}]  from=${j['from']}  ${markers}${String(j['action']).slice(0, 60)}\n`,
  );
}

// Render a compact per-lense verdict summary like "✓devil ✓layer" or
// "!devil ✓layer". See comments in the prior index.ts implementation
// for design notes (UTF-16 width caveat, icon map, etc).
export function formatReviewMarkers(reviews: unknown, width = 16): string {
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return ''.padEnd(width);
  }
  const parts: string[] = [];
  for (const rv of reviews as Array<Record<string, unknown>>) {
    const verdict = String(rv['verdict'] ?? '');
    const lense = String(rv['lense'] ?? '');
    const icon =
      verdict === 'ok'
        ? '✓'
        : verdict === 'concern'
          ? '!'
          : verdict === 'reject'
            ? 'x'
            : '?';
    parts.push(`${icon}${lense}`);
  }
  const joined = parts.join(' ');
  return joined.padEnd(width);
}
