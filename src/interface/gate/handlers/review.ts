import {
  ParsedArgs,
  requireOption,
  optionalOption,
} from '../../shared/parseArgs.js';
import { C, readStdin } from './internal.js';

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
  //   1. --comment <s>  (option value)
  //   2. --comment -    (read STDIN until EOF — for piped/heredoc input)
  //   3. <positional>   (legacy: everything after <id>)
  const commentOpt = optionalOption(args, 'comment');
  let comment: string;
  if (commentOpt === '-') {
    comment = await readStdin();
  } else if (commentOpt !== undefined) {
    comment = commentOpt;
  } else {
    comment = args.positional.slice(1).join(' ');
  }
  if (!comment.trim()) {
    throw new Error(
      'review comment is required (use --comment <s>, --comment - for STDIN, ' +
        'or a positional argument)',
    );
  }

  await c.requestUC.review({ id, by, lense, verdict, comment });
  process.stdout.write(`✓ review recorded: ${id} [${lense}/${verdict}]\n`);
  return 0;
}
