import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { DomainError } from '../../../../domain/shared/DomainError.js';

const SCHEMA_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format', 'verb']);

/**
 * agora schema — the agent dispatch contract for this passage.
 *
 * Per principle 10 (`lore/principles/10-schema-as-contract.md`),
 * any agent-dispatchable passage publishes a schema that names
 * every verb's flags + output shape. This is the second passage's
 * implementation; gate has its own `gate schema` with the same
 * shape. Both passages live under guild and are dispatched by the
 * same MCP wirings.
 *
 * Output: draft-07 JSON-Schema-subset catalogue. Hand-maintained
 * (the verb set is small and stable enough that hand-curation
 * outweighs the cost of an LLM hallucinating a field name).
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
  description: 'output format (default: text for create-style, both options on read)',
};
const playIdField: JsonSchema = {
  type: 'string',
  description: 'positional; play id (YYYY-MM-DD-NNN)',
};

// Shared sub-schemas. Same convention as gate's schema.ts —
// shared shapes get named so cross-verb consumers don't drift.
const suspensionEntrySchema: JsonSchema = {
  type: 'object',
  description:
    'One suspension event. cliff = what just happened (the unfinished thread); ' +
    'invitation = what the next opener should do. Both are required by the substrate ' +
    'so a re-entering instance can act on the invitation without reading the move history.',
  properties: {
    at: str,
    by: str,
    cliff: str,
    invitation: str,
  },
  required: ['at', 'by', 'cliff', 'invitation'],
};

const resumeEntrySchema: JsonSchema = {
  type: 'object',
  description:
    'One resume event. Pairs with suspensions[index] by position; the resume ' +
    'closes the corresponding suspension. note is optional prose.',
  properties: {
    at: str,
    by: str,
    note: { type: 'string', description: 'optional resume prose' },
  },
  required: ['at', 'by'],
};

const playMoveSchema: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: '3-digit sequence within the play (001/002/...)' },
    at: str,
    by: str,
    text: str,
  },
  required: ['id', 'at', 'by', 'text'],
};

const gameOutputSchema: JsonSchema = {
  type: 'object',
  description: 'Game definition record.',
  properties: {
    slug: str,
    kind: { type: 'string', enum: ['quest', 'sandbox'] },
    title: str,
    created_at: str,
    created_by: str,
    description: { type: 'string', description: 'optional prose' },
  },
  required: ['slug', 'kind', 'title', 'created_at', 'created_by'],
};

const playOutputSchema: JsonSchema = {
  type: 'object',
  description: 'Play session record.',
  properties: {
    id: str,
    game: str,
    state: { type: 'string', enum: ['playing', 'suspended', 'concluded'] },
    started_at: str,
    started_by: str,
    moves: { type: 'array', items: playMoveSchema },
    suspensions: { type: 'array', items: suspensionEntrySchema },
    resumes: { type: 'array', items: resumeEntrySchema },
    concluded_at: { type: 'string', description: 'set when state=concluded' },
    concluded_by: { type: 'string', description: 'set when state=concluded' },
    concluded_note: { type: 'string', description: 'optional closure prose' },
  },
  required: ['id', 'game', 'state', 'started_at', 'started_by', 'moves'],
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
        'Advisory hint — never directive. May be null on terminal verbs (e.g., conclude).',
    },
    ...extra,
  },
  required: ['ok', 'where_written', 'suggested_next'],
});

const VERBS: readonly VerbSchema[] = [
  {
    name: 'new',
    category: 'write',
    summary: 'create a Game definition under <content_root>/agora/games/<slug>.yaml',
    input: {
      type: 'object',
      properties: {
        slug: str,
        kind: { type: 'string', enum: ['quest', 'sandbox'] },
        title: str,
        description: strOpt('optional prose describing the game'),
        by: strOpt('actor (defaults to GUILD_ACTOR)'),
        format: formatField,
      },
      required: ['slug', 'kind', 'title'],
    },
    output: writeEnvelopeBase({
      slug: str,
      kind: { type: 'string', enum: ['quest', 'sandbox'] },
    }),
  },
  {
    name: 'play',
    category: 'write',
    summary: 'start a play session against an existing Game',
    input: {
      type: 'object',
      properties: {
        slug: str,
        by: strOpt('actor (defaults to GUILD_ACTOR)'),
        format: formatField,
      },
      required: ['slug'],
    },
    output: writeEnvelopeBase({
      play_id: str,
      game: str,
      state: { type: 'string', enum: ['playing'] },
    }),
  },
  {
    name: 'move',
    category: 'write',
    summary: 'append a move to a playing session (optimistic CAS)',
    input: {
      type: 'object',
      properties: {
        by: strOpt('actor (defaults to GUILD_ACTOR)'),
        text: str,
        format: formatField,
        game: strOpt(
          'game slug (required when <play-id> matches plays in multiple games — e.g. ' +
            'two games each have a YYYY-MM-DD-001)',
        ),
      },
      required: ['text'],
    },
    output: writeEnvelopeBase({
      play_id: str,
      move_id: str,
      state: { type: 'string', enum: ['playing'] },
    }),
  },
  {
    name: 'suspend',
    category: 'write',
    summary:
      'pause a playing session with cliff (what just happened) and invitation ' +
      '(what the next opener should do). The substrate-side Zeigarnik effect lives here.',
    input: {
      type: 'object',
      properties: {
        cliff: str,
        invitation: str,
        by: strOpt('actor (defaults to GUILD_ACTOR)'),
        format: formatField,
        game: strOpt('game slug (required for cross-game id collisions; see move)'),
      },
      required: ['cliff', 'invitation'],
    },
    output: writeEnvelopeBase({
      play_id: str,
      state: { type: 'string', enum: ['suspended'] },
      suspension_index: { type: 'string', description: 'index of the new entry in suspensions[]' },
    }),
  },
  {
    name: 'resume',
    category: 'write',
    summary:
      'pick up a suspended session. Surfaces the closing cliff/invitation in the response so ' +
      'the resuming instance reads the paused-on context without a separate query.',
    input: {
      type: 'object',
      properties: {
        note: strOpt('optional resume prose'),
        by: strOpt('actor (defaults to GUILD_ACTOR)'),
        format: formatField,
        game: strOpt('game slug (required for cross-game id collisions; see move)'),
      },
    },
    output: writeEnvelopeBase({
      play_id: str,
      state: { type: 'string', enum: ['playing'] },
      resumed_suspension: {
        type: 'object',
        description: 'the suspension entry that was just closed (cliff + invitation prose)',
        properties: { at: str, by: str, cliff: str, invitation: str },
      },
    }),
  },
  {
    name: 'conclude',
    category: 'write',
    summary:
      'terminal state transition (playing or suspended → concluded). suggested_next is null.',
    input: {
      type: 'object',
      properties: {
        note: strOpt('optional closure prose'),
        by: strOpt('actor (defaults to GUILD_ACTOR)'),
        format: formatField,
        game: strOpt('game slug (required for cross-game id collisions; see move)'),
      },
    },
    output: writeEnvelopeBase({
      play_id: str,
      state: { type: 'string', enum: ['concluded'] },
      from_state: { type: 'string', enum: ['playing', 'suspended'] },
      concluded_at: str,
      concluded_by: str,
      concluded_note: { type: 'string', description: 'present iff --note was provided' },
    }),
  },
  {
    name: 'list',
    category: 'read',
    summary: 'enumerate games and plays (filterable by --game and --state)',
    input: {
      type: 'object',
      properties: {
        game: strOpt('narrow plays to one game (drops games list from output)'),
        state: {
          type: 'string',
          enum: ['playing', 'suspended', 'concluded', 'all'],
          description:
            'narrow plays to one state, or `all` for every state (no filter)',
        },
        format: formatField,
      },
    },
    output: {
      type: 'object',
      properties: {
        games: { type: 'array', items: gameOutputSchema },
        plays: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: str,
              game: str,
              state: { type: 'string', enum: ['playing', 'suspended', 'concluded'] },
              started_at: str,
              started_by: str,
              move_count: { type: 'string', description: 'integer; YAML-numeric on text rendering' },
              suspension_count: str,
              resume_count: str,
            },
          },
        },
      },
    },
  },
  {
    name: 'show',
    category: 'read',
    summary:
      'detail view of one game or one play. Argument auto-disambiguates: play-id pattern → ' +
      'play, otherwise → game slug.',
    input: {
      type: 'object',
      properties: {
        // positional <slug-or-play-id>
        target: {
          type: 'string',
          description: 'positional; game slug OR play id (YYYY-MM-DD-NNN)',
        },
        game: strOpt('disambiguate cross-game play-id collisions'),
        format: formatField,
      },
      required: ['target'],
    },
    // Output shape varies — game vs play. Both shapes documented
    // here; consumers branch on the field set.
    output: {
      type: 'object',
      description: 'Game definition (when target is a slug) OR Play record (when target is a play id).',
    },
  },
  {
    name: 'last',
    category: 'read',
    summary:
      "the actor's most recent play — answers 'which play am I in?' without copying a play id from `agora list`. " +
      'Defaults to open (playing|suspended); --include-concluded broadens to any state.',
    input: {
      type: 'object',
      properties: {
        by: strOpt('actor (defaults to GUILD_ACTOR)'),
        state: {
          type: 'string',
          enum: ['playing', 'suspended', 'concluded'],
          description: 'narrow to a single state (omit for the default open-only behaviour)',
        },
        'include-concluded': {
          type: 'boolean',
          description: 'include concluded plays in the search (default false)',
        },
        format: formatField,
      },
    },
    output: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        play: {
          description: 'most recent matching play, or null if none',
          type: 'object',
          properties: {
            id: str,
            game: str,
            state: { type: 'string', enum: ['playing', 'suspended', 'concluded'] },
            started_at: str,
            started_by: str,
            move_count: str,
            suspension_count: str,
            resume_count: str,
            closing_cliff: strOpt('present when state=suspended'),
            closing_invitation: strOpt('present when state=suspended'),
          },
        },
      },
      required: ['ok', 'play'],
    },
  },
  {
    name: 'cliff',
    category: 'read',
    summary:
      'peek the closing cliff/invitation of a play without transitioning state. ' +
      "Answers 'what was I about to do?' without committing to resume.",
    input: {
      type: 'object',
      properties: {
        play_id: { type: 'string', description: 'positional; play id (YYYY-MM-DD-NNN)' },
        game: strOpt('disambiguate cross-game play-id collisions'),
        format: formatField,
      },
      required: ['play_id'],
    },
    output: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        play_id: str,
        game: str,
        state: { type: 'string', enum: ['playing', 'suspended', 'concluded'] },
        cliff: strOpt('null if play was never suspended'),
        invitation: strOpt('null if play was never suspended'),
        suspended_at: strOpt('present when there is a last suspension'),
        suspended_by: strOpt('present when there is a last suspension'),
        active: { type: 'boolean', description: 'true when this cliff awaits a resume; false when historical' },
        resumed_at: strOpt('present when active=false'),
        resumed_by: strOpt('present when active=false'),
        note: strOpt('helpful note when no cliff exists'),
      },
      required: ['ok', 'play_id', 'game', 'state'],
    },
  },
  {
    name: 'schema',
    category: 'meta',
    summary: 'this introspection payload — the agent dispatch contract',
    input: { type: 'object', properties: { verb: str, format: formatField } },
    output: { type: 'object' },
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
    // Throw rather than write+return so the entry-point envelope
    // (#194 / #205) emits a structured payload with field='verb' for
    // JSON consumers. The synthetic CLI-shape error has no caught
    // origin, so a fresh DomainError is the cleanest carrier.
    throw new DomainError(`no agora verb named "${verbFilter}"`, 'verb');
  }

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          $schema: 'http://json-schema.org/draft-07/schema#',
          passage: 'agora',
          version: '0.1.0-snapshot',
          verbs,
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  }

  // text rendering — terse, agent-readable summary
  process.stdout.write(`agora — ${verbs.length} verb(s):\n\n`);
  for (const v of verbs) {
    process.stdout.write(`${v.name}  [${v.category}]\n`);
    process.stdout.write(`  ${v.summary}\n\n`);
  }
  return 0;
}

export const AGORA_VERBS = VERBS;
