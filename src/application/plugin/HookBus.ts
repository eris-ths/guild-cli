// Hook dispatch helpers (issue #36 Phase 1 step 5).
//
// Two entry points the lifecycle handlers call:
//
//   `fireBeforeHook(subs, event, request, actor)` → HookVeto | null
//     Runs every subscriber to `before:<event>` in registration order.
//     First veto wins — remaining hooks do NOT run after a veto.
//     A hook that throws is treated as a veto (fail-closed) — a buggy
//     security policy hook should block the transition, not silently
//     pass it through.
//
//   `fireAfterHook(subs, event, request, actor)` → void
//     Runs every subscriber to `after:<event>` in order. Errors are
//     written to stderr but never propagate; the transition has
//     already succeeded by this point and the response is about to
//     be emitted, so a failing hook is a warning, not a fault.

import {
  HookContext,
  HookEvent,
  HookFn,
  HookVeto,
} from './HookPlugin.js';
import type { Request } from '../../domain/request/Request.js';
import type { SessionEvent } from '../../domain/session/SessionEvent.js';

export type HookSubscriptions = ReadonlyMap<HookEvent, readonly HookFn[]>;

/**
 * The verb half of a request-lifecycle hook event. Used by handlers
 * to compose `before:<verb>` / `after:<verb>` without typo risk on
 * the prefix.
 */
export type LifecycleVerb =
  | 'approve'
  | 'deny'
  | 'execute'
  | 'complete'
  | 'fail'
  | 'review';

/**
 * The verb half of a session-boundary hook event (#290 — Phase 2
 * extension to the hook bus). Same shape as `LifecycleVerb` but
 * for the rest/wake/farewell axis, where the subject is a
 * `SessionEvent` rather than a `Request`.
 */
export type SessionVerb = 'rest' | 'wake' | 'farewell';

function toEvent(
  prefix: 'before' | 'after',
  verb: LifecycleVerb | SessionVerb,
): HookEvent {
  return `${prefix}:${verb}` as HookEvent;
}

/**
 * Fire every `before:<verb>` subscriber in order. Returns the first
 * veto seen, or null if all hooks passed (or none subscribed). Hook
 * errors are converted to vetoes — see file header for rationale.
 */
export async function fireBeforeHook(
  subs: HookSubscriptions,
  verb: LifecycleVerb,
  request: Request,
  actor: string,
  extra?: HookContext['extra'],
): Promise<HookVeto | null> {
  const event = toEvent('before', verb);
  const fns = subs.get(event);
  if (!fns || fns.length === 0) return null;
  const ctx: HookContext = extra !== undefined
    ? { event, request, actor, extra }
    : { event, request, actor };
  for (const fn of fns) {
    let result: void | HookVeto;
    try {
      result = await fn(ctx);
    } catch (e) {
      return {
        allow: false,
        reason: `hook threw on ${event}: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    if (result && typeof result === 'object' && (result as HookVeto).allow === false) {
      return result as HookVeto;
    }
  }
  return null;
}

/**
 * Fire every `after:<verb>` subscriber in order. Hooks errors are
 * written to stderr as warnings; they never break the handler.
 */
export async function fireAfterHook(
  subs: HookSubscriptions,
  verb: LifecycleVerb,
  request: Request,
  actor: string,
  extra?: HookContext['extra'],
): Promise<void> {
  const event = toEvent('after', verb);
  const fns = subs.get(event);
  if (!fns || fns.length === 0) return;
  const ctx: HookContext = extra !== undefined
    ? { event, request, actor, extra }
    : { event, request, actor };
  for (const fn of fns) {
    try {
      await fn(ctx);
    } catch (e) {
      process.stderr.write(
        `warning: hook threw on ${event}: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  }
}

/**
 * Render a veto into the standard handler stderr format and return
 * exit code 1. Centralised so every lifecycle handler emits the same
 * shape — an operator's grep for "hook vetoed" finds the entry
 * regardless of which verb tripped.
 *
 * Accepts both `LifecycleVerb` (request-axis) and `SessionVerb`
 * (rest/wake/farewell-axis, #290) so the session handlers reuse the
 * same render path.
 */
export function emitHookVeto(
  verb: LifecycleVerb | SessionVerb,
  id: string,
  veto: HookVeto,
): number {
  process.stderr.write(
    `error: hook vetoed ${verb} on ${id}: ${veto.reason}\n`,
  );
  return 1;
}

// -------------------- Session-boundary fire helpers (#290) -----------------
//
// Same dispatch contract as the request-shaped fires above:
//   - first veto wins; before-hook errors fail-closed
//   - after-hook errors written to stderr but never propagate
// The only difference is the subject populated on `HookContext`:
// `sessionEvent` instead of `request`. Hook authors discriminate by
// either `ctx.event` (string) or null-checking which field is set.

/**
 * Fire every `before:<sessionVerb>` subscriber in order. Returns the
 * first veto seen, or null if all hooks passed (or none subscribed).
 * Hook errors are converted to vetoes — see file header for rationale.
 *
 * The `event` argument is the **pre-save** SessionEvent — the verb
 * handler builds the aggregate, fires before-hooks, then persists
 * only if no veto. A vetoed `gate rest` therefore writes nothing to
 * the session log; the substrate stays untouched.
 */
export async function fireBeforeSessionHook(
  subs: HookSubscriptions,
  verb: SessionVerb,
  event: SessionEvent,
  actor: string,
): Promise<HookVeto | null> {
  const hookEvent = toEvent('before', verb);
  const fns = subs.get(hookEvent);
  if (!fns || fns.length === 0) return null;
  const ctx: HookContext = { event: hookEvent, sessionEvent: event, actor };
  for (const fn of fns) {
    let result: void | HookVeto;
    try {
      result = await fn(ctx);
    } catch (e) {
      return {
        allow: false,
        reason: `hook threw on ${hookEvent}: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    if (result && typeof result === 'object' && (result as HookVeto).allow === false) {
      return result as HookVeto;
    }
  }
  return null;
}

/**
 * Fire every `after:<sessionVerb>` subscriber in order. Hook errors
 * are written to stderr as warnings; they never break the handler.
 *
 * The `event` argument is the **post-save** SessionEvent — the
 * record has already landed on disk, so an after-hook can rely on
 * the id being final and the YAML being readable.
 */
export async function fireAfterSessionHook(
  subs: HookSubscriptions,
  verb: SessionVerb,
  event: SessionEvent,
  actor: string,
): Promise<void> {
  const hookEvent = toEvent('after', verb);
  const fns = subs.get(hookEvent);
  if (!fns || fns.length === 0) return;
  const ctx: HookContext = { event: hookEvent, sessionEvent: event, actor };
  for (const fn of fns) {
    try {
      await fn(ctx);
    } catch (e) {
      process.stderr.write(
        `warning: hook threw on ${hookEvent}: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  }
}
