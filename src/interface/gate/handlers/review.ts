import {
  ParsedArgs,
  requireOption,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import {
  C,
  readStdin,
  readCommentViaEditor,
  resolveInvokedBy,
  isDryRun,
  emitDryRunPreview,
} from './internal.js';
import { emitWriteResponse, parseFormat } from './writeFormat.js';

const REVIEW_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'lense',
  'verdict',
  'comment',
  'dry-run',
  'format',
]);

export async function reqReview(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, REVIEW_KNOWN_FLAGS, 'review');
  const id = args.positional[0];
  if (!id) {
    throw new Error(
      'Usage: gate review <id> --by <m> --lense <l> --verdict <v> ' +
        '[--comment <s> | --comment - | <comment>]',
    );
  }
  const by = requireOption(args, 'by', '--by required', 'GUILD_ACTOR');
  const lense = requireOption(args, 'lense', '--lense required');
  const verdict = requireOption(args, 'verdict', '--verdict required');

  // Comment resolution order:
  //   1. --comment <s>    option value (inline short comment)
  //   2. --comment -      STDIN until EOF (for piped/heredoc input)
  //   3. <positional>     legacy: everything after <id>
  //   4. $EDITOR fallback when stdin is a TTY and none of the above
  //                       were given — matches `git commit` convention,
  //                       sidesteps the Windows git-bash pipe issues
  //                       that made (2) unreliable for some users.
  const commentOpt = optionalOption(args, 'comment');
  const positional = args.positional.slice(1).join(' ');
  let comment: string;
  if (commentOpt === '-') {
    comment = await readStdin();
  } else if (commentOpt !== undefined) {
    comment = commentOpt;
  } else if (positional === '-') {
    // Positional `-` gets the same stdin-sentinel treatment as
    // `--comment -`. Symmetry: users reach for `gate review <id> ...
    // - <<EOF` naturally (same shape as `--comment -`); the literal
    // "-" as a comment body is almost never what anyone means.
    comment = await readStdin();
  } else if (positional) {
    comment = positional;
  } else if (process.stdin.isTTY) {
    comment = await readCommentViaEditor({ id, by, lense, verdict });
  } else {
    comment = '';
  }
  if (!comment.trim()) {
    const hint =
      args.options['comment'] === true
        ? '\n  (Your --comment value began with "--" and was not consumed. ' +
          'Use --comment=<value> or put "-- <value>" after the other flags.)'
        : '';
    throw new Error(
      'review comment is required (use --comment <s>, --comment - for STDIN, ' +
        'a positional argument, or run interactively so $EDITOR opens)' +
        hint,
    );
  }

  const invokedBy = resolveInvokedBy(by, 'review', id);
  if (isDryRun(args)) {
    const updated = await c.requestUC.review({
      id,
      by,
      lense,
      verdict,
      comment,
      ...(invokedBy !== undefined ? { invokedBy } : {}),
      dryRun: true,
    });
    // Review doesn't transition state — omit would_transition, let
    // the preview payload carry the new review entry in `reviews`.
    emitDryRunPreview({ verb: 'review', id, by, after: updated, format: parseFormat(args) });
    return 0;
  }
  const updated = await c.requestUC.review({
    id,
    by,
    lense,
    verdict,
    comment,
    ...(invokedBy !== undefined ? { invokedBy } : {}),
  });
  // Self-review warning. The tool permits `--by` to equal the
  // request author (the YAML is just an append-only record and
  // doesn't know intent), but the Two-Persona Devil frame is
  // undermined when the critic is the author. We surface a stderr
  // marker rather than reject — history may need self-annotations
  // (e.g. "I want to flag this myself") and the caller's own
  // judgement wins. The warning exists so the choice is visible in
  // the session transcript and not silently laundered into YAML.
  if (updated.from.value === by) {
    process.stderr.write(
      `⚠ self-review: ${by} reviewed their own request ${id}. ` +
        `The Two-Persona Devil frame expects a different voice — ` +
        `consider asking another member to review instead.\n`,
    );
  }
  // Display the canonical verdict/lense (from the stored review)
  // rather than the raw input: the user may have typed an alias
  // (e.g. `--verdict concerned`, normalized to `concern` on save),
  // and the success message should reflect the value that actually
  // landed in YAML, not the input form.
  //
  // `reviews` is guaranteed non-empty here because `requestUC.review`
  // just appended one. Fall back to the raw input only if that
  // invariant ever breaks — the fallback won't be canonical but also
  // won't crash.
  const stored = updated.reviews[updated.reviews.length - 1];
  const displayLense = stored?.lense ?? lense;
  const displayVerdict = stored?.verdict ?? verdict;
  emitWriteResponse(
    parseFormat(args),
    updated,
    `✓ review recorded: ${id} [${displayLense}/${displayVerdict}]`,
    c.config,
  );
  return 0;
}
