// agora — passage entry point.
//
// agora is the second passage under guild (after gate). Where gate
// is the request-lifecycle / review / dialogue surface, agora is
// the play / narrative / cast surface — Quest and Sandbox style
// games designed for AI-first interaction with suspend/resume as
// a first-class primitive (per design issue #117).
//
// v1 alpha: full surface implemented (new / play / move / suspend /
// resume / conclude / list / show / schema). The pull-driven
// extraction strategy chosen at design time has converged; later
// changes will be enhancements (cross-passage anchoring, ingest
// shapes), not core verb additions.
//
// AI-first per principle 11: the substrate is machine-parseable
// JSON / snake_case YAML / explicit-flag CLI; any future human-
// facing UI is a projection, not a substrate change.

import { parseArgs, HelpRequested } from '../../../interface/shared/parseArgs.js';
import { renderVerbHelp } from '../../../interface/shared/verbHelp.js';
import { emitErrorEnvelope } from '../../../interface/shared/errorEnvelope.js';
import { nearestCommand } from '../../../interface/shared/nearestCommand.js';
import { getPackageVersion, isVersionFlag } from '../../../interface/shared/version.js';
import { buildAgoraContainer } from './container.js';
import { newGame } from './handlers/new.js';
import { startPlay } from './handlers/play.js';
import { moveOnPlay } from './handlers/move.js';
import { suspendPlay } from './handlers/suspend.js';
import { resumePlay } from './handlers/resume.js';
import { concludePlay } from './handlers/conclude.js';
import { listAgora } from './handlers/list.js';
import { showAgora } from './handlers/show.js';
import { lastPlay, LAST_BOOLEAN_FLAGS } from './handlers/last.js';
import { cliffOf } from './handlers/cliff.js';
import { schemaCmd } from './handlers/schema.js';
import { withEntryLock } from '../../../infrastructure/lock/withEntryLock.js';
import { resolveGuildActor } from '../../../interface/shared/resolveGuildActor.js';
import { READ_VERBS, WRITE_VERBS, LOCK_EXEMPT_VERBS } from './verbs.js';

const HELP = `agora — play / narrative passage (alpha, 11 verbs)

Usage:
  agora new --slug <s> --kind <quest|sandbox> --title "<t>" [--by <m>]
                                                [--description "<d>"] [--format json|text]
                              Create a new Game definition under
                              <content_root>/agora/games/<slug>.yaml.

  agora play --slug <game-slug> [--by <m>] [--format json|text]
                              Start a play session against an existing Game.
                              Lands at <content_root>/agora/plays/<slug>/<play-id>.yaml.
                              Initial state: playing.

  agora move <play-id> [--by <m>] --text "<text>" [--format json|text]
                              Append a move to a playing session. Optimistic
                              CAS on moves.length protects re-entering
                              instances from silent overwrite. State-machine
                              boundary: only "playing" plays accept moves.

  agora suspend <play-id> --cliff "<...>" --invitation "<...>"
                          [--by <m>] [--format json|text]
                              Pause a playing session with a cliff (what
                              just happened) and an invitation (what the
                              next opener should do). State: playing →
                              suspended. The substrate-side Zeigarnik:
                              future instances re-enter and act on the
                              recorded invitation.

  agora resume <play-id> [--note "<...>"] [--by <m>] [--format json|text]
                              Pick up a suspended session. State:
                              suspended → playing. Surfaces the closing
                              cliff/invitation in the success output so
                              the resuming actor reads what was paused on.

  agora conclude <play-id> [--note "<final note>"] [--by <m>] [--format json|text]
                              Terminal state transition. Allowed from
                              "playing" or "suspended" — a suspended
                              play that drifts away is a valid outcome.
                              concluded plays accept no further verbs.

  agora schema [--verb <name>] [--format json|text]
                              Agent dispatch contract for this passage
                              (principle 10). draft-07 JSON Schema subset.

  agora list [--game <slug>] [--state playing|suspended|concluded|all] [--format json|text]
                              Enumerate games and plays. Filters: --game
                              narrows plays to one game (drops games list);
                              --state narrows plays to a single state, or
                              'all' for every state, no filter.

  agora show <slug-or-play-id> [--game <slug>] [--format json|text]
                              Detail view of one game or one play. Argument
                              auto-disambiguates: play ids match
                              YYYY-MM-DD-NNN, anything else is a game slug.
                              --game disambiguates cross-game id collisions
                              for plays.

  agora last [--by <m>] [--state playing|suspended|concluded]
             [--include-concluded] [--format json|text]
                              "Which play am I in?" — return the actor's
                              most recent play. Defaults to open
                              (playing|suspended); concluded excluded
                              unless --include-concluded or --state given.

  agora cliff <play-id> [--game <slug>] [--format json|text]
                              Peek the closing cliff/invitation without
                              transitioning state. "What was I about to
                              do here?" without committing to resume.
                              Surfaces whether the cliff is active
                              (next resume closes it) or historical
                              (already resumed since).

  agora --help                 This help.
  agora --version              Print version and exit.

Passage status: alpha. Core v1 surface (new / play / move / suspend /
resume / conclude / list / show / schema) per design issue #117. Sugar
verbs (last / cliff) layer on top — pure read affordances.
Substrate: shares content_root and members/ with gate; agora-specific data
goes under <content_root>/agora/.

Lore upstream:
  lore/principles/11-ai-first-human-as-projection.md  (the substrate is AI-natural)
  lore/principles/10-schema-as-contract.md            (gate schema-style contract pending)
  lore/principles/04-records-outlive-writers.md       (records persist across sessions)
`;

// Mirror of the switch below for did-you-mean suggestions. Same
// "obvious-when-broken" rule as gate's KNOWN_COMMANDS: a verb
// forgotten here loses its typo hint, doesn't crash anything.
const AGORA_COMMANDS = [
  'new', 'play', 'move', 'suspend', 'resume', 'conclude',
  'list', 'show', 'last', 'cliff', 'schema',
] as const;

export async function main(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (isVersionFlag(argv)) {
    // Single-binary version reuse — agora ships under guild-cli's
    // package.json, so the version number is shared. The status
    // phrase ("alpha, 9 verbs") is per-passage and rides alongside
    // so a reader sees both lineage and surface maturity in one line.
    process.stdout.write(
      `agora (under guild-cli ${getPackageVersion()}) — alpha, 11 verbs\n`,
    );
    return 0;
  }

  const [cmd, ...rest] = argv;
  // Per-verb boolean-flag registry (issue #158): each entry maps a
  // verb name to the set of its boolean flags, so parseArgs treats
  // them as boolean instead of speculatively consuming the next
  // token. Verbs without boolean flags don't need an entry.
  const VERB_BOOLEAN_FLAGS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
    ['last', LAST_BOOLEAN_FLAGS],
  ]);
  const verbBooleans = cmd ? VERB_BOOLEAN_FLAGS.get(cmd) : undefined;
  const args = parseArgs(rest, verbBooleans ? { booleanFlags: verbBooleans } : {});
  const { config, games, plays } = buildAgoraContainer();

  const dispatch = async (): Promise<number> => {
    switch (cmd) {
      case 'new':
        return await newGame({ repo: games, config }, args);
      case 'play':
        return await startPlay({ games, plays, config }, args);
      case 'move':
        return await moveOnPlay({ plays, config }, args);
      case 'suspend':
        return await suspendPlay({ plays, config }, args);
      case 'resume':
        return await resumePlay({ plays, config }, args);
      case 'conclude':
        return await concludePlay({ plays, config }, args);
      case 'list':
        return await listAgora({ games, plays, config }, args);
      case 'show':
        return await showAgora({ games, plays, config }, args);
      case 'last':
        return await lastPlay({ plays, config }, args);
      case 'cliff':
        return await cliffOf({ plays, config }, args);
      case 'schema':
        return await schemaCmd(args);
      default: {
        const hint = nearestCommand(cmd, AGORA_COMMANDS);
        const suggest = hint ? `\n  did you mean: agora ${hint}?` : '';
        process.stderr.write(
          `agora: unknown verb: ${cmd}${suggest}\n` +
            `  see 'agora --help' for the full verb catalog.\n`,
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
      'agora',
      cmd ?? '',
      { READ_VERBS, WRITE_VERBS, LOCK_EXEMPT_VERBS },
      actor,
      dispatch,
    );
  } catch (e) {
    if (e instanceof HelpRequested) {
      renderVerbHelp('agora', e);
      return 0;
    }
    // Mirror gate's catch shape via the shared envelope helper
    // (issue #194): `error:` prefix carries the failure signal in
    // text mode; `--format json` adds the structured envelope on a
    // preceding stderr line so AI tool layers can branch on `code`
    // (e.g. `lock_busy`) without regex-matching the prose.
    const fmt = args.options['format'];
    emitErrorEnvelope(
      e,
      typeof fmt === 'string' ? fmt : undefined,
      config.contentRoot,
    );
    return 1;
  }
}
