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
  normalizeActor,
} from './internal.js';
import { emitWriteResponse } from './writeFormat.js';
import { parseFormat } from '../../shared/parseFormat.js';
import { renderVoice } from '../../shared/voiceRender.js';
import {
  fireBeforeHook,
  fireAfterHook,
  emitHookVeto,
} from '../../../application/plugin/HookBus.js';

// Friction bundle (#228 sub-task 1): `--note` is the canonical comment
// flag across every write verb (approve / deny / execute / complete /
// fail / fast-track). `gate review` historically took `--comment` only,
// breaking muscle memory for agents that just learned `--note` from the
// six other write verbs. Resolution: accept both, prefer `--note`,
// keep `--comment` as a deprecated alias for back-compat. The rejected-
// flag set names both so help still lists them and an explicit typo
// (`--coment`) still errors.
const REVIEW_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'lense',
  'verdict',
  'note',
  'comment',
  'dry-run',
  'format',
]);

export async function reqReview(c: C, args: ParsedArgs): Promise<number> {
  // Verb-specific help extras (#228 sub-task 2): surface the resolved
  // `lenses:` set from guild.config.yaml so a fresh agent reading
  // `gate review --help` sees the accepted enum without first having
  // to fail with a bogus value. The error path already lists the same
  // info; this brings the discoverability up one level.
  // #134 H2: when gate.strict_lenses is on, the allowed-lense set
  // mirrors the devil ComposedLenseCatalog (bundled + content_root
  // extensions). Otherwise the configured `lenses:` list governs.
  // Help shows whichever source is actually load-bearing for this run
  // so the reviewer doesn't have to discover the difference from a
  // failing call.
  const lenseList = c.config.lenses.length > 0
    ? c.config.lenses.join(', ')
    : 'devil, layer, cognitive, user';
  const helpExtras: readonly string[] = c.config.gate.strictLenses
    ? [
        `accepted lenses (gate.strict_lenses=true → unified devil catalog, ` +
          `bundled + <content_root>/devil/lenses/*.yaml extensions). ` +
          `See \`devil schema --format json\` for the full list with provenance.`,
        `note: --comment is a deprecated alias of --note (kept for back-compat)`,
      ]
    : [
        `accepted lenses (resolved from guild.config.yaml): ${lenseList}`,
        `note: --comment is a deprecated alias of --note (kept for back-compat)`,
      ];
  rejectUnknownFlags(args, REVIEW_KNOWN_FLAGS, 'review', helpExtras);
  const id = args.positional[0];
  if (!id) {
    throw new Error(
      'Usage: gate review <id> --by <m> --lense <l> --verdict <v> ' +
        '[--note <s> | --note - | <comment>] ' +
        '(--comment is a deprecated alias of --note)',
    );
  }
  // Canonicalize before downstream compares (`updated.from.value === by`
  // is the self-review trigger and was vulnerable to the same case-fold
  // / trim bypass that #233's self_approve gate had).
  const by = normalizeActor(
    requireOption(args, 'by', '<m>', 'GUILD_ACTOR'),
  );
  const lense = requireOption(args, 'lense', '<l>');
  const verdict = requireOption(args, 'verdict', '<ok|concern|reject>');

  // Comment resolution order:
  //   1. --note <s>       option value (canonical, parity with the other
  //                       write verbs — approve/deny/execute/complete/fail)
  //   2. --note -         STDIN until EOF (for piped/heredoc input)
  //   3. --comment <s>    DEPRECATED alias of --note (#228 — kept so old
  //                       scripts and muscle-memory keep working)
  //   4. --comment -      DEPRECATED alias for STDIN
  //   5. <positional>     legacy: everything after <id>
  //   6. $EDITOR fallback when stdin is a TTY and none of the above
  //                       were given — matches `git commit` convention,
  //                       sidesteps the Windows git-bash pipe issues
  //                       that made (2) unreliable for some users.
  // Mutual-exclusion: --note and --comment together is rejected with a
  // flag-shaped error rather than a silent precedence rule. Same posture
  // as --executor / --executors in `gate request`.
  const noteOpt = optionalOption(args, 'note');
  const commentOpt = optionalOption(args, 'comment');
  const format = parseFormat(args);
  if (noteOpt !== undefined && commentOpt !== undefined) {
    throw new Error(
      'review: --note and --comment are mutually exclusive (got both). ' +
        '--comment is a deprecated alias of --note; pass only one.',
    );
  }
  // Surface a one-line deprecation hint when the legacy alias is used,
  // so the migration path is visible in session transcripts. Text mode
  // only — JSON consumers don't need the prose hint clogging their
  // context window; the flag still works either way.
  if (commentOpt !== undefined && format !== 'json') {
    process.stderr.write(
      'notice: --comment is a deprecated alias of --note; please migrate ' +
        '(both will continue to work for now).\n',
    );
  }
  // Treat the canonical and deprecated flags identically downstream.
  const effectiveOpt = noteOpt !== undefined ? noteOpt : commentOpt;
  const positional = args.positional.slice(1).join(' ');
  let comment: string;
  if (effectiveOpt === '-') {
    comment = await readStdin();
  } else if (effectiveOpt !== undefined) {
    comment = effectiveOpt;
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
    // The dashed-value hint applies to whichever of --note/--comment
    // the user actually typed; pick the tripped one so the example
    // matches their input shape and doesn't suggest a flag they didn't
    // use.
    const tripped =
      args.options['note'] === true
        ? 'note'
        : args.options['comment'] === true
          ? 'comment'
          : null;
    const hint =
      tripped !== null
        ? `\n  (Your --${tripped} value began with "--" and was not consumed. ` +
          `Use --${tripped}=<value> or put "-- <value>" after the other flags.)`
        : '';
    throw new Error(
      'review comment is required (use --note <s>, --note - for STDIN, ' +
        'a positional argument, or run interactively so $EDITOR opens; ' +
        '--comment is a deprecated alias of --note)' +
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
    emitDryRunPreview({ verb: 'review', id, by, after: updated, format });
    return 0;
  }
  // Lifecycle hook fire point (#36 Phase 1 step 5). `before:review`
  // sees the pre-review request snapshot; a veto blocks the append.
  // Useful for policy hooks like "this lense is reserved to hosts".
  const priorReview = await c.requestUC.show(id);
  if (priorReview !== null) {
    const veto = await fireBeforeHook(c.hookSubscriptions, 'review', priorReview, by);
    if (veto) return emitHookVeto('review', id, veto);
  }
  const updated = await c.requestUC.review({
    id,
    by,
    lense,
    verdict,
    comment,
    ...(invokedBy !== undefined ? { invokedBy } : {}),
  });
  // Pass the appended review on `ctx.extra.review` so `after:review`
  // hooks can read verdict/lense/comment without re-deriving from the
  // request (the documented contract in docs/plugin-schema.md). The
  // appended review is the terminal entry — `requestUC.review` just
  // pushed it, so `reviews` is guaranteed non-empty here.
  const appendedReview = updated.reviews[updated.reviews.length - 1];
  await fireAfterHook(c.hookSubscriptions, 'review', updated, by, {
    review: appendedReview,
  });
  // Self-review warning. The tool permits `--by` to equal the
  // request author (the YAML is just an append-only record and
  // doesn't know intent), but the Two-Persona Devil frame is
  // undermined when the critic is the author. We surface a stderr
  // marker rather than reject — history may need self-annotations
  // (e.g. "I want to flag this myself") and the caller's own
  // judgement wins. Text mode only — JSON consumers can detect the
  // self-edge structurally from the `by` and `from` fields in the
  // envelope without 3 lines of prose.
  if (updated.from.value === by && format !== 'json') {
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
    format,
    updated,
    `✓ review recorded: ${id} [${displayLense}/${displayVerdict}]`,
    c.config,
    [],
    { voice: renderVoice(c.voicePlugins, 'review', updated, c.config) },
  );
  return 0;
}
