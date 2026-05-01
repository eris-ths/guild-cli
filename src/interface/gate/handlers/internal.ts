import { buildContainer } from '../../shared/container.js';
import { optionalOption, ParsedArgs } from '../../shared/parseArgs.js';
import { RequestJSON } from '../voices.js';

/**
 * Shared private helpers for gate command handlers.
 * Not part of the public surface — anything here may change between
 * patch releases (see POLICY.md).
 */

export type C = ReturnType<typeof buildContainer>;

export function parseOptionalIntOption(
  args: ParsedArgs,
  key: string,
): number | undefined {
  const raw = optionalOption(args, key);
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || String(n) !== raw) {
    throw new Error(`--${key} must be a non-negative integer, got: ${raw}`);
  }
  return n;
}

// Safely truncate a string by Unicode code points, not UTF-16 code units,
// so we never cleave a surrogate pair in half. Appends "..." when cut.
export function truncateCodePoints(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  return chars.slice(0, max - 3).join('') + '...';
}

// Shared loader for cross-cutting reads (voices, tail, whoami, chain).
// Delegates to RequestUseCases.listAll which reads every state
// directory in parallel and dedupes on id in case a concurrent
// transition has moved a file between directories during the scan.
export async function loadAllRequestsAsJson(c: C): Promise<RequestJSON[]> {
  const all = await c.requestUC.listAll();
  return all.map((r) => r.toJSON() as unknown as RequestJSON);
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Pure derivation of the invoker: returns the GUILD_ACTOR value when
 * it differs from `by`, undefined otherwise. No side effects. Use
 * this when the id isn't known yet (e.g. the verb creates a fresh
 * record) and you need to pass the value into the use case before
 * emitting the user-facing delegation notice.
 */
export function deriveInvokedBy(by: string): string | undefined {
  const envActor = process.env['GUILD_ACTOR'];
  if (!envActor || envActor.length === 0) return undefined;
  if (envActor === by) return undefined;
  return envActor;
}

/**
 * Print the one-line stderr delegation notice. Kept separate from
 * `deriveInvokedBy` so creation paths can call it after the new
 * record's id is available. `target` is the record identity (a
 * request / issue id, or a recipient name for message).
 */
export function emitInvokedByNotice(
  by: string,
  invokedBy: string,
  verb: string,
  target: string,
): void {
  // The prefix "invoked by X on behalf of Y" already names both the
  // real hand (X) and the on-record attribution (Y); the earlier
  // "(invoked_by recorded as X)" suffix only restated X. Dropped to
  // keep the line tight — the fact that invoked_by is persisted is
  // part of the contract, not something to re-announce on every call.
  process.stderr.write(
    `# ${verb} ${target}: invoked by ${invokedBy} on behalf of ${by}\n`,
  );
}

/**
 * Convenience wrapper: derive + emit when the id is already known.
 * Mirrors the inbox `read_by` pattern: `by` is who the act is
 * attributed to, GUILD_ACTOR is who actually ran the CLI command,
 * and the trail keeps both honest when they disagree.
 */
export function resolveInvokedBy(
  by: string,
  verb: string,
  id: string,
): string | undefined {
  const invokedBy = deriveInvokedBy(by);
  if (invokedBy !== undefined) {
    emitInvokedByNotice(by, invokedBy, verb, id);
  }
  return invokedBy;
}

/**
 * Shared --dry-run detector for write verbs. Accepted as `--dry-run`
 * or `--dry-run=true`. Anything else (missing, or explicit `=false`)
 * returns false.
 *
 * The agent use case: "what would this command do?" before committing.
 * Humans can try-undo; agents lack that affordance and benefit from a
 * safe preview. Repair already has --apply vs --dry-run; this extends
 * the same contract to the state-transition verbs.
 */
export function isDryRun(args: ParsedArgs): boolean {
  const v = args.options['dry-run'];
  if (v === true) return true;
  if (typeof v === 'string' && v.toLowerCase() === 'true') return true;
  return false;
}

/**
 * Emit a dry-run preview envelope on stdout (JSON only — text callers
 * already have `gate show` for inspection, and the preview is mostly
 * an agent-facing affordance).
 *
 * Shape:
 *   {
 *     "dry_run": true,
 *     "verb": "approve",
 *     "id": "...",
 *     "by": "...",
 *     "would_transition": {"from": "pending", "to": "approved"},
 *     "preview": { full request JSON post-mutation, NOT persisted }
 *   }
 *
 * `would_transition` is omitted when the verb doesn't cross states
 * (review). `preview` always reflects the unsaved in-memory object
 * so the caller sees exactly what would land if they dropped
 * `--dry-run`.
 *
 * When the caller passed `--format text`, the envelope is still JSON
 * (the dry_run/verb/would_transition triple has no useful text
 * rendering) — but a one-line stderr notice names that contract so
 * the format-flag override doesn't read as silent fail-open. The
 * notice points at WHY the format is fixed (the envelope is
 * structured) rather than just announcing the override.
 */
export function emitDryRunPreview(p: {
  verb: string;
  id: string;
  by: string;
  fromState?: string;
  toState?: string;
  after: { toJSON(): Record<string, unknown> };
  format?: string;
}): void {
  if (p.format !== undefined && p.format !== 'json') {
    process.stderr.write(
      '# --dry-run preview is structured (json envelope); --format ' +
        `${p.format} would lose dry_run/verb/would_transition.\n`,
    );
  }
  const envelope: Record<string, unknown> = {
    dry_run: true,
    verb: p.verb,
    id: p.id,
    by: p.by,
  };
  if (p.fromState !== undefined && p.toState !== undefined) {
    envelope['would_transition'] = { from: p.fromState, to: p.toState };
  }
  envelope['preview'] = p.after.toJSON();
  process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
}

/**
 * Surface the same misconfigured-cwd hint that `gate boot` emits, so
 * `gate status` / `gate doctor` users (the most common first commands)
 * also notice when they're sitting in the wrong directory. Stays on
 * stderr so JSON consumers stay clean and pipelines (e.g.
 * `gate doctor --format json | gate repair`) keep working.
 *
 * Mirrors boot's gate (boot.ts:165-173): warn ONLY when no config
 * was found AND there is no data — that distinguishes "wrong cwd"
 * from "intentional fresh start with explicit cwd-as-root".
 */
export function warnIfMisconfiguredCwd(c: C, isEmpty: boolean): void {
  if (c.config.configFile !== null) return;
  if (!isEmpty) return;
  process.stderr.write(
    `⚠️  no guild.config.yaml found, falling back to cwd: ${c.config.contentRoot}\n` +
      `   (likely wrong cwd, not a fresh start — cd into the directory\n` +
      `    that contains guild.config.yaml, or run 'gate register --name <you>'\n` +
      `    here if you really mean to use this directory as the guild root.)\n`,
  );
}

// --- Editor fallback for long-form review comments ---------------------
//
// When `gate review` is called without --comment / positional / STDIN
// and stdin is a TTY, we spawn the user's editor on a temp file —
// mirroring `git commit`'s behavior. This removes the friction of
// quoting multi-paragraph reviews on one bash line, and sidesteps
// pipe-handling quirks on Windows git-bash that made `--comment -`
// unreliable for some users.
//
// We follow git's "scissors" convention: everything at and below the
// line `# ------------------------ >8 ------------------------`
// is stripped from the body before the comment is recorded. This is
// unambiguous (no false positives on legitimate `#heading` markdown)
// and familiar to anyone who has used `git commit --cleanup=scissors`.

export const EDITOR_SCISSORS =
  '# ------------------------ >8 ------------------------';

/**
 * Strip the scissors line (and everything below it) from the editor
 * buffer and trim. Pure — no I/O — so the logic can be unit-tested
 * without spawning an editor.
 *
 * Separated from `readCommentViaEditor` because the spawn path is
 * hard to mock portably; the cleaning path is where real bugs hide,
 * and this is testable in isolation.
 */
export function stripEditorComments(raw: string): string {
  const idx = raw.indexOf(EDITOR_SCISSORS);
  const body = idx >= 0 ? raw.slice(0, idx) : raw;
  return body.trim();
}

/**
 * Pick the user's preferred editor, following the git convention:
 *   GIT_EDITOR > VISUAL > EDITOR > platform default.
 * The platform default is `notepad` on Windows and `vi` everywhere
 * else, matching what Git for Windows installs out of the box.
 */
export function pickEditor(): string {
  const env = process.env;
  if (env['GIT_EDITOR']) return env['GIT_EDITOR'];
  if (env['VISUAL']) return env['VISUAL'];
  if (env['EDITOR']) return env['EDITOR'];
  return process.platform === 'win32' ? 'notepad' : 'vi';
}

/**
 * Open the user's editor on a temp file pre-filled with a guidance
 * template, wait for the editor to exit, and return the cleaned
 * comment body.
 *
 * Throws if:
 *   - the editor fails to launch (e.g. `EDITOR=nonexistent`)
 *   - the editor exits with non-zero status (e.g. `:cq` in vim)
 *   - the cleaned body is empty after stripping the scissors block
 *
 * The empty-body throw matches `git commit` semantics — empty
 * message aborts with an explicit error, never silently records a
 * blank entry. Pre-fix the function returned `''` and let the
 * caller's generic "review comment is required (use --comment ...
 * or run interactively so $EDITOR opens)" error fire — but the
 * caller's hint is misleading when the user just *did* run
 * interactively. The throw at this layer carries the right context.
 *
 * The caller is expected to surface the thrown Error to the user
 * with the outer CLI error handler.
 */
export async function readCommentViaEditor(context: {
  id: string;
  by: string;
  lense: string;
  verdict: string;
}): Promise<string> {
  // Lazy imports so test environments that never hit this path
  // don't pay the fs/child_process cost at module load.
  const fs = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { join: pathJoin } = await import('node:path');

  const editor = pickEditor();
  const dir = fs.mkdtempSync(pathJoin(tmpdir(), 'gate-review-'));
  const file = pathJoin(dir, 'REVIEW_EDITMSG');

  const template = [
    '',
    '',
    EDITOR_SCISSORS,
    '# Write your review comment ABOVE the scissors line.',
    '# The scissors line and everything below it are stripped.',
    '# An empty message aborts the review.',
    '#',
    '# Context:',
    `#   id:      ${context.id}`,
    `#   by:      ${context.by}`,
    `#   lense:   ${context.lense}`,
    `#   verdict: ${context.verdict}`,
    '#',
    '# Note for VSCode users: set EDITOR="code --wait" so the CLI blocks',
    '# until you close the tab. Without --wait, `code` returns immediately',
    '# and gate will see an empty file.',
    '',
  ].join('\n');
  fs.writeFileSync(file, template, 'utf8');

  try {
    const result = spawnSync(editor, [file], { stdio: 'inherit' });
    if (result.error) {
      throw new Error(
        `failed to launch editor "${editor}": ${result.error.message}. ` +
          `Set $GIT_EDITOR, $VISUAL, or $EDITOR to a valid editor command.`,
      );
    }
    if (typeof result.status === 'number' && result.status !== 0) {
      throw new Error(
        `editor "${editor}" exited with status ${result.status}; aborting review.`,
      );
    }
    const raw = fs.readFileSync(file, 'utf8');
    const body = stripEditorComments(raw);
    if (body.length === 0) {
      throw new Error(
        'editor returned an empty review body; aborting. ' +
          'Re-run and write content above the scissors line, ' +
          'or use --comment / --comment - / a positional.',
      );
    }
    return body;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
