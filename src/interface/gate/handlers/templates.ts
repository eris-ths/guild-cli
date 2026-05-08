// `gate templates` — wave-brief template registry surface (#235).
//
// Two read subverbs:
//   - `gate templates list`         → name + intended_use catalogue
//   - `gate templates show <name>`  → full markdown body (text mode)
//                                    or {frontmatter, body} (json mode)
//
// The write side (consume a template via `gate request --template <n>`)
// lives in handlers/request.ts. This module is read-only.

import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { C } from './internal.js';

const TEMPLATES_LIST_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format']);
const TEMPLATES_SHOW_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format']);

export async function templatesCmd(c: C, args: ParsedArgs): Promise<number> {
  const sub = args.positional[0];
  if (sub === undefined) {
    process.stderr.write(
      'gate templates needs a subcommand:\n' +
        '  gate templates list                # available wave-brief templates\n' +
        '  gate templates show <name>         # render one template\n',
    );
    return 1;
  }
  if (sub === 'list') {
    return await templatesList(c, shiftPositional(args));
  }
  if (sub === 'show') {
    return await templatesShow(c, shiftPositional(args));
  }
  process.stderr.write(
    `unknown subcommand: gate templates ${sub}\n` +
      `  see 'gate templates' for the available subverbs.\n`,
  );
  return 1;
}

function shiftPositional(args: ParsedArgs): ParsedArgs {
  // Drop the first positional (the subverb itself) so downstream
  // handlers see `<name>` at positional[0]. Mirrors how `issuesCmd`
  // handles its own subverb dispatch via raw positional inspection;
  // we shift here because templatesShow uses `positional[0]`.
  return { ...args, positional: args.positional.slice(1) };
}

async function templatesList(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, TEMPLATES_LIST_KNOWN_FLAGS, 'templates list');
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    throw new Error(`--format must be 'json' or 'text', got: ${format}`);
  }
  const items = c.templateUC.list();
  const exists = c.templateUC.registryExists();
  const dir = c.templateUC.registryDir();
  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          templates: items.map((t) => ({
            name: t.name,
            version: t.version,
            intended_use: t.intendedUse,
            gate_required: t.gateRequired,
          })),
          _meta: { dir, exists },
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  }
  if (!exists) {
    // Empty / missing dir — print a single advisory line so an
    // operator on a fresh checkout (or the public guild-cli repo)
    // sees why the catalogue is empty rather than a blank stdout.
    process.stdout.write(
      `(empty: templates dir not found at ${dir})\n`,
    );
    return 0;
  }
  if (items.length === 0) {
    process.stdout.write(
      `(no templates found in ${dir})\n`,
    );
    return 0;
  }
  // Pad name column for readable alignment. Same shape as
  // computeReviewMarkerWidth — measure the catalogue once.
  const nameWidth = Math.max(...items.map((t) => t.name.length));
  for (const t of items) {
    const padded = t.name.padEnd(nameWidth);
    const lock = t.gateRequired ? '[gate-required]' : '[no-gate]';
    process.stdout.write(
      `${padded}  v${t.version}  ${lock}  ${t.intendedUse}\n`,
    );
  }
  return 0;
}

async function templatesShow(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, TEMPLATES_SHOW_KNOWN_FLAGS, 'templates show');
  const name = args.positional[0];
  if (!name) {
    throw new Error(
      'Usage: gate templates show <name> [--format json|text]',
    );
  }
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    throw new Error(`--format must be 'json' or 'text', got: ${format}`);
  }
  const t = c.templateUC.show(name);
  if (!t) {
    const available = c.templateUC.list().map((s) => s.name);
    const hint =
      available.length === 0
        ? `  (registry is empty at ${c.templateUC.registryDir()})`
        : `  available: ${available.join(', ')}`;
    process.stderr.write(`unknown template: ${name}\n${hint}\n`);
    return 1;
  }
  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          name: t.name,
          version: t.version,
          intended_use: t.intendedUse,
          gate_required: t.gateRequired,
          frontmatter: t.frontmatter,
          body: t.body,
          source: t.source,
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  }
  // Text mode: emit the raw markdown including frontmatter so the
  // output is a faithful copy of the source file. Operators piping
  // to a file get a working `.md` they can edit and re-import if
  // they ever want to fork a template.
  const fmKeys = Object.entries(t.frontmatter)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');
  process.stdout.write(`---\n${fmKeys}\n---\n${t.body}`);
  if (!t.body.endsWith('\n')) process.stdout.write('\n');
  return 0;
}
