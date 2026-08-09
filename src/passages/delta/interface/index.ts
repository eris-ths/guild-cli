// delta — passage entry point.
//
// delta is the fifth passage under guild (after gate / agora / devil /
// ctx), reserved for deposits: conclusions that are settled but have not
// reached any axis yet. See domain/Delta.ts for the boundary with agora
// (unfinished thinking) and ctx (a fact that has landed).
//
// Surface: add / list / deliver / show. There is deliberately no
// "route everything" verb — deciding where a deposit belongs is a
// judgment, and gate is where judgments are recorded. Automating it
// here would make that judgment silently and leave no author on it.
//
// AI-first per principle 11: the substrate is machine-parseable JSON /
// snake_case YAML / explicit-flag CLI; any human-facing rendering
// (marks for who deposited it, grouped views) is a projection built on
// top, not a substrate change.

import { parseArgs, HelpRequested } from '../../../interface/shared/parseArgs.js';
import { renderVerbHelp } from '../../../interface/shared/verbHelp.js';
import { emitErrorEnvelope } from '../../../interface/shared/errorEnvelope.js';
import { nearestCommand } from '../../../interface/shared/nearestCommand.js';
import { getPackageVersion, isVersionFlag } from '../../../interface/shared/version.js';
import { buildDeltaContainer } from './container.js';
import { addDelta } from './handlers/add.js';
import { listDelta } from './handlers/list.js';
import { deliverDelta } from './handlers/deliver.js';
import { showDelta } from './handlers/show.js';
import { withEntryLock } from '../../../infrastructure/lock/withEntryLock.js';
import { resolveGuildActor } from '../../../interface/shared/resolveGuildActor.js';
import { READ_VERBS, WRITE_VERBS, LOCK_EXEMPT_VERBS } from './verbs.js';

const HELP = `delta — deposit passage (alpha, 4 verbs)

A deposit is a conclusion that is settled but not yet filed anywhere.
Distinct from its neighbours by what is unfinished:
  agora  — the thinking is unfinished (suspended play)
  delta  — the thinking is finished, the filing is not
  ctx    — it has landed as a fact
  gate   — someone decided something, and why

Usage:
  delta add --text "<what is unfiled>"
                              [--source "<where it came from>"]
                              [--candidate "<a guess at where it goes>"]
                              [--by <m>] [--format json|text]
                              Deposit without deciding. Only --text is
                              required: every extra mandatory flag is
                              paid while you are mid-task, which is the
                              cost this passage exists to avoid. Lands
                              at <content_root>/delta/<id>.yaml.

  delta list                  [--state pending|delivered|all] [--by <m>]
                              [--to <dest>] [--format json|text]
                              Read deposits back, OLDEST first (the
                              opposite of \`ctx list\`): this list is read
                              to drain a backlog, so the item that has
                              waited longest must not scroll away.
                              Shows age in days per deposit.

  delta deliver <id>          --to <dest> [--note "<what was done>"]
                              [--by <m>] [--format json|text]
                              Record that a deposit reached somewhere.
                              <dest> is free-form (another passage, a
                              tracker, a document). Refused on a deposit
                              that was already delivered — re-routing is
                              a new deposit citing this one, not an edit.

  delta show <id>             [--format json|text]
  delta --help                This help.
  delta --version             Print version and exit.

Status: alpha. \`add\` / \`list\` / \`deliver\` / \`show\` ship together because
a deposit surface without a drain is a drawer.

Substrate: shares content_root and members/ with gate; delta-specific
data goes under <content_root>/delta/.

Lore upstream:
  lore/principles/12-substrate-pure-module-in-projection-ecosystem.md
  lore/principles/11-ai-first-human-as-projection.md
  lore/principles/04-records-outlive-writers.md
`;

// Mirror of the switch below for did-you-mean suggestions. A new verb
// forgotten here loses its typo hint, doesn't crash anything.
const DELTA_COMMANDS = ['add', 'list', 'deliver', 'show'] as const;

export async function main(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (isVersionFlag(argv)) {
    process.stdout.write(
      `delta (under guild-cli ${getPackageVersion()}) — alpha (add / list / deliver / show)\n`,
    );
    return 0;
  }

  const [cmd, ...rest] = argv;
  const args = parseArgs(rest);
  const { config, uc } = buildDeltaContainer();

  const dispatch = async (): Promise<number> => {
    switch (cmd) {
      case 'add':
        return await addDelta({ uc, config }, args);
      case 'list':
        return await listDelta({ uc, config }, args);
      case 'deliver':
        return await deliverDelta({ uc, config }, args);
      case 'show':
        return await showDelta({ uc, config }, args);
      default: {
        const hint = nearestCommand(cmd, DELTA_COMMANDS);
        const suggest = hint ? `\n  did you mean: delta ${hint}?` : '';
        process.stderr.write(
          `delta: unknown verb: ${cmd}${suggest}\n` +
            `  see 'delta --help' for the full verb catalog (add / list / deliver / show).\n`,
        );
        return 1;
      }
    }
  };

  try {
    // #200: <write-verb> --help must not block on the lock — see
    // gate/index.ts for rationale.
    if (args.options['help'] === true) {
      return await dispatch();
    }
    // #196: see gate/index.ts for rationale.
    const actor = resolveGuildActor() ?? '(unset)';
    return await withEntryLock(
      config,
      'delta',
      cmd ?? '',
      { READ_VERBS, WRITE_VERBS, LOCK_EXEMPT_VERBS },
      actor,
      dispatch,
    );
  } catch (e) {
    if (e instanceof HelpRequested) {
      renderVerbHelp('delta', e);
      return 0;
    }
    const fmt = args.options['format'];
    emitErrorEnvelope(
      e,
      typeof fmt === 'string' ? fmt : undefined,
      config.contentRoot,
    );
    return 1;
  }
}
