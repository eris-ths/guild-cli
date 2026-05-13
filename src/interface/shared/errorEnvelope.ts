// errorEnvelope — shared JSON error envelope renderer for entry-point
// catch paths. Issue #194.
//
// Before this module: each passage entry (gate / agora / devil / ctx)
// caught errors and wrote `error: <msg>\n` to stderr. Only `gate`
// honored `--format json` and emitted the structured envelope; the
// other three silently dropped the format flag in their catch path.
// `lock_busy` (a DomainError subclass) made the asymmetry concrete:
// AI tool layers branching on `code` got nothing back from agora /
// devil / ctx.
//
// This helper extracts the gate's catch-path envelope logic so the
// four entries share one implementation. Behavior of `gate` is
// unchanged — it now calls `emitErrorEnvelope` instead of inlining
// the same lines. The other three entries call it too.
//
// Output shape (when format === 'json'):
//   stderr line 1: {"ok":false,"error":{"message":"...","code":"...","field":"..."}}
//   stderr line 2: error: <msg>
//   exit code: 1 (caller's responsibility)
//
// `field` is omitted when the underlying DomainError has none. `code`
// is omitted when `deriveErrorCode` returns null. Text-mode callers
// (format !== 'json') get only the `error:` prologue, which matches
// the pre-#194 behavior of all four entries.

import { DomainError } from '../../domain/shared/DomainError.js';
import { LockBusyError } from '../../infrastructure/lock/guildLock.js';
import { sanitizeError } from './sanitizeError.js';

/**
 * Per-call options for {@link emitErrorEnvelope}. All three are
 * additive so the original 3-arg call sites in the entry-point
 * outer-catches stay byte-identical.
 *
 * - `prefix` — concatenated to the raw error message *before*
 *   `sanitizeError` runs, so #153's contentRoot collapse still
 *   applies to anything the prefix names (e.g. `<input-path>`).
 *   Used by handler-internal catches that previously wrote
 *   `error: ${prefix}${e.message}` directly to stderr (#205).
 *
 * - `field` / `code` — caller-supplied fallbacks for synthetic
 *   error sites where the handler is reporting a CLI-shape
 *   problem (verb name, kind enum, --severity required, etc.)
 *   without a domain-layer DomainError instance to derive from.
 *
 * **Precedence rule (locked at the helper boundary, not the
 * caller's responsibility):**
 *   - `field`: a `DomainError.field` on `err` ALWAYS wins. `opts.field`
 *     is the fallback path used when `err` carries none.
 *   - `code`:  `deriveErrorCode(err)` ALWAYS wins when it returns a
 *     non-null code. `opts.code` is the fallback for everything else
 *     (including `null` from derive).
 *
 * Rationale: caught-error sites pass `prefix` to add CLI context
 * around a *real* domain failure; the domain field/code are
 * authoritative there. Synthetic sites construct nothing and rely
 * on `opts.field`/`opts.code`. The split keeps the helper's two
 * use-modes (caught vs synthetic) from contending for the same
 * envelope slots.
 */
export interface EmitOptions {
  readonly prefix?: string;
  readonly field?: string;
  readonly code?: string;
  /**
   * Structured next-step the caller can dispatch to recover. AI-first
   * agents read this in preference to parsing the prose `error:` line.
   * The `→ next:` text hint in the message body is the human-facing
   * mirror; the structured form here is its machine-readable sibling.
   *
   * Emitted as `error.recovery` in the JSON envelope. Text-mode runs
   * are unaffected — the prose hint remains the human surface.
   *
   * Shape mirrors `BootSuggestedNext` (verb + args + reason) so
   * orchestrators that already consume `boot.suggested_next` can
   * dispatch error recoveries with the same code path.
   *
   * Pattern documented under eris_first_overrides default rubric:
   * "shape upstream / content local" — the structured field is a
   * pure mechanism, equally useful to any AI agent reading errors.
   */
  readonly recovery?: Recovery;
}

/**
 * Structured recovery hint embedded in `error.recovery`. The caller
 * can dispatch the suggested verb + args directly without prose-
 * parsing.
 */
export interface Recovery {
  /** The verb to dispatch (e.g. `'deny'`, `'list'`). */
  verb: string;
  /** Flag/positional args as a key-value map (string-only values). */
  args: Record<string, string>;
  /** Human-readable explanation of why this is the recovery move. */
  reason: string;
}

/**
 * Error subclass carrying a structured recovery hint. Throw this
 * from handlers that have an obvious "use verb X instead" answer
 * for the failure case; the central error envelope catches it,
 * lifts `.recovery` into the JSON shape, and the prose message
 * lands on stderr unchanged for text-mode readers.
 *
 * Usage:
 * ```ts
 * throw new RecoverableError(
 *   'Request X is pending — fail is reachable only from executing.\n' +
 *     '  To cancel a pending request, use:\n' +
 *     '    gate deny X --by <m> --reason <s>',
 *   { verb: 'deny', args: { id: 'X' }, reason: 'pending cancel path' },
 * );
 * ```
 */
export class RecoverableError extends Error {
  readonly recovery: Recovery;
  constructor(message: string, recovery: Recovery) {
    super(message);
    this.name = 'RecoverableError';
    this.recovery = recovery;
  }
}

/**
 * Render the error envelope to stderr. The caller still owns the
 * exit code (so this stays a one-line addition in catch blocks).
 *
 * - `format === 'json'` → emit the JSON envelope, then the `error:`
 *   text prologue (matches gate's existing dual-output shape).
 * - any other format    → emit only the `error:` text prologue.
 *
 * See {@link EmitOptions} for the precedence contract on `prefix`,
 * `field`, `code`.
 */
export function emitErrorEnvelope(
  err: unknown,
  format: string | undefined,
  contentRoot: string,
  opts: EmitOptions = {},
): void {
  const rawMsg = err instanceof Error ? err.message : String(err);
  const prefixed = opts.prefix ? `${opts.prefix}${rawMsg}` : rawMsg;
  const msg = sanitizeError(prefixed, contentRoot);
  if (format === 'json') {
    const errObj: Record<string, unknown> = { message: msg };
    // field: err.field wins; opts.field is fallback (see EmitOptions doc).
    if (err instanceof DomainError && err.field !== undefined) {
      errObj['field'] = err.field;
    } else if (opts.field !== undefined) {
      errObj['field'] = opts.field;
    }
    // code: deriveErrorCode(err) wins; opts.code is fallback.
    const derived = deriveErrorCode(err);
    if (derived !== null) {
      errObj['code'] = derived;
    } else if (opts.code !== undefined) {
      errObj['code'] = opts.code;
    }
    // recovery: structured next-step. Source priority:
    //   1. `err instanceof RecoverableError` → err.recovery wins
    //      (the throw site authored the recovery; honour it).
    //   2. opts.recovery → caller of emitErrorEnvelope supplied one.
    //   3. absence → no `recovery` field on the wire.
    // Consumers branch on field presence; absence is the no-known-
    // recovery signal. Today only the throw sites with an obvious
    // "use verb X instead" answer pass this — generic not-found /
    // validation errors keep their existing prose-only surface
    // until a wire-up sweep follows.
    const recovery =
      err instanceof RecoverableError ? err.recovery : opts.recovery;
    if (recovery !== undefined) {
      errObj['recovery'] = recovery;
    }
    const payload = { ok: false, error: errObj };
    process.stderr.write(JSON.stringify(payload) + '\n');
  }
  process.stderr.write(`error: ${msg}\n`);
}

/**
 * Macro-level error classification for the JSON envelope. Patterns
 * match the current set of `DomainError` messages so a tool layer
 * can branch on `code` instead of regex-matching the prose.
 *
 * The codes are intentionally coarse (a 4-way fork covers most retry
 * / escalate decisions): fine-grained differentiation stays in the
 * `message` + `field` pair.
 *
 * Message-pattern derivation rather than a per-throw `code` argument
 * keeps the change surgical — adding a code later at the throw site
 * remains compatible; a call that doesn't yet name one still produces
 * the right classification here.
 */
export function deriveErrorCode(e: unknown): string | null {
  if (!(e instanceof Error)) return null;
  // LockBusyError check is first: it's a DomainError subclass, so the
  // generic `validation_error` fallback below would otherwise shadow
  // the more-specific `lock_busy` code. Tools branching on this need
  // to distinguish "retry-after-backoff" (lock busy) from
  // "fix-input-and-resubmit" (validation).
  if (e instanceof LockBusyError) return 'lock_busy';
  const m = e.message;
  if (/\bnot found\b/i.test(m)) return 'not_found';
  if (/\bis already \w+\.?/i.test(m)) return 'already_in_state';
  if (/illegal state transition/i.test(m)) return 'illegal_transition';
  if (e instanceof DomainError) return 'validation_error';
  return null;
}
