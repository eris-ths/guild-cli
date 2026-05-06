// devil-review — passage entry point.
//
// The third passage under guild (after gate and agora). devil-review
// is the security-backstop substrate: a multi-persona, lense-enforced,
// time-extended review surface that composes with single-pass tools
// (Anthropic /ultrareview, Claude Security, supply-chain-guard)
// rather than replacing them. Design lives in issue #126.
//
// v1 surface (PR #127) lands all 11 verbs from the design issue:
// schema / open / entry / list / show / dismiss / resolve / suspend
// / resume / conclude / ingest. The schema verb's VERBS array
// reflects every implemented verb, keeping the agent contract honest.
//
// AI-first per principle 11: the substrate is machine-parseable
// JSON / snake_case YAML / explicit-flag CLI. Any future
// human-facing UI is a projection, not a substrate change.

import { parseArgs, HelpRequested } from '../../../interface/shared/parseArgs.js';
import { renderVerbHelp } from '../../../interface/shared/verbHelp.js';
import { emitErrorEnvelope } from '../../../interface/shared/errorEnvelope.js';
import { nearestCommand } from '../../../interface/shared/nearestCommand.js';
import { getPackageVersion, isVersionFlag } from '../../../interface/shared/version.js';
import { LenseNotFound } from '../domain/Lense.js';
import { PersonaNotFound } from '../domain/Persona.js';
import { buildDevilContainer } from './container.js';
import { schemaCmd } from './handlers/schema.js';
import { openReview } from './handlers/open.js';
import { entryOnReview } from './handlers/entry.js';
import { listReviews } from './handlers/list.js';
import { showReview } from './handlers/show.js';
import { concludeReview } from './handlers/conclude.js';
import { dismissEntry } from './handlers/dismiss.js';
import { resolveEntry } from './handlers/resolve.js';
import { suspendReview } from './handlers/suspend.js';
import { resumeReview } from './handlers/resume.js';
import { ingestSource } from './handlers/ingest.js';
import { withEntryLock } from '../../../infrastructure/lock/withEntryLock.js';
import { resolveGuildActor } from '../../../interface/shared/resolveGuildActor.js';
import { READ_VERBS, WRITE_VERBS, LOCK_EXEMPT_VERBS } from './verbs.js';

const HELP = `devil-review — security-backstop review passage (alpha, 11 verbs)

Usage:
  devil open <target-ref> --type <pr|file|function|commit>
                          [--by <m>] [--format json|text]
                              Open a review session against a target.
                              Lands at <content_root>/devil/reviews/<rev-id>.yaml.
                              Initial state: open. Allocates a fresh
                              rev-YYYY-MM-DD-NNN id per the runtime clock.

  devil entry <rev-id> --persona <p> --lense <l> --kind <k>
                       --text "<prose>"
                       [--severity <c|h|m|l|info>]
                       [--severity-rationale "<prose>"]
                       [--addresses <entry-id>]
                       [--by <m>] [--format json|text]
                              Append a hand-rolled entry. kind is one of:
                              finding (severity + severity-rationale required),
                              assumption, resistance, skip, synthesis.
                              kind=gate is reserved for 'devil ingest'.
                              persona must be hand-rolled (red-team /
                              author-defender / mirror); ingest-only
                              personas are rejected here.

  devil list [--state open|concluded|all] [--target-type pr|file|function|commit]
             [--format json|text]
                              Enumerate review sessions. Read-only,
                              one-line-per-review summary; --state and
                              --target-type narrow the result. --state
                              all is sugar for "every state, no filter".

  devil show <rev-id> [--format json|text]
                              Detail view of one review (full entries +
                              suspensions + resumes + conclusion). JSON
                              form is review.toJSON() — same shape as
                              the YAML on disk.

  devil dismiss <rev-id> <entry-id> --reason <r>
                                    [--note "<prose>"]
                                    [--by <m>] [--format json|text]
                              Mark a finding-entry dismissed with a structured
                              reason (one of: not-applicable | accepted-risk |
                              false-positive | out-of-scope |
                              mitigated-elsewhere). Only kind=finding entries
                              with status=open are dismissable; the substrate
                              keeps the dismissal trail honest by refusing
                              re-dismiss and refusing to dismiss after conclude.

  devil resolve <rev-id> <entry-id> [--commit <sha>]
                                    [--by <m>] [--format json|text]
                              Mark a finding-entry resolved, optionally citing
                              the commit that landed the fix (resolved_by_commit
                              becomes part of the substrate). Same status-gate
                              shape as dismiss: only kind=finding + status=open
                              transition; refuses re-resolve and post-conclude.

  devil suspend <rev-id> --cliff "<what just happened>"
                         --invitation "<what the next opener should attempt>"
                         [--by <m>] [--format json|text]
                              Record a cliff/invitation pause on a thread of
                              the review. Softer than agora's suspend — does
                              NOT block other entries; it just records re-entry
                              context for whoever picks up that thread later.
                              Both --cliff and --invitation are required (an
                              empty suspension defeats the design pivot).

  devil resume <rev-id> [--note "<resume prose>"]
                        [--by <m>] [--format json|text]
                              Pick up the most recent un-paired suspension on
                              this review. Surfaces the closing cliff/invitation
                              in the success output so the resuming actor reads
                              the paused-on context without a separate 'show'.
                              Refuses if no thread is currently paused.

  devil ingest <rev-id> --from <ultrareview|claude-security|scg> <input-path>
                        [--by <m>] [--format json|text]
                              Append entries from an automated source's output.
                              ultrareview / claude-security produce one
                              kind=finding per bug; scg produces one kind=gate
                              entry on the supply-chain lense with the 8 stages
                              embedded. Each ingest logs to re_run_history so
                              re-scans accumulate. Strict input shapes per
                              source (see handlers/ingest.ts docstring).

  devil conclude <rev-id> --synthesis "<prose>"
                          [--unresolved <e-001,e-002,...>]
                          [--by <m>] [--format json|text]
                              Terminal state transition (open → concluded).
                              Verdict-less by design — synthesis prose is
                              required; unresolved is the explicit list of
                              entry ids deliberately left open. Lense-coverage
                              gate: every lense in the catalog needs at least
                              one entry (skip with reason counts) before this
                              accepts the close. After conclude no further
                              entries / suspensions / resumes / re-runs are
                              accepted.

  devil schema [--verb <name>] [--format json|text]
                              Agent dispatch contract for this passage
                              (principle 10). draft-07 JSON Schema subset.
                              Lists every implemented verb.

  devil --help                 This help.
  devil --version              Print version and exit.

Passage status: alpha (v1 complete). All 11 verbs from issue #126 are invokable.
Substrate: shares content_root and members/ with gate and agora. Reviews
land at <content_root>/devil/reviews/<rev-id>.yaml.

Lore upstream:
  lore/principles/11-ai-first-human-as-projection.md  (substrate is AI-natural)
  lore/principles/10-schema-as-contract.md            (schema is the contract)
  lore/principles/04-records-outlive-writers.md       (records persist)

Design issue: https://github.com/eris-ths/guild-cli/issues/126
Sister project: https://github.com/eris-ths/supply-chain-guard
`;

// Mirror of the switch below for did-you-mean suggestions. A verb
// forgotten here loses its typo hint, doesn't crash anything.
const DEVIL_COMMANDS = [
  'open', 'entry', 'list', 'show', 'dismiss', 'resolve',
  'suspend', 'resume', 'ingest', 'conclude', 'schema',
] as const;


export async function main(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (isVersionFlag(argv)) {
    process.stdout.write(
      `devil-review (under guild-cli ${getPackageVersion()}) — alpha (v1 complete, #126)\n`,
    );
    return 0;
  }

  const [cmd, ...rest] = argv;
  const args = parseArgs(rest);
  const { config, reviews, lenses, personas } = buildDevilContainer();

  const dispatch = async (): Promise<number> => {
    switch (cmd) {
      case 'schema':
        return await schemaCmd(args);
      case 'open':
        return await openReview({ reviews, config }, args);
      case 'entry':
        return await entryOnReview({ reviews, lenses, personas, config }, args);
      case 'list':
        return await listReviews({ reviews, config }, args);
      case 'show':
        return await showReview({ reviews, config }, args);
      case 'dismiss':
        return await dismissEntry({ reviews, config }, args);
      case 'resolve':
        return await resolveEntry({ reviews, config }, args);
      case 'suspend':
        return await suspendReview({ reviews, config }, args);
      case 'resume':
        return await resumeReview({ reviews, config }, args);
      case 'ingest':
        return await ingestSource({ reviews, lenses, personas, config }, args);
      case 'conclude':
        return await concludeReview({ reviews, lenses, config }, args);
      default: {
        const hint = nearestCommand(cmd, DEVIL_COMMANDS);
        const suggest = hint ? `\n  did you mean: devil ${hint}?` : '';
        process.stderr.write(
          `devil: unknown verb: ${cmd}${suggest}\n` +
            `  v1 surface (#126): open / entry / list / show / dismiss / resolve / ` +
            `suspend / resume / ingest / conclude / schema.\n`,
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
      'devil',
      cmd ?? '',
      { READ_VERBS, WRITE_VERBS, LOCK_EXEMPT_VERBS },
      actor,
      dispatch,
    );
  } catch (e) {
    if (e instanceof HelpRequested) {
      renderVerbHelp('devil', e);
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
    // For catalog-miss failures, render the catalog + did-you-mean
    // hint so the caller doesn't have to round-trip through `devil
    // schema` to recover. 12 lenses + 6 personas are too many to
    // hold in agent working memory; surfacing them at the failure
    // site is the same affordance gate's `nearestCommand` already
    // provides for unknown verbs (CLAUDE.md: "Skills that *open*
    // something → agora; that *protect* something → devil"). The
    // hint is on stderr so JSON parsers reading stdout aren't
    // affected. Empty `available` (malformed config) renders no
    // hint — same shape as gate's nearestCommand-returns-null.
    if (e instanceof LenseNotFound || e instanceof PersonaNotFound) {
      const kind = e instanceof LenseNotFound ? 'lense' : 'persona';
      const tried = e.message.split(': ').pop() ?? '';
      if (e.available.length > 0) {
        const hint = nearestCommand(tried, e.available);
        if (hint) {
          process.stderr.write(`  did you mean: --${kind} ${hint}?\n`);
        }
        process.stderr.write(
          `  available ${kind}s: ${e.available.join(', ')}\n`,
        );
      }
    }
    return 1;
  }
}
