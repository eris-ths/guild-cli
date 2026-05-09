import { SESSION_ID_RE } from '../../domain/request/Request.js';

/**
 * Resolve the caller's session_id (issue #249). Mirrors the
 * `resolveGuildActor` shape but env-only: the session is a per-shell
 * concept, not a substrate fact, so there is no `.guild-session-id`
 * file fallback by design — committing one to a repo would re-export
 * a single name across every collaborator and defeat the purpose.
 *
 * Resolution order:
 *   1. `process.env.GUILD_SESSION_ID` — exported by the caller's
 *      orchestrator after `gate boot --session-id <id>`.
 *   2. `undefined` — no session declared; verbs that consume this
 *      simply skip stamping. Records-outlive-writers (principle 04):
 *      an absent session_id reads identically pre- and post-#249.
 *
 * Validation: invalid values (regex mismatch, length over cap) are
 * treated as if unset and emit a one-time stderr notice so a typo
 * doesn't silently disable session stamping for the entire shell.
 * The notice fires at most once per process via a module-level flag.
 */
let warnedInvalid = false;

export function resolveGuildSessionId(): string | undefined {
  const env = process.env['GUILD_SESSION_ID'];
  if (env === undefined || env.length === 0) return undefined;
  if (!SESSION_ID_RE.test(env)) {
    if (!warnedInvalid) {
      warnedInvalid = true;
      process.stderr.write(
        `notice: GUILD_SESSION_ID="${env}" does not match the session_id ` +
          `format (lowercase alphanumeric + _-.: separators, ≤64 chars). ` +
          `Session stamping disabled for this invocation; fix the value ` +
          `or unset to suppress this notice.\n`,
      );
    }
    return undefined;
  }
  return env;
}
