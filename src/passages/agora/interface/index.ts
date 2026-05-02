// agora — passage entry point.
//
// agora is the second passage under guild (after gate). Where gate
// is the request-lifecycle / review / dialogue surface, agora is
// the play / narrative / cast surface — Quest and Sandbox style
// games designed for AI-first interaction with suspend/resume as
// a first-class primitive (per design issue #117).
//
// This is the v0 skeleton. Only `agora new` is implemented; `play`,
// `move`, `suspend`, `resume`, `list`, `show` will land iteratively
// as the prototype surfaces what shape they need (per the pull-
// driven extraction strategy chosen at design time).
//
// AI-first per principle 11: the substrate is machine-parseable
// JSON / snake_case YAML / explicit-flag CLI; any future human-
// facing UI is a projection, not a substrate change.

import { GuildConfig } from '../../../infrastructure/config/GuildConfig.js';
import { parseArgs } from '../../../interface/shared/parseArgs.js';
import { DomainError } from '../../../domain/shared/DomainError.js';
import { YamlGameRepository } from '../infrastructure/YamlGameRepository.js';
import { newGame } from './handlers/new.js';

const HELP = `agora — game / play passage (v0 skeleton)

Usage:
  agora new --slug <s> --kind <quest|sandbox> --title "<t>" [--by <m>]
                                                [--description "<d>"] [--format json|text]
                              Create a new Game definition under
                              <content_root>/agora/games/<slug>.yaml.

  agora --help                 This help.
  agora --version              Print version and exit.

Passage status: v0 skeleton. Verbs landing iteratively per design issue #117.
Substrate: shares content_root and members/ with gate; agora-specific data
goes under <content_root>/agora/.

Lore upstream:
  lore/principles/11-ai-first-human-as-projection.md  (the substrate is AI-natural)
  lore/principles/10-schema-as-contract.md            (gate schema-style contract pending)
  lore/principles/04-records-outlive-writers.md       (records persist across sessions)
`;

export async function main(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (argv[0] === '--version') {
    // Single-binary version reuse — agora ships under guild-cli's
    // package.json. No separate version surface for v0.
    process.stdout.write('agora (under guild-cli) — snapshot/agora\n');
    return 0;
  }

  const [cmd, ...rest] = argv;
  const args = parseArgs(rest);
  const config = GuildConfig.load();
  const repo = new YamlGameRepository(config);
  const deps = { repo, config };

  try {
    switch (cmd) {
      case 'new':
        return await newGame(deps, args);
      default:
        process.stderr.write(`agora: unknown verb: ${cmd}\n${HELP}`);
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
