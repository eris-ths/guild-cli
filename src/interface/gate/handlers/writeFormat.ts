import { resolveGuildActor } from '../../shared/resolveGuildActor.js';
import { Request } from '../../../domain/request/Request.js';
import { GuildConfig } from '../../../infrastructure/config/GuildConfig.js';
import { ParsedArgs } from '../../shared/parseArgs.js';
import { parseFormat as parseFormatShared } from '../../shared/parseFormat.js';

/**
 * Re-export of the shared `--format` parser. Kept as a named export
 * here for backwards-compatibility with the many gate write-handlers
 * that import it from this module; new code should pull from
 * `interface/shared/parseFormat.js` directly. Text is the default to
 * keep the `✓ ...` muscle memory intact for humans; agents opt into
 * json explicitly.
 */
export function parseFormat(args: ParsedArgs): 'json' | 'text' {
  return parseFormatShared(args);
}

/**
 * Structured write-side response for agent-first consumers.
 *
 * Every write verb (approve, deny, execute, complete, fail, review,
 * request, fast-track) emits either:
 *   - text line (default, human-readable)       "✓ approved: 2026-..."
 *   - JSON payload (via --format json)          {"ok":true, "id":"...", ...}
 *
 * The JSON shape is the contract agents depend on when chaining calls.
 * Critically it includes `suggested_next`, a concrete next-verb hint
 * derived deterministically from the post-mutation state. An orchestrator
 * can parse this directly into the next tool call without inspecting
 * state transitions locally.
 *
 * Stability: the top-level keys (`ok`, `id`, `state`, `message`,
 * `suggested_next`) are stable within 0.x minor versions. New fields
 * may be ADDED but existing ones won't be renamed or removed without a
 * minor bump per POLICY.md.
 */
export interface WriteResponse {
  ok: true;
  id: string;
  state: string;
  message: string;
  suggested_next: SuggestedNext | null;
  /**
   * Ornamental-voice metadata (#345 — second dogfood validation of
   * principle 15). Optional. Present only when a voice plugin is
   * loaded, `GUILD_VOICE=<name>` picks it, and a template matched
   * the current request snapshot. Carries ornamental narration
   * separate from the doctrinal voice held in `message` and
   * `suggested_next.reason` (principle 08, voice-as-doctrine).
   *
   * Consumers may ignore `_meta` entirely; it never carries facts
   * the structured payload doesn't already carry. Voice can be
   * stripped from a pipeline without information loss.
   */
  _meta?: {
    voice?: string;
  };
}

export interface SuggestedNext {
  /**
   * The verb an agent *might* invoke next (e.g. "review" or
   * "execute"). This is a hint, not a directive — the field exists
   * so orchestrators can chain tool calls without re-deriving
   * state transitions locally. A caller who has other plans
   * should feel free to ignore it; the lifecycle doesn't demand
   * progression along this axis.
   */
  verb: string;
  /** Arguments pre-filled from the record. Actor fields are hints,
   *  not assertions — the agent may override when it knows better. */
  args: Record<string, string>;
  /** One-line explanation of why this verb is suggested. */
  reason: string;
  /**
   * True iff `args.by` is absent or matches the calling actor
   * (GUILD_ACTOR). When false, the suggestion can only be carried
   * out by a different actor than the one currently running the
   * tool — orchestrators that auto-dispatch should branch on this
   * rather than naively re-running with their own --by. Hint, not
   * gate: the underlying verb still validates --by at the boundary.
   */
  actor_resolved: boolean;
}

/**
 * Derive the most likely next action given the current request state.
 * Deterministic — no I/O, no randomness — so an agent can trust the
 * suggestion to match what the repository sees.
 *
 *   pending    → approve (host or executor decides)
 *   approved   → execute (by executor)
 *   executing  → complete (by executor)
 *   completed  → review if an auto-reviewer hasn't recorded yet;
 *                advisory `chain` walk if a concern/reject verdict
 *                is on record; null otherwise (terminal-clean)
 *   denied     → null (terminal)
 *   failed     → null (terminal)
 *
 * `envActor` (when provided) is used to populate `actor_resolved` —
 * true iff the suggestion's `by` argument is absent or matches the
 * caller. Pass `null` or omit when no actor context is available;
 * `actor_resolved` then reports based on `by` absence alone.
 */
export function deriveSuggestedNext(
  req: Request,
  config: GuildConfig,
  envActor?: string | null,
): SuggestedNext | null {
  const id = req.id.value;
  switch (req.state) {
    case 'pending': {
      // Don't pre-fill `by` when multiple hosts exist — silently
      // picking the first host would let an agent nominate one
      // operator without the operator knowing their name was used.
      // Surface the list in `reason` and leave `by` out so the agent
      // (or a human at the keyboard) chooses explicitly.
      const hosts = config.hostNames;
      if (hosts.length === 1) {
        return withActorResolved({
          verb: 'approve',
          args: { id, by: hosts[0]! },
          reason: `request is pending; host ${hosts[0]} must approve (or deny) before execution`,
        }, envActor);
      }
      return withActorResolved({
        verb: 'approve',
        args: { id },
        reason:
          hosts.length === 0
            ? 'request is pending; a registered host must approve — none are configured yet'
            : `request is pending; approve by one of the configured hosts [${hosts.join(', ')}] (or deny)`,
      }, envActor);
    }
    case 'approved': {
      // Multi-executor (issue #230): when one executor is named we
      // pre-fill `by` so a tool wiring can dispatch immediately. When
      // multiple are named the substrate genuinely doesn't know
      // which one will run the work next; pre-filling first-of-list
      // would (a) silently nominate one party and (b) let the other
      // inadvertently chain-call the suggestion under the wrong `by`.
      // Omit `by` and let the caller (or human at the keyboard)
      // choose explicitly. Mirrors the multi-host approve path.
      const executors = req.executors;
      const single = executors.length === 1 ? executors[0]!.value : undefined;
      return withActorResolved({
        verb: 'execute',
        args: single ? { id, by: single } : { id },
        reason:
          executors.length > 1
            ? `request is approved; one of [${executors
                .map((m) => m.value)
                .join(', ')}] should begin work — supply --by explicitly`
            : 'request is approved; executor should begin work',
      }, envActor);
    }
    case 'executing': {
      // Same multi-executor handling as the approved branch — when
      // multiple executors share the work the suggestion does not
      // pre-nominate one. Devil review #230 blocker 1.
      const executors = req.executors;
      const single = executors.length === 1 ? executors[0]!.value : undefined;
      return withActorResolved({
        verb: 'complete',
        args: single ? { id, by: single } : { id },
        reason:
          executors.length > 1
            ? `request is executing; the executor that ran the work should complete (or fail) when done — supply --by explicitly (assigned: ${executors
                .map((m) => m.value)
                .join(', ')})`
            : 'request is executing; executor should complete (or fail) when done',
      }, envActor);
    }
    case 'completed': {
      const reviewer = req.autoReview?.value;
      const reviewerDone = reviewer
        ? req.reviews.some((r) => r.by.value === reviewer)
        : false;
      if (reviewer && !reviewerDone) {
        // Intentionally NO `verdict` default: the Two-Persona Devil
        // Review loop exists because rubber-stamping is the failure
        // mode. Defaulting verdict to 'ok' would let an inattentive
        // agent chain-call the suggestion without actually reviewing.
        // The reviewer must supply verdict explicitly.
        return withActorResolved({
          verb: 'review',
          args: {
            id,
            by: reviewer,
            lense: 'devil',
          },
          reason: `auto-review assigned to ${reviewer} but no review recorded yet; supply --verdict <ok|concern|reject> and --comment after actually reading the work`,
        }, envActor);
      }
      // Completed-with-concern advisory. When any review carries a
      // concern/reject verdict, surface a `chain` walk as the next
      // hint — read-only, lets the reader perceive what (if anything)
      // already references this id. The reason names follow-up paths
      // explicitly alongside "leaving as-is, conversing it out, or
      // letting it fade — all first-class" so the absence of action
      // is not 2nd-class. The verb is `chain` (read), not `request`
      // (write), so the tool isn't pushing a dispute-resolution flow;
      // it's offering a perception aid.
      const hasConcern = req.reviews.some(
        (r) => r.verdict === 'concern' || r.verdict === 'reject',
      );
      if (hasConcern) {
        return withActorResolved({
          verb: 'chain',
          args: { id },
          reason:
            `concern recorded on ${id}; ` +
            `walk \`gate chain ${id}\` to see what (if anything) already references it. ` +
            'Possible follow-ups: file a follow-up request that mentions this id, ' +
            'file an issue tagging it — alongside leaving as-is, conversing it ' +
            'out, or letting it fade. All first-class.',
        }, envActor);
      }
      return null;
    }
    case 'denied':
    case 'failed':
      return null;
    default:
      return null;
  }
}

/**
 * Stamp `actor_resolved` onto a verb/args/reason triple. True when
 * the suggestion has no `by` argument (caller-agnostic) or its `by`
 * matches the calling actor. False when a different actor is named —
 * the orchestrator will need to escalate or hand off.
 */
function withActorResolved(
  partial: Omit<SuggestedNext, 'actor_resolved'>,
  envActor: string | null | undefined,
): SuggestedNext {
  const required = partial.args['by'];
  const resolved =
    required === undefined ||
    (typeof envActor === 'string' &&
      envActor.length > 0 &&
      required.toLowerCase() === envActor.toLowerCase());
  return { ...partial, actor_resolved: resolved };
}

export function buildWriteResponse(
  req: Request,
  message: string,
  config: GuildConfig,
  opts?: { voice?: string | null },
): WriteResponse {
  const envActor = resolveGuildActor() ?? null;
  const out: WriteResponse = {
    ok: true,
    id: req.id.value,
    state: req.state,
    message,
    suggested_next: deriveSuggestedNext(req, config, envActor),
  };
  if (opts?.voice !== undefined && opts.voice !== null) {
    out._meta = { voice: opts.voice };
  }
  return out;
}

/**
 * Single point where handlers emit their structured or text output.
 * Handlers pass in the new Request (post-mutation), the text fallback,
 * and any additional text lines (e.g. the auto-review template).
 * For --format json mode, additional text lines are dropped — the
 * suggested_next field replaces that information in structured form.
 */
export function emitWriteResponse(
  format: string,
  req: Request,
  message: string,
  config: GuildConfig,
  textLines: readonly string[] = [],
  opts?: { voice?: string | null },
): void {
  if (format === 'json') {
    const payload = buildWriteResponse(req, message, config, opts);
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }
  process.stdout.write(message + '\n');
  for (const line of textLines) process.stdout.write(line + '\n');
  // Ornamental voice in text mode: a single stderr line below the
  // structured output. stderr (not stdout) so JSON-piped consumers
  // who also enable text-mode rendering by accident don't see voice
  // mingle with parseable payload. Suppressed when null.
  //
  // Marker design (#382 dogfood-driven, polish PR-A2): use `⟶ ` (U+27F6)
  // as the voice line prefix instead of the v1 `(voice: …)` form.
  // Dogfood reflection found `(voice: …)` reading as a debug label
  // rather than a voice-line; the arrow marker signals "this is the
  // voiced echo of what just happened" without the parenthetical
  // hedge. Single character, monospace-safe, distinct from any
  // existing gate stderr prefix.
  if (opts?.voice !== undefined && opts.voice !== null) {
    process.stderr.write(`⟶ ${opts.voice}\n`);
  }
}
