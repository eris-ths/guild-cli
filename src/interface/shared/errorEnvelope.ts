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
