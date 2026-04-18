import { ParsedArgs, optionalOption } from '../../shared/parseArgs.js';
import { C } from './internal.js';

/**
 * gate schema [--verb <name>] [--format json|text]
 *
 * Agent-first introspection. Returns a JSON Schema catalogue of every
 * verb, its required / optional arguments, and its output shape.
 * The primary consumer is an LLM wiring gate into an MCP tool layer:
 * instead of parsing `gate --help` and guessing field semantics, the
 * agent ingests this payload and generates correct tool calls.
 *
 * Design notes:
 *  - Hand-maintained rather than generated. The verbs list is small
 *    (~25), stable across minor versions, and the cost of duplicating
 *    the shape here is lower than the cost of an LLM hallucinating
 *    an arg name. The 0.x minor-version gate is also the release
 *    checkpoint where this file must be updated — CI can enforce
 *    that with a smoke test (see tests/interface/schema.test.ts).
 *  - JSON Schema draft-07 subset: `type`, `properties`, `required`,
 *    `enum`. No `$ref`, no `allOf`. Keeps the output readable and
 *    consumable by any schema-aware LLM.
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
const strOpt = (description?: string): JsonSchema =>
  description ? { type: 'string', description } : { type: 'string' };
const idStr: JsonSchema = {
  type: 'string',
  description: 'request id (YYYY-MM-DD-NNNN) or issue id (i-YYYY-MM-DD-NNNN)',
};
const formatField: JsonSchema = {
  type: 'string',
  enum: ['json', 'text'],
  description: 'output format (agent-first default: json for read; text for write)',
};

const suggestedNextSchema: JsonSchema = {
  type: 'object',
  properties: {
    verb: str,
    args: {
      type: 'object',
      description: 'pre-filled argument hints — agent may override',
    },
    reason: str,
  },
};

const writeResponseSchema: JsonSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    id: str,
    state: str,
    message: str,
    suggested_next: {
      type: 'object',
      description:
        'Optional hint for the next verb a caller *might* invoke. ' +
        'Derived deterministically from the post-mutation state — no LLM call. ' +
        'Safe to ignore if you have other plans; this field is a convenience for ' +
        'orchestrators, not a directive. null when the lifecycle has no obvious next step.',
      ...suggestedNextSchema,
    },
  },
  required: ['ok', 'id', 'state', 'message', 'suggested_next'],
};

const VERBS: readonly VerbSchema[] = [
  {
    name: 'boot',
    category: 'read',
    summary: 'single-command session orientation (identity + status + tail + unread inbox)',
    input: {
      type: 'object',
      properties: {
        format: formatField,
        tail: { type: 'string', description: 'utterances to include in tail (default 10)' },
        utterances: { type: 'string', description: 'your-recent utterance count (default 5)' },
      },
    },
    output: {
      type: 'object',
      properties: {
        actor: str,
        role: { type: 'string', enum: ['member', 'host', 'unknown'] },
        status: { type: 'object' },
        tail: { type: 'array' },
        your_recent: { type: 'array' },
        inbox_unread: { type: 'array' },
        last_activity: str,
      },
    },
  },
  {
    name: 'status',
    category: 'read',
    summary: 'pending/approved/executing counts, open issues, unread inbox',
    input: {
      type: 'object',
      properties: { for: str, format: formatField },
    },
    output: { type: 'object' },
  },
  {
    name: 'resume',
    category: 'read',
    summary: 'restoration prompt: last utterance, last transition, open loops, suggested next',
    input: {
      type: 'object',
      properties: {
        format: formatField,
        locale: { type: 'string', enum: ['en', 'ja'], description: 'prose language; also via GUILD_LOCALE env' },
      },
    },
    output: {
      type: 'object',
      properties: {
        actor: str,
        session_hint: str,
        last_context: {
          type: 'object',
          properties: {
            summary: str,
            last_utterance: { type: 'object' },
            last_transition: { type: 'object' },
            open_loops: { type: 'array' },
          },
        },
        suggested_next: { type: 'object' },
        restoration_prose: str,
      },
    },
  },
  {
    name: 'whoami',
    category: 'read',
    summary: 'identity + recent utterances (requires GUILD_ACTOR)',
    input: { type: 'object', properties: { limit: str } },
    output: { type: 'object' },
  },
  {
    name: 'tail',
    category: 'read',
    summary: 'unified recent-activity stream across all actors',
    input: { type: 'object' },
    output: { type: 'array' },
  },
  {
    name: 'voices',
    category: 'read',
    summary: 'everything one actor has said (authored or reviewed)',
    input: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'positional; actor name' },
        lense: str,
        verdict: str,
        limit: str,
        format: formatField,
      },
      required: ['name'],
    },
    output: { type: 'array' },
  },
  {
    name: 'show',
    category: 'read',
    summary: 'detail view of one request',
    input: {
      type: 'object',
      properties: { id: idStr, format: formatField },
      required: ['id'],
    },
    output: { type: 'object' },
  },
  {
    name: 'chain',
    category: 'read',
    summary: 'walk cross-references one hop from id',
    input: {
      type: 'object',
      properties: { id: idStr },
      required: ['id'],
    },
    output: { type: 'object' },
  },
  {
    name: 'list',
    category: 'read',
    summary:
      'filter requests by state + optional actor filters. Requires --state; for counts across every state use `status`.',
    input: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          enum: ['pending', 'approved', 'executing', 'completed', 'failed', 'denied'],
          description:
            'required. Contents of one state. `status` is the sibling verb that returns counts across every state.',
        },
        for: str,
        from: str,
        executor: str,
        'auto-review': str,
      },
      required: ['state'],
    },
    output: { type: 'array' },
  },
  {
    name: 'pending',
    category: 'read',
    summary: 'list requests in pending state',
    input: { type: 'object', properties: { for: str } },
    output: { type: 'array' },
  },
  {
    name: 'register',
    category: 'write',
    summary:
      'one-shot member registration. Writes members/<name>.yaml. ' +
      'Category defaults to "professional"; aliases accepted (pro, prof, member → professional). ' +
      '--dry-run previews the YAML without touching disk.',
    input: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'new member name (lowercase ASCII, 1-32 chars, matches /^[a-z][a-z0-9_-]{0,31}$/)',
        },
        category: strOpt(
          'member category; defaults to "professional". Canonical: core/professional/assignee/trial/special/host. Host is NOT accepted via CLI (edit guild.config.yaml).',
        ),
        'display-name': strOpt('human-readable display label, optional'),
        'dry-run': strOpt('preview the YAML without writing to disk'),
        format: formatField,
      },
      required: ['name'],
    },
    output: { type: 'object' },
  },
  {
    name: 'request',
    category: 'write',
    summary: 'file a new request',
    input: {
      type: 'object',
      properties: {
        from: strOpt('author (defaults to $GUILD_ACTOR)'),
        action: str,
        reason: str,
        executor: strOpt('who will execute'),
        target: str,
        'auto-review': strOpt('member assigned as critic'),
        with: strOpt('comma-separated dialogue partners (pair-mode)'),
        format: formatField,
      },
      required: ['action', 'reason'],
    },
    output: writeResponseSchema,
  },
  {
    name: 'approve',
    category: 'write',
    summary: 'transition pending → approved',
    input: {
      type: 'object',
      properties: {
        id: idStr,
        by: strOpt('approver (defaults to $GUILD_ACTOR)'),
        note: str,
        format: formatField,
      },
      required: ['id'],
    },
    output: writeResponseSchema,
  },
  {
    name: 'deny',
    category: 'write',
    summary: 'transition pending → denied (terminal)',
    input: {
      type: 'object',
      properties: {
        id: idStr,
        by: str,
        reason: strOpt('alias for --note'),
        note: strOpt('closure note; falls back to positional arg'),
        format: formatField,
      },
      required: ['id'],
    },
    output: writeResponseSchema,
  },
  {
    name: 'execute',
    category: 'write',
    summary: 'transition approved → executing',
    input: {
      type: 'object',
      properties: { id: idStr, by: str, note: str, format: formatField },
      required: ['id'],
    },
    output: writeResponseSchema,
  },
  {
    name: 'complete',
    category: 'write',
    summary: 'transition executing → completed',
    input: {
      type: 'object',
      properties: { id: idStr, by: str, note: str, format: formatField },
      required: ['id'],
    },
    output: writeResponseSchema,
  },
  {
    name: 'fail',
    category: 'write',
    summary: 'transition executing → failed (terminal)',
    input: {
      type: 'object',
      properties: { id: idStr, by: str, reason: str, note: str, format: formatField },
      required: ['id'],
    },
    output: writeResponseSchema,
  },
  {
    name: 'review',
    category: 'write',
    summary: 'append a review to a request',
    input: {
      type: 'object',
      properties: {
        id: idStr,
        by: str,
        lense: { type: 'string', description: 'one of the configured lenses (devil/layer/cognitive/user by default)' },
        verdict: { type: 'string', enum: ['ok', 'concern', 'reject'] },
        comment: strOpt('review body; "-" for STDIN'),
        format: formatField,
      },
      required: ['id', 'by', 'lense', 'verdict'],
    },
    output: writeResponseSchema,
  },
  {
    name: 'fast-track',
    category: 'write',
    summary: 'one-shot create→complete lifecycle (self-approved)',
    input: {
      type: 'object',
      properties: {
        from: str,
        action: str,
        reason: str,
        executor: str,
        'auto-review': str,
        with: strOpt('comma-separated dialogue partners (pair-mode)'),
        note: str,
        format: formatField,
      },
      required: ['action', 'reason'],
    },
    output: writeResponseSchema,
  },
  {
    name: 'issues',
    category: 'write',
    summary: 'subcommands: add|list|note|resolve|defer|start|reopen|promote',
    input: {
      type: 'object',
      properties: {
        subcommand: {
          type: 'string',
          enum: ['add', 'list', 'note', 'resolve', 'defer', 'start', 'reopen', 'promote'],
          description:
            "`note` appends an annotation without mutating severity/area/text — the issue record is otherwise immutable.",
        },
      },
    },
    output: { type: 'object' },
  },
  {
    name: 'message',
    category: 'write',
    summary: 'send a direct notification to one member',
    input: {
      type: 'object',
      properties: { from: str, to: str, text: str },
      required: ['to', 'text'],
    },
    output: { type: 'object' },
  },
  {
    name: 'broadcast',
    category: 'write',
    summary: 'post to every active member except sender',
    input: {
      type: 'object',
      properties: { from: str, text: str },
      required: ['text'],
    },
    output: { type: 'object' },
  },
  {
    name: 'inbox',
    category: 'read',
    summary: 'list messages for a member; mark-read as subcommand',
    input: {
      type: 'object',
      properties: { for: str, unread: { type: 'boolean' } },
    },
    output: { type: 'array' },
  },
  {
    name: 'doctor',
    category: 'admin',
    summary: 'read-only content-root health check',
    input: { type: 'object', properties: { summary: { type: 'boolean' }, format: formatField } },
    output: { type: 'object' },
  },
  {
    name: 'repair',
    category: 'admin',
    summary: 'quarantine malformed records (reads gate doctor json)',
    input: { type: 'object', properties: { apply: { type: 'boolean' }, 'from-doctor': str } },
    output: { type: 'object' },
  },
  {
    name: 'schema',
    category: 'meta',
    summary: 'this introspection payload',
    input: { type: 'object', properties: { verb: str, format: formatField } },
    output: { type: 'object' },
  },
];

export async function schemaCmd(_c: C, args: ParsedArgs): Promise<number> {
  const format = optionalOption(args, 'format') ?? 'json';
  if (format !== 'json' && format !== 'text') {
    throw new Error(`--format must be 'json' or 'text', got: ${format}`);
  }
  const verbFilter = optionalOption(args, 'verb');
  const verbs = verbFilter
    ? VERBS.filter((v) => v.name === verbFilter)
    : VERBS;
  if (verbFilter && verbs.length === 0) {
    throw new Error(`unknown verb: ${verbFilter}`);
  }
  const payload = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    // semver so consumers can pin a major and tolerate additions.
    // Bump the major only for breaking changes to the schema payload
    // itself (not to individual verb schemas).
    version: '0.1.0',
    verbs: verbs.map((v) => ({
      name: v.name,
      category: v.category,
      summary: v.summary,
      input: v.input,
      output: v.output,
    })),
  };
  if (format === 'json') {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    const lines: string[] = [];
    for (const v of verbs) {
      const req = v.input.required?.join(', ') ?? '';
      lines.push(`${v.name} [${v.category}] — ${v.summary}`);
      if (req) lines.push(`  required: ${req}`);
    }
    process.stdout.write(lines.join('\n') + '\n');
  }
  return 0;
}

export { VERBS };
