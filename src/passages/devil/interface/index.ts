// devil-review — passage entry point.
//
// The third passage under guild (after gate and agora). devil-review
// is the security-backstop substrate: a multi-persona, lense-enforced,
// time-extended review surface that composes with single-pass tools
// (Anthropic /ultrareview, Claude Security, supply-chain-guard)
// rather than replacing them. Design lives in issue #126.
//
// This is the v0 scaffold. Only `devil schema` and `devil --help`
// are wired. open / entry / ingest / dismiss / resolve / suspend /
// resume / conclude / list / show land in subsequent commits, agora
// pattern. The schema verb's VERBS array grows as each verb lands,
// keeping the agent contract honest about what's actually invokable.
//
// AI-first per principle 11: the substrate is machine-parseable
// JSON / snake_case YAML / explicit-flag CLI. Any future
// human-facing UI is a projection, not a substrate change.

import { GuildConfig } from '../../../infrastructure/config/GuildConfig.js';
import { parseArgs } from '../../../interface/shared/parseArgs.js';
import { DomainError } from '../../../domain/shared/DomainError.js';
import { YamlDevilReviewRepository } from '../infrastructure/YamlDevilReviewRepository.js';
import { BundledLenseCatalog } from '../infrastructure/BundledLenseCatalog.js';
import { BundledPersonaCatalog } from '../infrastructure/BundledPersonaCatalog.js';
import { schemaCmd } from './handlers/schema.js';
import { openReview } from './handlers/open.js';
import { entryOnReview } from './handlers/entry.js';

const HELP = `devil-review — security-backstop review passage (v0 scaffold)

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

  devil schema [--verb <name>] [--format json|text]
                              Agent dispatch contract for this passage
                              (principle 10). draft-07 JSON Schema subset.
                              Lists every implemented verb; grows as
                              subsequent commits add verbs per #126.

  devil --help                 This help.
  devil --version              Print version and exit.

Verbs landing in subsequent commits per issue #126:
  ingest <rev-id>              Append entries from /ultrareview, Claude
                              Security, or supply-chain-guard output.
  dismiss <entry-id>           Mark a finding dismissed with a reason
                              (the substrate keeps the dismissal trail).
  resolve <entry-id>           Mark a finding resolved (optional commit ref).
  suspend / resume <rev-id>    Cliff/invitation-style pause and pick-up.
                              Softer than agora — does not block other entries.
  conclude <rev-id>            Synthesis-prose close (verdict-less). Terminal.
  list                         Enumerate reviews in the content_root.
  show <rev-id>                Detail view of one review.

Passage status: v0 scaffold. 'open', 'entry', and 'schema' are invokable in this commit.
Substrate: shares content_root and members/ with gate and agora. Reviews
land at <content_root>/devil/reviews/<rev-id>.yaml.

Lore upstream:
  lore/principles/11-ai-first-human-as-projection.md  (substrate is AI-natural)
  lore/principles/10-schema-as-contract.md            (schema is the contract)
  lore/principles/04-records-outlive-writers.md       (records persist)

Design issue: https://github.com/eris-ths/guild-cli/issues/126
Sister project: https://github.com/eris-ths/supply-chain-guard
`;

export async function main(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (argv[0] === '--version') {
    process.stdout.write('devil-review (under guild-cli) — snapshot/devil-review\n');
    return 0;
  }

  const [cmd, ...rest] = argv;
  const args = parseArgs(rest);
  const config = GuildConfig.load();
  const reviews = new YamlDevilReviewRepository(config);
  const lenses = new BundledLenseCatalog();
  const personas = new BundledPersonaCatalog();

  try {
    switch (cmd) {
      case 'schema':
        return await schemaCmd(args);
      case 'open':
        return await openReview({ reviews, config }, args);
      case 'entry':
        return await entryOnReview({ reviews, lenses, personas, config }, args);
      default:
        process.stderr.write(
          `devil: unknown verb: ${cmd}\n` +
            `(v0 scaffold — \`open\`, \`entry\`, and \`schema\` are invokable; other verbs land in subsequent commits per #126)\n`,
        );
        return 1;
    }
  } catch (e) {
    const msg =
      e instanceof DomainError
        ? `DomainError: ${e.message}${e.field ? ` (${e.field})` : ''}`
        : e instanceof Error
          ? e.message
          : String(e);
    process.stderr.write(`error: ${msg}\n`);
    return 1;
  }
}
