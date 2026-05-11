// Lifecycle hook plugin contract (issue #36 Phase 1 step 5).
//
// A hook plugin subscribes to one or more lifecycle events and runs
// at the corresponding point in the dispatch pipeline. There are two
// flavours:
//
//   `before:<verb>`  — runs after argument validation, before the
//                      mutation. May veto by returning
//                      `{ allow: false, reason }`. A veto blocks the
//                      transition; the handler returns exit code 1 and
//                      writes the reason to stderr. First veto wins —
//                      remaining `before:` hooks for the same event
//                      do NOT run after a veto, so an order-sensitive
//                      "deny everything else" hook can sit at the end.
//
//   `after:<verb>`   — runs after the mutation succeeded, before the
//                      handler emits its write response. Cannot veto
//                      (the transition already happened). Errors are
//                      logged to stderr but never break the handler.
//                      Use for audit trails / external notification /
//                      derived index rebuilds.
//
// Events covered in phase 1 (request lifecycle + review):
//   before/after:approve, deny, execute, complete, fail, review
//
// Hooks run in the order their plugin paths appear in
// `plugins.hooks` in `guild.config.yaml`. Same trust model as verb
// plugins: `plugins.trusted: true` is the consent gate, plugins
// run in-process with full Node capabilities. See `SECURITY.md`
// § "Plugin trust model".

import type { Request } from '../../domain/request/Request.js';
import type { DevilReview } from '../../passages/devil/domain/DevilReview.js';
import type { SessionEvent } from '../../domain/session/SessionEvent.js';

/**
 * The lifecycle events a hook can subscribe to.
 *
 * Phase 1 (#259): the six request transitions plus review.
 * Phase 2 (#290): the three session-boundary verbs (rest / wake /
 *   farewell, #261-#263). These do not transition request state —
 *   they stamp a `SessionEvent` record. Hooks see the event on
 *   `ctx.sessionEvent` (instead of `ctx.request`).
 *
 * fast-track / claim / witness / unwitness / thank are intentionally
 * out of scope — they either compose multiple events (fast-track) or
 * sit on a different axis from state transitions (the stake/observe
 * verbs). Adding those is additive within the 0.x line per
 * `docs/POLICY.md` § "Plugin stability".
 */
export type HookEvent =
  | 'before:approve' | 'after:approve'
  | 'before:deny'    | 'after:deny'
  | 'before:execute' | 'after:execute'
  | 'before:complete' | 'after:complete'
  | 'before:fail'    | 'after:fail'
  | 'before:review'  | 'after:review'
  | 'before:rest'    | 'after:rest'
  | 'before:wake'    | 'after:wake'
  | 'before:farewell' | 'after:farewell';

export const ALL_HOOK_EVENTS: readonly HookEvent[] = [
  'before:approve', 'after:approve',
  'before:deny',    'after:deny',
  'before:execute', 'after:execute',
  'before:complete', 'after:complete',
  'before:fail',    'after:fail',
  'before:review',  'after:review',
  'before:rest',    'after:rest',
  'before:wake',    'after:wake',
  'before:farewell', 'after:farewell',
];

/**
 * Per-event context the hook receives.
 *
 * EXACTLY ONE of `request` / `sessionEvent` is populated, picked by
 * which verb fired the hook:
 *
 *   - request-lifecycle events (`approve`, `deny`, `execute`,
 *     `complete`, `fail`, `review`) populate `request` — pre-mutation
 *     snapshot for `before:` events (so a veto sees the original
 *     state), post-mutation for `after:` events (so an audit hook
 *     sees the new state).
 *
 *   - session-boundary events (`rest`, `wake`, `farewell`, #290)
 *     populate `sessionEvent` — the `SessionEvent` aggregate that
 *     either WILL be saved (before) or HAS been saved (after).
 *     `request` is undefined; a plugin that only handles
 *     request-lifecycle events should null-check `ctx.request` and
 *     return early when absent.
 *
 * `actor` is the canonicalised `--by` / `--from` invoker, populated
 * for both subject kinds.
 *
 * `extra` carries event-specific payload — currently only `review`
 * uses it (carries the DevilReview-like record). Kept as an optional
 * discriminated field so future events can extend without a breaking
 * change to the base shape.
 *
 * Why orthogonal optionals (Option B) rather than a discriminated
 * `subject: { kind, ... }` (Option A): existing plugins read
 * `ctx.request.X` directly. Option B keeps that exact path working
 * — the only migration is one defensive null-check at the top of a
 * hook that subscribes to a session-boundary event. Option A would
 * have forced every existing access site through a discriminator
 * branch. See commit message + #290 for the trade analysis.
 */
export interface HookContext {
  readonly event: HookEvent;
  /** Populated for request-lifecycle events (approve/deny/execute/
   *  complete/fail/review). Undefined for session-boundary events. */
  readonly request?: Request;
  /** Populated for session-boundary events (rest/wake/farewell, #290).
   *  Undefined for request-lifecycle events. */
  readonly sessionEvent?: SessionEvent;
  readonly actor: string;
  readonly extra?: { readonly review?: DevilReview | unknown };
}

/**
 * Veto result from a `before:` hook. Returning this from a `before:`
 * hook blocks the transition; the handler exits 1 and writes the
 * reason to stderr.
 */
export interface HookVeto {
  readonly allow: false;
  readonly reason: string;
}

/**
 * Hook function shape. Async to accommodate plugins that need I/O
 * (audit trail write, external notification). Per the issue's
 * "must not block the transition on slow I/O" rule, hooks should
 * keep blocking work small — for unbounded work, spawn and return.
 */
export type HookFn = (ctx: HookContext) => Promise<void | HookVeto> | void | HookVeto;

/**
 * Plugin module's default export shape for hook plugins.
 *
 * `on` may name a single event or an array of events; the bus
 * subscribes the same `run` function to each entry. Use the array
 * form when one piece of logic spans multiple lifecycle points
 * (e.g. an audit hook covering `after:approve` / `after:complete`
 * / `after:fail` / `after:deny`).
 */
export interface HookPlugin {
  readonly on: HookEvent | readonly HookEvent[];
  readonly run: HookFn;
}

/**
 * Per-path load failure. Same shape as `VerbPluginLoadError`,
 * surfaced through `gate doctor` as an `area: 'plugin'` finding.
 */
export interface HookPluginLoadError {
  readonly path: string;
  readonly reason: string;
}

/**
 * Result of a single load pass. `subscriptions` is the resolved
 * map from event → ordered list of HookFn (one entry per (plugin,
 * event) pair, in plugin-path order). Empty arrays for unsubscribed
 * events are omitted — readers `.get(event) ?? []`.
 */
export interface HookPluginLoadResult {
  readonly subscriptions: ReadonlyMap<HookEvent, readonly HookFn[]>;
  readonly errors: readonly HookPluginLoadError[];
  readonly pluginsLoaded: ReadonlyArray<{ path: string; status: 'loaded' | 'error' }>;
}
