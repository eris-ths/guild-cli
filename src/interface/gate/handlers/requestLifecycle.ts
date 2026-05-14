// State-transition handlers: `gate approve`, `deny`, `execute`,
// `complete`, `fail`. Plus the four helpers they share among them
// (rejectIfNonMember, emitSliceClose, dashedValueHint, resolveReason).
//
// Extracted from request.ts during the 2026-05-13 split (#3xx). The
// original file mixed creation, read, lifecycle, and fast-track in a
// single 1656-line module; the split groups handlers by passage role
// without changing behavior. Tests reach these via CLI dispatch, so
// no test changes are needed.

import { resolve as resolvePath } from 'node:path';
import { realpathSync } from 'node:fs';
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
import { Request } from '../../../domain/request/Request.js';
import {
  C,
  readStdin,
  resolveInvokedBy,
  isDryRun,
  emitDryRunPreview,
  normalizeActor,
} from './internal.js';
import { emitWriteResponse, parseFormat } from './writeFormat.js';
import { RecoverableError } from '../../shared/errorEnvelope.js';

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
  'cliff',
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
      // Tag aligned with `gate wave-status` rendering (#294 vocab
      // unify): `[?]` for legacy `unknown`, plain status name for
      // recognized values. Keeping the two surfaces' vocabulary in
      // lockstep so an operator who reads `wave-status` first and
      // `complete` second sees the same shape for the same record.
      const tag = rec.status === 'unknown' ? '[?]' : `[${rec.status}]`;
      lines.push(`  - ${rec.name.value}  ${tag}`);
    }
    // Style aligned with stdout success-mode `→ next:` convention
    // (matches boot.ts:1564, 1569). Previously bare `next:` was a
    // third style alongside stderr-error `  next:` and stdout-success
    // `→ next:`; consolidating to one style per channel.
    lines.push(
      `→ next: each remaining executor must run \`gate ${verb} ${r.id.value} --by <name>\` to terminate the wave.`,
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
  // --cliff (#37x): optional forward-pointing hint for the next agent
  // picking up after this completion. Plumbed through to the use case
  // which routes it to the domain layer (lands on the terminal
  // status_log entry — or the wave-terminal entry for slice closure).
  const cliff = optionalOption(args, 'cliff');
  const invokedBy = resolveInvokedBy(by, 'complete', id);
  // Load the wave once and run rejectIfNonMember + dry-run / live
  // branches against the same snapshot. Round-2 N3: previously dry-run
  // ran BEFORE rejectIfNonMember, so `gate complete <id> --by miik
  // --dry-run` (typo) showed a misleading wave-terminal preview while
  // the real run rejected. The preview must match what the real run
  // would do.
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
    // never records the false transition. Applies to dry-run too.
    const sliceReject = rejectIfNonMember(priorComplete, by, 'complete');
    if (sliceReject !== null) return sliceReject;
  }
  if (isDryRun(args)) {
    if (!priorComplete) throw new Error(`Request not found: ${id}`);
    const fromState = priorComplete.state;
    const r = await c.requestUC.complete(id, by, note, invokedBy, { dryRun: true, ...(cliff !== undefined ? { cliff } : {}) });
    emitDryRunPreview({ verb: 'complete', id, by, fromState, toState: r.state, after: r, format: parseFormat(args) });
    return 0;
  }
  if (priorComplete !== null) {
    const veto = await fireBeforeHook(c.hookSubscriptions, 'complete', priorComplete, by);
    if (veto) return emitHookVeto('complete', id, veto);
  }
  const priorState = priorComplete?.state;
  const r = await c.requestUC.complete(id, by, note, invokedBy, cliff !== undefined ? { cliff } : undefined);
  await fireAfterHook(c.hookSubscriptions, 'complete', r, by);
  // Issue #294: slice-only vs wave-terminal output split.
  //   - Wave terminal: state changed (e.g. executing → completed).
  //     Existing output kept ("✓ completed: <id>").
  //   - Slice only: state unchanged (e.g. executing → executing) —
  //     the actor closed their slice but other executors are still
  //     pending. Surface "✓ slice closed" plus the remaining open
  //     slices so the caller knows the wave isn't done.
  const stateUnchanged = priorState !== undefined && priorState === r.state;
  const isSliceOnly = stateUnchanged && r.hasExecutor(by);
  // auto-review is a WAVE-level callback — it fires once the wave is
  // terminal. Surfacing the "→ auto-review pending" hint on a slice-
  // only close would mislead the operator into thinking the reviewer
  // can act now (they cannot — the wave hasn't transitioned). Suppress
  // the hint on slice-only path; it will surface on the closing-slice
  // call when the wave finally moves to its terminal state.
  const extraLines: string[] = [];
  if (r.autoReview && !isSliceOnly) {
    const reviewer = r.autoReview.value;
    const tpl =
      `gate review ${id} --by ${reviewer} --lense devil ` +
      `--verdict <ok|concern|reject> "<comment>"`;
    extraLines.push(`→ auto-review pending for: ${reviewer}`);
    extraLines.push(`  ${tpl}`);
  }
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
  // Mirror of reqComplete (round-2 N3): run rejectIfNonMember BEFORE
  // the dry-run branch so a typo'd --by produces a consistent refusal
  // in both preview and live runs.
  const priorFail = await c.requestUC.show(id);
  if (priorFail !== null) {
    // Verb-shape redirect at the interface layer (state vocab stays
    // in domain — see RequestState.ts comment): the domain rejects
    // pending→failed with a state-name hint ("valid next states from
    // pending: approved, denied"), but a cold-session caller reading
    // that hint has to translate "denied" back to a verb. Pre-check
    // and surface `gate deny` directly — the exact friction observed
    // 2026-05-13 (drained test-fixture pendings).
    if (priorFail.state === 'pending') {
      // RecoverableError carries a structured `recovery` slot so the
      // JSON envelope's `error.recovery` field names the next verb +
      // args directly. AI-agent consumers dispatch from the structured
      // form; text-mode readers see the prose hint in the `error:`
      // line as before. Both surfaces stay in lockstep — the prose
      // and the JSON shape describe the same recovery move.
      throw new RecoverableError(
        `Request ${id} is pending — fail is reachable only from executing.\n` +
          `  To cancel a pending request, use:\n` +
          `    gate deny ${id} --by <m> --reason <s>`,
        {
          verb: 'deny',
          args: { id },
          reason:
            `${id} is pending; fail is reachable only from executing — ` +
            `deny is the cancellation path for pending records.`,
        },
      );
    }
    // See reqComplete: issue #294 / miki concern #1 — refuse fail
    // when wave has executors and `by` is not one of them. Same
    // typo-safety rationale as complete: a misspelt `--by` would
    // otherwise close the wave without matching a slice. Applies to
    // dry-run too.
    const sliceReject = rejectIfNonMember(priorFail, by, 'fail');
    if (sliceReject !== null) return sliceReject;
  }
  if (isDryRun(args)) {
    if (!priorFail) throw new Error(`Request not found: ${id}`);
    const fromState = priorFail.state;
    const r = await c.requestUC.fail(id, by, reason, invokedBy, { dryRun: true });
    emitDryRunPreview({ verb: 'fail', id, by, fromState, toState: r.state, after: r, format: parseFormat(args) });
    return 0;
  }
  if (priorFail !== null) {
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
