import { buildContainer } from '../shared/container.js';
import { parseArgs, requireOption, optionalOption } from '../shared/parseArgs.js';
import { DomainError } from '../../domain/shared/DomainError.js';

const HELP = `guild — member management CLI

Usage:
  guild list                              List all members
  guild show <name>                       Show member YAML
  guild new --name <n> --category <c>     Create new member
  guild validate                          Validate all member YAMLs

Categories: core | professional | assignee | trial | special | host
`;

export async function main(argv: readonly string[]): Promise<number> {
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
        const members = await c.memberUC.list();
        for (const m of members) {
          const dn = m.displayName ? ` (${m.displayName})` : '';
          process.stdout.write(`${m.name.value.padEnd(16)} [${m.category}]${dn}\n`);
        }
        return 0;
      }
      case 'show': {
        const name = args.positional[0];
        if (!name) throw new Error('Usage: guild show <name>');
        const m = await c.memberUC.show(name);
        if (!m) {
          process.stderr.write(`not found: ${name}\n`);
          return 1;
        }
        process.stdout.write(JSON.stringify(m.toJSON(), null, 2) + '\n');
        return 0;
      }
      case 'new': {
        const name = requireOption(args, 'name', 'guild new --name <n> --category <c>');
        const category = requireOption(args, 'category', 'see --help');
        const displayName = optionalOption(args, 'display-name');
        const input: Parameters<typeof c.memberUC.create>[0] = { name, category };
        if (displayName !== undefined) input.displayName = displayName;
        const m = await c.memberUC.create(input);
        process.stdout.write(`✓ created member: ${m.name.value}\n`);
        return 0;
      }
      case 'validate': {
        const members = await c.memberUC.list();
        process.stdout.write(`✓ ${members.length} members valid\n`);
        return 0;
      }
      default:
        process.stderr.write(`unknown command: ${cmd}\n${HELP}`);
        return 1;
    }
  } catch (e) {
    const msg = e instanceof DomainError
      ? `DomainError: ${e.message}${e.field ? ` (${e.field})` : ''}`
      : e instanceof Error
        ? e.message
        : String(e);
    process.stderr.write(`error: ${msg}\n`);
    return 1;
  }
}
