import {
  ParsedArgs,
  requireOption,
  optionalOption,
} from '../../shared/parseArgs.js';
import { C, readStdin, readCommentViaEditor } from './internal.js';
import { emitWriteResponse, parseFormat } from './writeFormat.js';

export async function reqReview(c: C, args: ParsedArgs): Promise<number> {
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
  } else if (positional) {
    comment = positional;
  } else if (process.stdin.isTTY) {
    comment = await readCommentViaEditor({ id, by, lense, verdict });
  } else {
    comment = '';
  }
  if (!comment.trim()) {
    throw new Error(
      'review comment is required (use --comment <s>, --comment - for STDIN, ' +
        'a positional argument, or run interactively so $EDITOR opens)',
    );
  }

  const updated = await c.requestUC.review({ id, by, lense, verdict, comment });
  emitWriteResponse(
    parseFormat(args),
    updated,
    `✓ review recorded: ${id} [${lense}/${verdict}]`,
    c.config,
  );
  return 0;
}
