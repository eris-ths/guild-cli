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
import { emitErrorEnvelope } from '../../../interface/shared/errorEnvelope.js';
import { nearestCommand } from '../../../interface/shared/nearestCommand.js';
import { getPackageVersion, isVersionFlag } from '../../../interface/shared/version.js';
import { buildCtxContainer } from './container.js';
import { recordCtx } from './handlers/record.js';
import { exportCtx, EXPORT_BOOLEAN_FLAGS } from './handlers/exportOkf.js';
import { importCtx, IMPORT_BOOLEAN_FLAGS } from './handlers/importOkf.js';
import { listCtx } from './handlers/list.js';
import { showCtx } from './handlers/show.js';
import { withEntryLock } from '../../../infrastructure/lock/withEntryLock.js';
import { resolveGuildActor } from '../../../interface/shared/resolveGuildActor.js';
import { READ_VERBS, WRITE_VERBS, LOCK_EXEMPT_VERBS } from './verbs.js';

const HELP = `ctx — fact accumulation passage (phase 1: record / list / show + OKF interop)

Usage:
  ctx record --fact "<prose>" [--tag tech:foo,status:bar]
                              [--by <m>] [--format json|text]
                              Append a fact to the substrate. Lands at
                              <content_root>/ctx/<id>.yaml. Id is
                              auto-allocated as ctx-YYYY-MM-DD-NNN.

  ctx list                    [--tag prefix:value] [--by <m>] [--format json|text]
                              Read facts back, newest first. --tag filters
                              by an exact tag, --by by author.

  ctx show <id>               [--format json|text]
                              Show one fact in full.

  ctx export <dir>            [--as okf] [--force] [--format json|text]
                              Project every fact into an Open Knowledge
                              Format bundle under <dir> (one <id>.md per
                              fact + index.md / log.md views). Refuses a
                              non-empty <dir> unless --force.

  ctx import <dir>            [--as okf] [--by <m>] [--format json|text]
                              [--allow-duplicates]
                              Record an OKF bundle's concepts as facts.
                              Guild-authored bundles round-trip (ids
                              preserved, idempotent); foreign bundles
                              import tolerantly (a type-less doc is tagged
                              okf:none so it's auditable). Prose dedup
                              is on by default — it matches on trimmed,
                              whitespace-collapsed prose, so case and
                              punctuation are significant. --allow-duplicates
                              opts out.

  ctx --help                   This help.
  ctx --version                Print version and exit.

Phase 1 status: \`record\` / \`list\` / \`show\` plus the OKF interop
pair (\`export\` / \`import\`). OKF is an interchange *projection*
(principle 11), not a storage change — the substrate stays YAML.
Phase 2 (separate session): fork / supersede / chain / status.

Substrate: shares content_root and members/ with gate; ctx-specific
data goes under <content_root>/ctx/.

Lore upstream:
  lore/principles/12-substrate-pure-module-in-projection-ecosystem.md
  lore/principles/11-ai-first-human-as-projection.md
  lore/principles/04-records-outlive-writers.md
`;

// Mirror of the switch below for did-you-mean suggestions. Phase 1
// ships record / export / import; a new verb forgotten here loses its
// typo hint, doesn't crash anything.
const CTX_COMMANDS = ['record', 'export', 'import', 'list', 'show'] as const;

// The phase-2 lifecycle verbs named in HELP / AGENT.md / docs as
// "arriving in phase 2". A user who read the docs and types one of these
// deserves a roadmap-aware message ("planned, not yet implemented")
// rather than the same "unknown verb" a typo gets. Keep in sync with the
// HELP phase-2 line above (list / show shipped — they left this set).
const CTX_PHASE2_VERBS: ReadonlySet<string> = new Set([
  'fork',
  'supersede',
  'chain',
  'status',
]);

export async function main(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (isVersionFlag(argv)) {
    process.stdout.write(
      `ctx (under guild-cli ${getPackageVersion()}) — alpha phase 1 (record / list / show + OKF export/import)\n`,
    );
    return 0;
  }

  const [cmd, ...rest] = argv;
  // Per-verb boolean flags (issue #158): registered next to the verb
  // that owns them so the parser doesn't consume a following positional
  // (e.g. `ctx import --allow-duplicates <dir>`) as the flag's value.
  const VERB_BOOLEAN_FLAGS: Record<string, ReadonlySet<string>> = {
    export: EXPORT_BOOLEAN_FLAGS,
    import: IMPORT_BOOLEAN_FLAGS,
  };
  const verbBooleans = VERB_BOOLEAN_FLAGS[cmd ?? ''];
  const args = verbBooleans
    ? parseArgs(rest, { booleanFlags: verbBooleans })
    : parseArgs(rest);
  const { config, uc } = buildCtxContainer();

  const dispatch = async (): Promise<number> => {
    switch (cmd) {
      case 'record':
        return await recordCtx({ uc, config }, args);
      case 'list':
        return await listCtx({ uc, config }, args);
      case 'show':
        return await showCtx({ uc, config }, args);
      case 'export':
        return await exportCtx({ uc, config }, args);
      case 'import':
        return await importCtx({ uc, config }, args);
      default: {
        // A documented phase-2 verb that isn't implemented yet gets a
        // roadmap-aware message, so a reader of the docs isn't told the
        // same "unknown verb" a typo gets (dogfood finding).
        if (cmd !== undefined && CTX_PHASE2_VERBS.has(cmd)) {
          process.stderr.write(
            `ctx: '${cmd}' is a planned phase-2 verb, not yet implemented.\n` +
              `  phase 1 surface: record / export / import. See 'ctx --help'.\n`,
          );
          return 1;
        }
        // Phase 2 will add fork / supersede / chain / status; the catalog
        // grows as those land. Valid verbs today are record / list / show
        // / export / import — typos like `recor` should still get
        // suggested rather than dumping the full HELP.
        const hint = nearestCommand(cmd, CTX_COMMANDS);
        const suggest = hint ? `\n  did you mean: ctx ${hint}?` : '';
        process.stderr.write(
          `ctx: unknown verb: ${cmd}${suggest}\n` +
            `  see 'ctx --help' for the full verb catalog (record / list / show / export / import).\n`,
        );
        return 1;
      }
    }
  };

  try {
    // #200: <write-verb> --help must not block on the lock — see
    // gate/index.ts for rationale. dispatch walks to the verb handler's
    // rejectUnknownFlags which throws HelpRequested before any side
    // effect, so we route help around the lock entirely.
    if (args.options['help'] === true) {
      return await dispatch();
    }
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
    // Mirror gate's catch shape via the shared envelope helper
    // (issue #194): `error:` prefix carries the failure signal in
    // text mode; `--format json` adds the structured envelope on a
    // preceding stderr line so AI tool layers can branch on `code`.
    const fmt = args.options['format'];
    emitErrorEnvelope(
      e,
      typeof fmt === 'string' ? fmt : undefined,
      config.contentRoot,
    );
    return 1;
  }
}
