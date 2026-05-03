import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Resolve the default actor name for `--from` / `--by` / `--for` /
 * `--with` when no explicit flag is given. Resolution order:
 *
 *   1. `process.env.GUILD_ACTOR` — env vars work for shell-driven use.
 *   2. `.guild-actor` file — first ancestor directory of `cwd` that
 *      contains one wins. Single-line, leading/trailing whitespace
 *      trimmed.
 *   3. `undefined` — caller decides whether absence is an error.
 *      (Returns `undefined` not `null` so callers can use this as a
 *      drop-in replacement for `process.env['GUILD_ACTOR']`, which is
 *      where the legacy code was reading.)
 *
 * Why both? Per
 * `lore/principles/11-ai-first-human-as-projection.md`, env vars are a
 * projection-layer convenience: they require a configured shell, don't
 * survive subprocess boundaries (e.g. AI agents whose Bash tools spawn
 * fresh shells per call), and aren't substrate. The `.guild-actor` file
 * is substrate — committed-or-not is a per-actor choice, but it lives
 * in the content_root tree alongside `guild.config.yaml`, and resolution
 * follows the same ancestor-walking pattern (see `findConfig` in
 * `infrastructure/config/GuildConfig.ts`).
 *
 * Env beats file. The legacy contract is "env wins"; users with
 * `GUILD_ACTOR` set in their shell shouldn't see a quietly-different
 * actor when a colleague drops a `.guild-actor` into the repo. The
 * file-fallback fires only when the env is genuinely unset.
 *
 * Surfaced by issue i-2026-05-03-0001 from the develop-branch dogfood:
 * the AI-agent loop using `Bash` tool calls cannot rely on shell env
 * because each subprocess is fresh. The substrate-file fallback closes
 * that gap without breaking anyone's existing env-based setup.
 */
export function resolveGuildActor(start: string = process.cwd()): string | undefined {
  const env = process.env['GUILD_ACTOR'];
  if (env !== undefined && env.length > 0) return env;
  return findActorFile(start);
}

/**
 * Walk up from `start` looking for `.guild-actor`. Returns the first
 * file's trimmed contents or `undefined` if none found within the lookup
 * window. Same 10-level cap as `findConfig`; cross-platform via
 * `path.resolve('..')`.
 */
function findActorFile(start: string): string | undefined {
  let dir = resolve(start);
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, '.guild-actor');
    if (existsSync(candidate)) {
      const raw = readFileSync(candidate, 'utf8').trim();
      if (raw.length > 0) return raw;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
