import { Request } from '../../../domain/request/Request.js';
import { GuildConfig } from '../../../infrastructure/config/GuildConfig.js';
import { ParsedArgs, optionalOption } from '../../shared/parseArgs.js';

/**
 * Shared `--format <json|text>` parser so every write handler validates
 * the value identically. Text is the default to keep the `✓ ...`
 * muscle memory intact for humans; agents opt into json explicitly.
 */
export function parseFormat(args: ParsedArgs): 'json' | 'text' {
  const raw = optionalOption(args, 'format') ?? 'text';
  if (raw !== 'json' && raw !== 'text') {
    throw new Error(`--format must be 'json' or 'text', got: ${raw}`);
  }
  return raw;
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
}

export interface SuggestedNext {
  /** The verb an agent should invoke next, e.g. "review" or "execute". */
  verb: string;
  /** Arguments pre-filled from the record. Actor fields are hints,
   *  not assertions — the agent may override when it knows better. */
  args: Record<string, string>;
  /** One-line explanation of why this verb is suggested. */
  reason: string;
}

/**
 * Derive the most likely next action given the current request state.
 * Deterministic — no I/O, no randomness — so an agent can trust the
 * suggestion to match what the repository sees.
 *
 *   pending    → approve (host or executor decides)
 *   approved   → execute (by executor)
 *   executing  → complete (by executor)
 *   completed  → review if an auto-reviewer is assigned and they
 *                haven't reviewed yet; null otherwise (terminal-done)
 *   denied     → null (terminal)
 *   failed     → null (terminal)
 */
export function deriveSuggestedNext(
  req: Request,
  config: GuildConfig,
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
        return {
          verb: 'approve',
          args: { id, by: hosts[0]! },
          reason: `request is pending; host ${hosts[0]} must approve (or deny) before execution`,
        };
      }
      return {
        verb: 'approve',
        args: { id },
        reason:
          hosts.length === 0
            ? 'request is pending; a registered host must approve — none are configured yet'
            : `request is pending; approve by one of the configured hosts [${hosts.join(', ')}] (or deny)`,
      };
    }
    case 'approved': {
      const executor = req.executor?.value ?? '';
      return {
        verb: 'execute',
        args: executor ? { id, by: executor } : { id },
        reason: 'request is approved; executor should begin work',
      };
    }
    case 'executing': {
      const executor = req.executor?.value ?? '';
      return {
        verb: 'complete',
        args: executor ? { id, by: executor } : { id },
        reason: 'request is executing; executor should complete (or fail) when done',
      };
    }
    case 'completed': {
      if (!req.autoReview) return null;
      const reviewer = req.autoReview.value;
      const alreadyReviewed = req.reviews.some(
        (r) => r.by.value === reviewer,
      );
      if (alreadyReviewed) return null;
      // Intentionally NO `verdict` default: the Two-Persona Devil
      // Review loop exists because rubber-stamping is the failure
      // mode. Defaulting verdict to 'ok' would let an inattentive
      // agent chain-call the suggestion without actually reviewing.
      // The reviewer must supply verdict explicitly.
      return {
        verb: 'review',
        args: {
          id,
          by: reviewer,
          lense: 'devil',
        },
        reason: `auto-review assigned to ${reviewer} but no review recorded yet; supply --verdict <ok|concern|reject> and --comment after actually reading the work`,
      };
    }
    case 'denied':
    case 'failed':
      return null;
    default:
      return null;
  }
}

export function buildWriteResponse(
  req: Request,
  message: string,
  config: GuildConfig,
): WriteResponse {
  return {
    ok: true,
    id: req.id.value,
    state: req.state,
    message,
    suggested_next: deriveSuggestedNext(req, config),
  };
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
): void {
  if (format === 'json') {
    const payload = buildWriteResponse(req, message, config);
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }
  process.stdout.write(message + '\n');
  for (const line of textLines) process.stdout.write(line + '\n');
}
