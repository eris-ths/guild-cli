// ctx — passage entry point.
//
// ctx is the fourth passage under guild (after gate / agora / devil),
// reserved for accumulated facts: observations the substrate has
// witnessed across sessions. Verdict-less, attribution-required,
// append-only. See lore/principles/12 for the boundary with adjacent
// modules.
//
// Phase 1 ships only `ctx record`. The remaining six verbs (fork /
// supersede / show / list / chain / status) land iteratively in
// phase 2 as use surfaces what shape they need.
//
// AI-first per principle 11: the substrate is machine-parseable JSON /
// snake_case YAML / explicit-flag CLI; any future human-facing UI is
// a projection, not a substrate change.

import { parseArgs, HelpRequested } from '../../../interface/shared/parseArgs.js';
import { renderVerbHelp } from '../../../interface/shared/verbHelp.js';
import { sanitizeError } from '../../../interface/shared/sanitizeError.js';
import { nearestCommand } from '../../../interface/shared/nearestCommand.js';
import { getPackageVersion, isVersionFlag } from '../../../interface/shared/version.js';
import { DomainError } from '../../../domain/shared/DomainError.js';
import { buildCtxContainer } from './container.js';
import { recordCtx } from './handlers/record.js';
import { withEntryLock } from '../../../infrastructure/lock/withEntryLock.js';
import { resolveGuildActor } from '../../../interface/shared/resolveGuildActor.js';
import { READ_VERBS, WRITE_VERBS, LOCK_EXEMPT_VERBS } from './verbs.js';

const HELP = `ctx — fact accumulation passage (phase 1: record only)

Usage:
  ctx record --fact "<prose>" [--tag tech:foo,status:bar]
                              [--by <m>] [--format json|text]
                              Append a fact to the substrate. Lands at
                              <content_root>/ctx/<id>.yaml. Id is
                              auto-allocated as ctx-YYYY-MM-DD-NNN.

  ctx --help                   This help.
  ctx --version                Print version and exit.

Phase 1 status: minimum surface — only \`record\` is implemented.
Phase 2 (separate session): fork / supersede / show / list / chain / status.

Substrate: shares content_root and members/ with gate; ctx-specific
data goes under <content_root>/ctx/.

Lore upstream:
  lore/principles/12-substrate-pure-module-in-projection-ecosystem.md
  lore/principles/11-ai-first-human-as-projection.md
  lore/principles/04-records-outlive-writers.md
`;

// Mirror of the switch below for did-you-mean suggestions. Phase 1
// has only `record`; phase 2 will add fork / supersede / show /
// list / chain / status. A new verb forgotten here loses its typo
// hint, doesn't crash anything.
const CTX_COMMANDS = ['record'] as const;

export async function main(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (isVersionFlag(argv)) {
    process.stdout.write(
      `ctx (under guild-cli ${getPackageVersion()}) — alpha phase 1 (record only)\n`,
    );
    return 0;
  }

  const [cmd, ...rest] = argv;
  const args = parseArgs(rest);
  const { config, uc } = buildCtxContainer();

  const dispatch = async (): Promise<number> => {
    switch (cmd) {
      case 'record':
        return await recordCtx({ uc, config }, args);
      default: {
        // Phase 2 will add fork / supersede / show / list / chain /
        // status; the catalog grows as those land. For now, `record`
        // is the only valid verb — typos like `recor` should still
        // get suggested rather than dumping the full HELP.
        const hint = nearestCommand(cmd, CTX_COMMANDS);
        const suggest = hint ? `\n  did you mean: ctx ${hint}?` : '';
        process.stderr.write(
          `ctx: unknown verb: ${cmd}${suggest}\n` +
            `  see 'ctx --help' for the full verb catalog (phase 1: record only).\n`,
        );
        return 1;
      }
    }
  };

  try {
    // #196: see gate/index.ts for rationale.
    const actor = resolveGuildActor() ?? '(unset)';
    return await withEntryLock(
      config,
      'ctx',
      cmd ?? '',
      { READ_VERBS, WRITE_VERBS, LOCK_EXEMPT_VERBS },
      actor,
      dispatch,
    );
  } catch (e) {
    if (e instanceof HelpRequested) {
      renderVerbHelp('ctx', e);
      return 0;
    }
    // Mirror gate's catch shape: `error:` prefix carries the failure
    // signal; the `DomainError:` prefix and `(field)` trailing tag
    // were debug noise, not touch-feel signal (P3 dogfood C/A
    // cleanup).
    const rawMsg = e instanceof Error ? e.message : String(e);
    // Strip absolute contentRoot prefix (issue #153).
    const msg = sanitizeError(rawMsg, config.contentRoot);
    process.stderr.write(`error: ${msg}\n`);
    return 1;
  }
}
