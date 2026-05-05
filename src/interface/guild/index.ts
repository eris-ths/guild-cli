import { buildContainer } from '../shared/container.js';
import {
  parseArgs,
  requireOption,
  optionalOption,
  rejectUnknownFlags,
  HelpRequested,
} from '../shared/parseArgs.js';
import { renderVerbHelp } from '../shared/verbHelp.js';
import { notFoundMessage } from '../shared/notFoundHint.js';
import { DomainError } from '../../domain/shared/DomainError.js';
import { getPackageVersion, isVersionFlag } from '../shared/version.js';

const HELP = `guild — member management CLI

Usage:
  guild list                              List all members
  guild show <name>                       Show member YAML
  guild new --name <n> --category <c>     Create new member
  guild validate                          Validate all member YAMLs
  guild --version                         Print version and exit

Categories: core | professional | assignee | trial | special | host
`;

export async function main(argv: readonly string[]): Promise<number> {
  if (isVersionFlag(argv)) {
    process.stdout.write(`guild-cli ${getPackageVersion()}\n`);
    return 0;
  }
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  const args = parseArgs(rest);
  const c = buildContainer();
  try {
    switch (cmd) {
      case 'list': {
        rejectUnknownFlags(args, new Set(), 'list');
        const members = await c.memberUC.list();
        const memberNames = new Set(members.map((m) => m.name.value));
        for (const m of members) {
          const dn = m.displayName ? ` (${m.displayName})` : '';
          process.stdout.write(`${m.name.value.padEnd(16)} [${m.category}]${dn}\n`);
        }
        // Hosts are non-member actors declared in guild.config.yaml.
        // They may appear in --by / --from / --executor / --auto-review
        // but have no members/*.yaml and cannot receive messages.
        // Listing them here makes the full actor set visible without
        // requiring the reader to open the config file.
        for (const h of c.config.hostNames) {
          if (memberNames.has(h)) continue; // don't double-print on collision
          process.stdout.write(`${h.padEnd(16)} [host]  (non-member; no inbox)\n`);
        }
        return 0;
      }
      case 'show': {
        rejectUnknownFlags(args, new Set(), 'show');
        const name = args.positional[0];
        if (!name) throw new Error('Usage: guild show <name>');
        const m = await c.memberUC.show(name);
        if (!m) {
          process.stderr.write(notFoundMessage('member', name));
          return 1;
        }
        process.stdout.write(JSON.stringify(m.toJSON(), null, 2) + '\n');
        return 0;
      }
      case 'new': {
        rejectUnknownFlags(
          args,
          new Set(['name', 'category', 'display-name']),
          'new',
        );
        const name = requireOption(args, 'name', '<n>');
        const category = requireOption(
          args,
          'category',
          '<core|professional|assignee|trial|special|host>',
        );
        const displayName = optionalOption(args, 'display-name');
        const input: Parameters<typeof c.memberUC.create>[0] = { name, category };
        if (displayName !== undefined) input.displayName = displayName;
        const m = await c.memberUC.create(input);
        process.stdout.write(`✓ created member: ${m.name.value}\n`);
        return 0;
      }
      case 'validate': {
        rejectUnknownFlags(args, new Set(), 'validate');
        const members = await c.memberUC.list();
        const hostCount = c.config.hostNames.length;
        const hostSuffix =
          hostCount === 0 ? '' : `, ${hostCount} host(s) configured`;
        process.stdout.write(
          `✓ ${members.length} members valid${hostSuffix}\n`,
        );
        return 0;
      }
      default:
        process.stderr.write(`unknown command: ${cmd}\n${HELP}`);
        return 1;
    }
  } catch (e) {
    if (e instanceof HelpRequested) {
      renderVerbHelp('guild', e);
      return 0;
    }
    // Mirror gate's catch shape: `error:` prefix carries the failure
    // signal; the `DomainError:` prefix and `(field)` trailing tag
    // were debug noise, not touch-feel signal (P3 dogfood C/A
    // cleanup).
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`error: ${msg}\n`);
    return 1;
  }
}
