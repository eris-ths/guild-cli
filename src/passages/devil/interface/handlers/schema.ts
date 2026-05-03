import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';

const SCHEMA_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format', 'verb']);

/**
 * devil schema — the agent dispatch contract for the devil-review
 * passage.
 *
 * Per principle 10 (`lore/principles/10-schema-as-contract.md`),
 * every agent-dispatchable passage publishes a schema naming its
 * verbs, their flags, and their output shape. v0 carries only the
 * schema verb itself; subsequent commits add open / entry / ingest /
 * dismiss / resolve / suspend / resume / conclude / list / show as
 * they land — issue #126 PR sequence.
 *
 * Output: draft-07 JSON-Schema-subset catalogue, hand-curated. Same
 * shape as gate's and agora's schema verbs so agents using all three
 * passages don't learn three formats.
 */

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: string[];
  description?: string;
  items?: JsonSchema;
};

interface VerbSchema {
  readonly name: string;
  readonly summary: string;
  readonly category: 'read' | 'write' | 'admin' | 'meta';
  readonly input: JsonSchema;
  readonly output: JsonSchema;
}

const str: JsonSchema = { type: 'string' };
const strOpt = (description: string): JsonSchema => ({
  type: 'string',
  description,
});
const formatField: JsonSchema = {
  type: 'string',
  enum: ['json', 'text'],
  description:
    'output format (default: text for create-style verbs, json for schema)',
};

const writeEnvelopeBase = (extra: Record<string, JsonSchema>): JsonSchema => ({
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    where_written: str,
    config_file: { type: 'string', description: 'absolute path or null' },
    suggested_next: {
      type: 'object',
      description:
        'Advisory hint — never directive. Never carries args.by, by design (issue #122 alternation-neutral policy).',
    },
    ...extra,
  },
  required: ['ok', 'where_written', 'suggested_next'],
});

// v0 grows by one verb per commit; the schema is honest about what's
// actually invokable. Each verb commit adds an entry here so the
// agent contract reflects the implementation.
const VERBS: readonly VerbSchema[] = [
  {
    name: 'open',
    category: 'write',
    summary:
      'open a review session against a target (PR / file / function / commit). ' +
      'Lands at <content_root>/devil/reviews/<rev-id>.yaml with state="open". ' +
      'Allocates a fresh rev-YYYY-MM-DD-NNN id per the runtime clock.',
    input: {
      type: 'object',
      properties: {
        // positional <target-ref>
        target_ref: {
          type: 'string',
          description:
            'positional; the target reference (PR URL, file path, function symbol, or commit sha)',
        },
        type: {
          type: 'string',
          enum: ['pr', 'file', 'function', 'commit'],
        },
        by: strOpt('actor (defaults to GUILD_ACTOR)'),
        format: formatField,
      },
      required: ['target_ref', 'type'],
    },
    output: writeEnvelopeBase({
      review_id: str,
      target: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['pr', 'file', 'function', 'commit'] },
          ref: str,
        },
        required: ['type', 'ref'],
      },
      state: { type: 'string', enum: ['open'] },
    }),
  },
  {
    name: 'schema',
    category: 'meta',
    summary:
      'this introspection payload — the devil-review passage agent dispatch contract',
    input: {
      type: 'object',
      properties: {
        verb: str,
        format: formatField,
      },
    },
    output: {
      type: 'object',
      description:
        'Catalogue of every implemented verb with input/output shapes. Grows commit-by-commit per issue #126 PR sequence.',
    },
  },
];

export async function schemaCmd(args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, SCHEMA_KNOWN_FLAGS, 'schema');
  const verbFilter = optionalOption(args, 'verb');
  const format = optionalOption(args, 'format') ?? 'json';
  if (format !== 'json' && format !== 'text') {
    process.stderr.write(`error: --format must be 'json' or 'text', got: ${format}\n`);
    return 1;
  }
  const verbs = verbFilter ? VERBS.filter((v) => v.name === verbFilter) : VERBS;
  if (verbFilter && verbs.length === 0) {
    process.stderr.write(`error: no devil verb named "${verbFilter}"\n`);
    return 1;
  }

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          $schema: 'http://json-schema.org/draft-07/schema#',
          passage: 'devil-review',
          version: '0.0.1-snapshot',
          verbs,
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  }

  // text rendering — terse, agent-readable
  process.stdout.write(`devil-review — ${verbs.length} verb(s):\n\n`);
  for (const v of verbs) {
    process.stdout.write(`${v.name}  [${v.category}]\n`);
    process.stdout.write(`  ${v.summary}\n\n`);
  }
  return 0;
}

export const DEVIL_VERBS = VERBS;
