import { ParsedArgs, optionalOption, requireOption } from '../../shared/parseArgs.js';
import { C } from './internal.js';
import { MemberName } from '../../../domain/member/MemberName.js';
import { parseMemberCategory } from '../../../domain/member/MemberCategory.js';

/**
 * gate register --name <n> [--category <c>] [--display-name <s>] [--dry-run] [--format json|text]
 *
 * Register a new member in the content_root. One-shot onboarding:
 * before this verb existed, an agent encountering gate for the
 * first time had to hand-author YAML under `members/<name>.yaml`,
 * figure out the schema from `members.example/`, and then still
 * risk a typo. Now: one command.
 *
 * Design intent — "initial registration must be frictionless":
 *   - `--category` defaults to `professional` (the right bucket
 *     for most agents). Explicit overrides are still accepted,
 *     including aliases (pro / prof / member → professional).
 *   - Name invariants (ASCII, lowercase, 1-32 chars, not reserved)
 *     are the same as everywhere — surfaced via MemberName.of's
 *     usual error, which lists the pattern.
 *   - Re-registering the same name is a no-op error ("already
 *     exists") — safer than silently overwriting a live member.
 *   - `--dry-run` prints the YAML that would be written without
 *     touching disk, so an agent can sanity-check the shape before
 *     committing to it.
 *   - JSON output mirrors the write-response shape other verbs
 *     use so orchestrators can parse it the same way.
 *
 * Host registration is NOT handled here. Hosts go in
 * `guild.config.yaml` under `host_names:` and are managed by
 * whoever runs the content_root. This verb is for members only;
 * passing `--category host` is rejected (see below) to keep
 * host assignment an intentional, human-edited decision.
 */
export async function reqRegister(c: C, args: ParsedArgs): Promise<number> {
  const name = requireOption(args, 'name', '--name required');
  const category = optionalOption(args, 'category') ?? 'professional';
  const displayName = optionalOption(args, 'display-name');
  const dryRun = args.options['dry-run'] === true || args.options['dry-run'] === '';
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    throw new Error(`--format must be 'json' or 'text', got: ${format}`);
  }

  // Host assignment is intentionally a guild.config.yaml concern,
  // not a CLI-drive-by. Block it here with an explicit message
  // so a user who typed `--category host` understands why.
  const categoryNormalized = category.trim().toLowerCase();
  if (categoryNormalized === 'host') {
    throw new Error(
      `--category host is not registerable via CLI.\n` +
        `  Hosts are declared in guild.config.yaml under \`host_names:\`.\n` +
        `  Edit that file directly and commit; there is no runtime registration.`,
    );
  }

  const parsedName = MemberName.of(name);

  // Host/member name collision check. `host_names` in
  // guild.config.yaml reserves those identifiers for the content-root
  // operator role; making a member with the same name would give the
  // identifier two meanings (host AND member) with no way for downstream
  // verbs to resolve which applies. Reject the same way `--category host`
  // is rejected — both guard the same invariant: hosts are config-only.
  if (c.config.hostNames.includes(parsedName.value)) {
    throw new Error(
      `"${parsedName.value}" is already declared as a host in guild.config.yaml.\n` +
        `  Hosts and members are different roles; a single name cannot be both.\n` +
        `  Either pick a different --name, or remove "${parsedName.value}" from ` +
        `host_names: in guild.config.yaml before registering as a member.`,
    );
  }

  // Pre-flight: does the name already resolve to a member?
  // If it does, this is almost always a typo, not an intentional
  // overwrite — fail loud rather than silently replace a record.
  const existing = await c.memberUC.show(parsedName.value);
  if (existing) {
    throw new Error(
      `Member "${parsedName.value}" already exists.\n` +
        `  Use \`gate whoami\` (with GUILD_ACTOR=${parsedName.value}) to see your current record,\n` +
        `  or edit members/${parsedName.value}.yaml directly if you need to change it.`,
    );
  }

  if (dryRun) {
    // Compose the YAML shape without hitting disk. Lets an agent
    // confirm what's about to land before committing. Run the
    // category through the real parser so aliases are surfaced as
    // their canonical form in the preview — otherwise `--category
    // pro` would preview as `category: "pro"` but save as
    // `professional`, a subtle surprise.
    const canonicalCategory = parseMemberCategory(category);
    const preview = {
      name: parsedName.value,
      category: canonicalCategory,
      active: true,
      // Key name mirrors the written YAML (`displayName`, camelCase)
      // to preserve "what-you-see-is-what-gets-saved" parity.
      ...(displayName ? { displayName } : {}),
    };
    if (format === 'json') {
      process.stdout.write(
        JSON.stringify({ ok: true, dry_run: true, preview }, null, 2) + '\n',
      );
    } else {
      process.stdout.write(
        `dry-run: would write members/${parsedName.value}.yaml:\n` +
          Object.entries(preview)
            .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
            .join('\n') +
          '\n',
      );
    }
    return 0;
  }

  const member = await c.memberUC.create({
    name: parsedName.value,
    category,
    ...(displayName ? { displayName } : {}),
  });

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          id: member.name.value,
          state: 'active',
          message: `registered: ${member.name.value} (${member.category})`,
          suggested_next: {
            verb: 'boot',
            args: {},
            reason:
              'Run `gate boot` with GUILD_ACTOR set to see your personal dashboard ' +
              '(status, tail, inbox) — you are now a recognized actor.',
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      `✓ registered: ${member.name.value} [${member.category}]\n` +
        `  next: export GUILD_ACTOR=${member.name.value} && gate boot\n`,
    );
  }
  return 0;
}
