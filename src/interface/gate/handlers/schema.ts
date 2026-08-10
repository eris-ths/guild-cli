import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { C } from './internal.js';
import { parseFormat } from '../../shared/parseFormat.js';

const SCHEMA_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format', 'verb', 'voice']);

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

export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: string[];
  description?: string;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  /**
   * Hard ceiling on string length for free-form text fields. Surfaced
   * here so AI consumers can pre-validate payload length without
   * having to compose, submit, and recover from a domain-side
   * DomainError (asteria dogfood 2026-05-16 finding F1).
   * Domain caps: MAX_TEXT=4096 (action/reason/note/comment/text);
   * MAX_STAKE_NOTE=80 (witness/claim stake notes).
   */
  maxLength?: number;
};

export interface VerbSchema {
  readonly name: string;
  readonly summary: string;
  readonly category: 'read' | 'write' | 'admin' | 'meta';
  readonly input: JsonSchema;
  readonly output: JsonSchema;
  /**
   * Origin discriminator (issue #36 Phase 1 groundwork). Built-in
   * verbs declared in this file omit the field and are emitted as
   * `source: 'core'` by `schemaCmd`'s default. The forthcoming
   * verb-plugin loader will register schemas with `source: 'plugin'`
   * so MCP wirings and LLM tool layers can filter built-in surface
   * from extensions without cross-checking another source of truth.
   * Stability contract: `docs/POLICY.md` § "Plugin stability".
   */
  readonly source?: 'core' | 'plugin';
}

const str: JsonSchema = { type: 'string' };
const strOpt = (description?: string): JsonSchema =>
  description ? { type: 'string', description } : { type: 'string' };
// Domain-side caps for free-form text fields (action / reason / note /
// review comment / message text). Surfaced here so AI consumers know
// the ceiling without having to guess or hit a domain error after
// composing a long payload (asteria dogfood 2026-05-16 finding F1).
// Keep in sync with `MAX_TEXT` / `MAX_STAKE_NOTE` in Request.ts.
const TEXT_MAX = 4096;
const STAKE_NOTE_MAX = 80;
const textField = (description?: string): JsonSchema =>
  description
    ? { type: 'string', maxLength: TEXT_MAX, description }
    : { type: 'string', maxLength: TEXT_MAX };
const stakeNoteField = (description?: string): JsonSchema =>
  description
    ? { type: 'string', maxLength: STAKE_NOTE_MAX, description }
    : { type: 'string', maxLength: STAKE_NOTE_MAX };
const idStr: JsonSchema = {
  type: 'string',
  description:
    'positional; request id (YYYY-MM-DD-NNNN) or issue id (i-YYYY-MM-DD-NNNN)',
};
const formatField: JsonSchema = {
  type: 'string',
  enum: ['json', 'text'],
  description: 'output format (agent-first default: json for read; text for write)',
};
// Shared dry-run schema field. Boolean (the parser accepts bare
// `--dry-run`, `--dry-run=true`, `--dry-run=false`). Declared on every
// write verb that supports the preview envelope (approve/deny/execute/
// complete/fail/review/thank/register) so MCP wirings reading the
// schema see the runtime contract honestly. Pre-this-fix, register
// declared it as a string and the seven other verbs didn't declare
// it at all — the runtime accepted --dry-run on all eight, but the
// schema lied by omission.
const dryRunField: JsonSchema = {
  type: 'boolean',
  description:
    'preview the would-be write without persisting. Output is a ' +
    'json envelope (dry_run/verb/would_transition/preview) regardless ' +
    'of --format.',
};

// Inner property shape of every `suggested_next` payload, exported
// as a named const so multiple verb output schemas (write response,
// boot, suggest) can share a single source of truth. Hand-rolled
// inline copies in older revisions drifted (devil's B2 review on
// 2026-05-01-0005); this prevents that recurring.
const suggestedNextProperties: Record<string, JsonSchema> = {
  verb: str,
  args: {
    type: 'object',
    description: 'pre-filled argument hints — agent may override',
  },
  reason: str,
  actor_resolved: {
    type: 'boolean',
    description:
      'true iff `args.by` is absent or matches the calling actor (GUILD_ACTOR). ' +
      'When false, the suggestion names a different actor — orchestrators should ' +
      'branch (escalate / hand off) rather than naively dispatching with their own --by.',
  },
};

const suggestedNextSchema: JsonSchema = {
  type: 'object',
  properties: suggestedNextProperties,
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
    _meta: {
      type: 'object',
      description:
        'Optional metadata block carrying surface-level annotations that ' +
        'augment but never replace the structured payload. Consumers may ' +
        'ignore `_meta` entirely; nothing in it carries facts the rest ' +
        "of the envelope doesn't already carry.",
      properties: {
        voice: {
          type: 'string',
          description:
            'Ornamental-voice narration string (#345 — second dogfood ' +
            'validation of principle 15). Present only when a voice ' +
            'plugin is loaded, `GUILD_VOICE=<name>` picks it, and a ' +
            'template matched the current request snapshot. Distinct ' +
            'from the doctrinal voice held in `message` and ' +
            '`suggested_next.reason` (principle 08, voice-as-doctrine ' +
            '— that voice is intentionally NOT pluggable). Ornamental ' +
            'voice is the second layer: deployment-local personality ' +
            'that augments envelopes without claiming new facts. ' +
            'Stripping `_meta.voice` from a pipeline loses no ' +
            'information.',
        },
      },
    },
  },
  required: ['ok', 'id', 'state', 'message', 'suggested_next'],
};

// Shared utterance shape — emitted by `gate voices --format json`,
// `gate tail --format json`, and the `tail`/`your_recent` fields of
// `gate boot`. Fleshed out per principle 10 (schema as contract):
// pre-fix, both tail and voices declared `output: { type: 'array' }`
// with no `items`, so an MCP wiring saw "an array of something"
// and had to discover the shape empirically. All keys are
// snake_case post-#109. Field unions are NOT modelled with `oneOf`
// (the JsonSchema subset doesn't include it); instead we describe
// the discriminated union via the `kind` enum and document
// kind-specific fields in their `description`.
const utteranceSchema: JsonSchema = {
  type: 'object',
  description:
    'A single utterance — authored / review / thank — emitted in the order ' +
    'requested by the verb (asc for voices, desc for tail). Fields below ' +
    'are the union across kinds; each individual utterance only carries ' +
    'the fields applicable to its kind.',
  properties: {
    kind: {
      type: 'string',
      enum: ['authored', 'review', 'thank'],
      description:
        'Discriminator. authored = a request was filed; review = a reviewer ' +
        'rendered judgement on a request; thank = an actor thanked another for work.',
    },
    at: {
      type: 'string',
      description: 'ISO timestamp when the utterance was made.',
    },
    request_id: {
      type: 'string',
      description: 'YYYY-MM-DD-NNNN id of the containing request.',
    },
    // authored fields
    from: {
      type: 'string',
      description: '[authored only] member who authored the request.',
    },
    action: {
      type: 'string',
      description:
        '[authored | review | thank] action of the containing request, ' +
        'mirrored onto review/thank utterances so readers see context ' +
        'without chasing the id.',
    },
    reason: {
      type: 'string',
      description:
        '[authored | thank] free-form reason; required on authored, ' +
        'optional on thank.',
    },
    completion_note: {
      type: 'string',
      description:
        '[authored only, terminal=completed] closure note. Mutually ' +
        'exclusive with deny_reason and failure_reason — at most one ' +
        'is set per request.',
    },
    deny_reason: {
      type: 'string',
      description:
        '[authored only, terminal=denied] denial reason. Mutually ' +
        'exclusive with completion_note and failure_reason.',
    },
    failure_reason: {
      type: 'string',
      description:
        '[authored only, terminal=failed] failure reason. Mutually ' +
        'exclusive with completion_note and deny_reason.',
    },
    with: {
      type: 'array',
      items: { type: 'string' },
      description: '[authored only] pair-mode dialogue partners.',
    },
    // review fields
    by: {
      type: 'string',
      description: '[review | thank] member who wrote the review or thank.',
    },
    lense: {
      type: 'string',
      description: '[review only] reviewer lense (devil/layer/cognitive/user).',
    },
    verdict: {
      type: 'string',
      description: '[review only] reviewer verdict (ok/concern/reject).',
    },
    comment: {
      type: 'string',
      description: '[review only] review comment.',
    },
    // thank fields
    to: {
      type: 'string',
      description: '[thank only] member receiving the thanks.',
    },
    // shared optional
    invoked_by: {
      type: 'string',
      description:
        '[any kind, optional] actual CLI invoker when proxied — set when ' +
        'GUILD_ACTOR differed from the attributed actor (`from` / `by`). ' +
        'Absent in the self-invocation common case.',
    },
  },
  required: ['kind', 'at', 'request_id'],
};

const utteranceArraySchema: JsonSchema = {
  type: 'array',
  items: utteranceSchema,
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
        'since-last-mine': {
          type: 'string',
          description:
            'Sugar for --since pointing at "the actor\'s last authored ' +
            'write" (#345 cluster refinement). Internally resolves to ' +
            'computeLastAuthoredWriteAt(GUILD_ACTOR) and applies the ' +
            'same delta-filter semantic. Mutually exclusive with --since ' +
            '(usage error to pass both). Requires GUILD_ACTOR — without ' +
            'one there is no "mine" to anchor against. If the actor has ' +
            'never authored a write, the cutoff is null and boot returns ' +
            'the full snapshot (correct first-time-here behavior). Boolean ' +
            'flag (no value).',
        },
        since: {
          type: 'string',
          description:
            'Delta-filter timestamp (ISO-8601 UTC, e.g. ' +
            '2026-05-14T01:02:03.456Z). When set, `tail`, `your_recent`, ' +
            'and `inbox_unread` only contain entries strictly newer than ' +
            'this value (lexicographic compare on the `at` string). ' +
            'Reduces token cost across a long session — pass the previous ' +
            "boot's `last_activity` to get only what's new. The " +
            '`status.inbox_unread` SCALAR reflects the true unread count ' +
            '(not the filtered slice), so the counter stays truthful. ' +
            '`last_activity` itself is NOT filtered so the next boot can ' +
            'chain --since without a second read. Rejected with a "next: " ' +
            'hint when the value is not strict ISO-8601 UTC.',
        },
        'session-id': {
          type: 'string',
          description:
            'Boot-context session_id (#249 slice 2). When set, validated ' +
            'against the SESSION_ID_RE format (lowercase alphanumeric + ' +
            '_-.: separators, ≤64 chars) and echoed in the payload as ' +
            '`session_id` so an orchestrator can confirm what value will ' +
            'be stamped on subsequent write verbs (request / claim / ' +
            'witness). Does NOT export the value; the caller is expected ' +
            'to `export GUILD_SESSION_ID=<id>` to make it available to ' +
            'downstream invocations. Resolution priority: --session-id ' +
            '(this flag) > GUILD_SESSION_ID env > none. Per the issue ' +
            '#249 opt-in policy, an actor-resolved boot with no session ' +
            'surfaces `hints.session_id_unset: true` so the feature is ' +
            'discoverable without forcing a value.',
        },
        by: {
          type: 'string',
          description:
            'Identity override for this invocation. Boot consults ' +
            'GUILD_ACTOR by default; `--by <actor>` lets callers without ' +
            'env (cold scripts, CI) resolve identity without exporting. ' +
            'Lifecycle verbs all take `--by`; aligning boot removes the ' +
            'cross-verb surprise where the same caller had to switch ' +
            'channels between env (for boot) and flag (for everything ' +
            'else). Precedence: --by > --as > GUILD_ACTOR env.',
        },
        as: {
          type: 'string',
          description:
            'Prose-natural alias for --by. Same semantics; pick whichever ' +
            'reads better at the call site. `gate boot --as eris` reads as ' +
            'a role assumption; `gate boot --by eris` matches lifecycle-verb ' +
            'muscle memory.',
        },
      },
    },
    output: {
      type: 'object',
      properties: {
        actor: str,
        role: { type: 'string', enum: ['member', 'host', 'unknown'] },
        session_id: {
          type: 'string',
          description:
            'Boot-context session_id (#249 slice 2). Echoes the value ' +
            'resolved from --session-id (this invocation) or ' +
            'GUILD_SESSION_ID env (whole shell). null when neither is ' +
            'set. Subsequent gate request / claim / witness calls in ' +
            'the same shell with GUILD_SESSION_ID exported will stamp ' +
            'this id into opened_by_session / claimed_by_session / ' +
            'witness_sessions[<actor>].',
        },
        session_id_source: {
          type: 'string',
          enum: ['flag', 'env', 'unset'],
          description:
            'Names which input populated `session_id`: "flag" when ' +
            '--session-id was supplied on this invocation, "env" when ' +
            'GUILD_SESSION_ID was the source, "unset" when neither ' +
            '(session_id is null in that case).',
        },
        since: {
          type: 'string',
          description:
            'Echoes the --since input value verbatim when a delta ' +
            'filter was applied. Null when no filter; payload is the ' +
            'full snapshot. Useful for an agent to confirm what cutoff ' +
            'the substrate actually used before chaining the next boot.',
        },
        status: { type: 'object' },
        tail: { type: 'array' },
        your_recent: { type: 'array' },
        inbox_unread: { type: 'array' },
        last_activity: str,
        cross_passage: {
          type: 'object',
          description:
            'Cross-passage orientation. Per-passage summary keyed by ' +
            "passage name (currently 'agora' and 'devil'). Empty when no " +
            'passage besides gate has any records under the content_root. ' +
            'Each entry shape: { passage, open, suspended, last_id, last_state, last_at, ' +
            'oldest_suspended_age_days, oldest_suspended_cliff }. The last two are a ' +
            'forgotten-thread alarm: a bare suspended count reads the same whether the ' +
            'oldest pause is hours or months old, so age + one-line cliff surface staleness ' +
            '(null when nothing is paused). ' +
            "Surfaced so a fresh instance booting on a content_root with " +
            "active agora plays or devil reviews sees them at the orientation " +
            "entry point — closes the substrate-side Zeigarnik continuity " +
            'across session boundaries (records-outlive-writers requires ' +
            'records also be findable on re-entry).',
        },
        active_overlapping_targets: {
          type: 'array',
          description:
            'Cross-session race detection (issue #234). Active ' +
            "(pending|approved|executing) requests sharing a `target` " +
            'string, grouped by target, surfaced when any group has ' +
            'size ≥ 2. Exact-match grouping; fuzzy variants are out of ' +
            'scope per the issue. Empty array in the no-overlap common ' +
            'case. Per-entry: { target, requests: [{ id, state, ' +
            'executors[], claimed_by | null }] }; per-target requests ' +
            'are sorted by id ascending. Phase 1 surfaces the warning ' +
            'on every profile (the swarm-side refuse-on-create lives ' +
            "with the parent epic #227, not in this slot).",
          items: {
            type: 'object',
            properties: {
              target: { type: 'string' },
              requests: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    state: {
                      type: 'string',
                      enum: ['pending', 'approved', 'executing'],
                    },
                    executors: { type: 'array', items: { type: 'string' } },
                    claimed_by: { type: 'string' },
                    opened_by_session: {
                      type: 'string',
                      description:
                        'session_id this request was authored under ' +
                        '(#249 slice 4). Carried verbatim from the ' +
                        "record's opened_by_session field. Omitted when " +
                        'the record has no session stamp (pre-#249 or ' +
                        'unstamped post-#249 writes).',
                    },
                  },
                },
              },
              parallel_session_authors: {
                type: 'object',
                description:
                  'Members in this overlap group who authored ≥2 ' +
                  'requests from ≥2 distinct sessions (#249 slice 4). ' +
                  'Map keys are member names (lowercase, canonical); ' +
                  'values are the distinct session_ids the member ' +
                  'authored from inside this group, in first-mention ' +
                  'order. Omitted when no member self-races. The boot ' +
                  'text rendering surfaces a per-actor warning ' +
                  '(`⚠ same-actor parallel sessions: ...`) for each ' +
                  'entry; JSON consumers branch on the field directly. ' +
                  'Detection requires ≥2 of the actor\'s records in ' +
                  "the group to carry an opened_by_session AND those " +
                  'values to diverge — pre-#249 / unstamped records do ' +
                  'NOT count toward divergence (provenance unknown).',
              },
            },
          },
        },
        suggested_next: {
          type: 'object',
          description:
            'Advisory — NOT a directive. Orientation-time guidance ' +
            'about what to do next, derived from queues + open loops. ' +
            "Read `reason` and override when your judgement differs. " +
            'Priority is shared with `gate suggest`; both are hints. ' +
            'Two shapes share this slot: the canonical verb/args/reason ' +
            'triple (state-transition hints) and the ' +
            '`broadcast-pending-response` shape ' +
            '({kind, broadcast_from, broadcast_at, hint, actor_resolved}) ' +
            'when the only open loop is an unread opt-in broadcast. The ' +
            'discriminator is the `kind` field — present for ' +
            'broadcast-pending-response, absent for state-transition hints. ' +
            '`actor_resolved` is shared across both variants (always true ' +
            'for the broadcast variant — the surface only fires on the ' +
            "caller's own inbox). Phase 1 does NOT track who/when " +
            'responded; the surface clears on inbox mark-read.',
          // Open-shape union: every field from both variants is listed
          // as an optional property. The validator (validateActualOutput)
          // is permissive on extras and strict on declared types, so
          // either variant validates without false positives. JsonSchema
          // draft-07 oneOf would be cleaner but the gate schema subset
          // doesn't include it (see schema.ts header).
          properties: {
            ...suggestedNextProperties,
            kind: {
              type: 'string',
              enum: ['broadcast-pending-response'],
              description:
                'discriminator for the pending-broadcast variant. ' +
                'Absent on state-transition hints.',
            },
            broadcast_from: {
              type: 'string',
              description:
                '[broadcast-pending-response only] sender of the unread ' +
                'opt-in broadcast.',
            },
            broadcast_at: {
              type: 'string',
              description:
                '[broadcast-pending-response only] ISO timestamp of the ' +
                'broadcast post.',
            },
            hint: {
              type: 'string',
              description:
                '[broadcast-pending-response only] free-form recipient ' +
                'guidance — does not prescribe a verb.',
            },
          },
        },
        suggested_next_reason: {
          type: 'string',
          description:
            'Short explanation when `suggested_next` is null but open ' +
            'work exists. Closes the gap a host sees as "status.pending ≥ 1, ' +
            'but suggested_next is null" — names which open requests ' +
            'exist and where to read them. Emitted as JSON null when ' +
            'silence is genuine (no open work, or actor is unresolved).',
        },
        past_cliffs: {
          type: 'array',
          description:
            'Forward-pointing close notes the actor (or one of their wave ' +
            'executors) left on completed requests (#37x). ' +
            'Most-recent-terminal-first, capped at 5. Each entry surfaces ' +
            'id, action (context), cliff prose, closing actor (closed_by), ' +
            'and closed_at. Null when no actor is resolved (global-view ' +
            "boot — there's no self to attach 'past selves' to). Empty " +
            'array when the actor has no recent cliff-stamped closures. ' +
            "Honours --since: cliffs older than the cutoff are filtered " +
            'out alongside tail / your_recent. Zeigarnik continuity for ' +
            "gate, mirroring agora's cliff/invitation pattern.",
          items: {
            type: 'object',
            properties: {
              id: idStr,
              action: str,
              cliff: str,
              closed_by: str,
              closed_at: str,
            },
            required: ['id', 'action', 'cliff', 'closed_by', 'closed_at'],
          },
        },
        verbs_available_now: {
          type: 'object',
          description:
            "Discoverability hint: which verbs are dispatchable right now. " +
            "`actionable` lists transitions the caller can fire as themselves; " +
            "`requires_other_actor` names blockers (e.g. pending requests waiting " +
            'on a host) with `candidates` so domain-specific actor models can ' +
            "re-interpret without the payload pre-baking a host assumption; " +
            "`always_readable` is the side-effect-free verb catalog.",
          properties: {
            actionable: {
              type: 'array',
              description:
                'State-transition verbs the caller can fire as themselves, ' +
                'each carrying the target id + reason. The `verb` enum ' +
                'includes `show` for the `reviewed-authored` surface — ' +
                'the actor authored a request, peers landed reviews on it, ' +
                'and the agent should read those reviews. Boundary advances ' +
                'when the actor writes to any request aggregate ' +
                '(status_log, reviews, or thanks); message and issue ' +
                'writes do NOT advance it (those have their own ' +
                'notification surfaces — mixing dilutes the signal).',
              items: {
                type: 'object',
                properties: {
                  verb: {
                    type: 'string',
                    enum: [
                      'approve',
                      'deny',
                      'execute',
                      'complete',
                      'fail',
                      'review',
                      'show',
                    ],
                  },
                  id: str,
                  reason: str,
                },
              },
            },
            requires_other_actor: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  verb: str,
                  id: str,
                  candidates: { type: 'array', items: str },
                  reason: str,
                },
              },
            },
            always_readable: { type: 'array', items: str },
          },
        },
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
    name: 'next',
    category: 'read',
    summary:
      'one-call read-and-dispatch of the top actionable verb. Without --confirm: prints the plan (verb/args/reason). With --confirm: dispatches via subprocess. Auto-dispatches only verbs that need only --by (complete/execute/approve/show); verbs needing extra args (review/deny/fail) refuse and prompt for manual invocation. Sibling of boot — same actionable ladder, one verb to act on it.',
    input: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description:
            'When true, dispatch the actionable[0] verb via subprocess and propagate its exit code. When false (default), print the plan only.',
        },
        format: formatField,
      },
    },
    output: {
      type: 'object',
      description:
        '--format json: {plan: {verb, id, reason, by, can_auto_dispatch, command, needs_extra_args?}, dispatched: boolean, exit_code?: number}. plan=null when there is nothing actionable.',
    },
  },
  {
    name: 'voice',
    category: 'admin',
    summary:
      'mode-switch lever for the 4-layer voice resolution. set / read / clear the deployment-local voice mode marker (.guild-voice). per-invocation --voice flags layer on top; this verb writes the persistent middle tier so an operator can flip "今この気分" in one keystroke instead of re-exporting GUILD_VOICE.',
    input: {
      type: 'object',
      properties: {
        format: formatField,
      },
    },
    output: {
      type: 'object',
      description:
        'Three modes: (1) no positional → introspect ({active, source, file_path}); ' +
        '(2) `gate voice <name>` → write .guild-voice to <content_root>; ' +
        '(3) `gate voice off` → delete .guild-voice. Resolution priority ' +
        '(low→high): config.voice.default < .guild-voice file < GUILD_VOICE ' +
        'env < per-invocation --voice flag. Name validation matches the ' +
        'plugin name regex; the verb is permissive on whether the named ' +
        'voice is currently loaded (silent-miss contract carried over from ' +
        'write-envelope ornamental voice).',
    },
  },
  {
    name: 'suggest',
    category: 'read',
    summary:
      'tight-loop sibling of boot: returns ONLY the suggested_next triple (verb/args/reason) or null, with no orientation payload',
    input: {
      type: 'object',
      properties: { format: formatField },
    },
    output: {
      type: 'object',
      properties: {
        suggested_next: {
          type: 'object',
          description:
            'Advisory — NOT a directive. Derived deterministically from the ' +
            "caller's current queues using the same priority ladder as boot. " +
            "Agents should read `reason` and override when their own " +
            'judgement differs; a `suggest` loop that dispatches the verb ' +
            'without reading the reason is treating a heuristic as a ' +
            'command, which is the shape this field is trying to avoid.',
          // Mirror the canonical suggestedNextSchema so this surface
          // never drifts from the write-response shape (devil B2:
          // hand-rolled inline schema went stale when actor_resolved
          // was added). Keeps `actor_resolved` and any future field
          // visible to schema-aware consumers without a second edit.
          properties: suggestedNextProperties,
        },
        suggested_next_reason: {
          type: 'string',
          description:
            'Short explanation when `suggested_next` is null but open ' +
            'work exists on substrate (e.g. host with pending waves ' +
            'that name other executors). Emitted as JSON null when ' +
            'silence is genuine. Mirrors the sibling field on `gate boot`.',
        },
      },
    },
  },
  {
    name: 'flow-suggest',
    category: 'read',
    summary:
      'advisory: maps (severity, area, [scope]) → a recommended flow (fast-track / direct-pr / full-request) with reason and alternatives. Pure read; no substrate writes. Heuristic — `reason` is the load-bearing output.',
    input: {
      type: 'object',
      properties: {
        severity: {
          type: 'string',
          enum: ['low', 'med', 'high'],
          description: 'severity tier matching `gate issues add --severity`',
        },
        area: {
          type: 'string',
          description:
            'free-form domain tag (e.g. copy, doc, style, bug, auth, data). ' +
            'The engine matches case-insensitively against known buckets; ' +
            'unknown areas fall through to the conservative default.',
        },
        scope: {
          type: 'string',
          description:
            'optional scope hint (single-file, multi-file, multi-pr, ...). ' +
            'Echoed back in the response; not load-bearing in v1.',
        },
        format: formatField,
      },
      required: ['severity', 'area'],
    },
    output: {
      type: 'object',
      properties: {
        recommended: {
          type: 'string',
          enum: ['fast-track', 'direct-pr', 'full-request'],
        },
        reason: {
          type: 'string',
          description:
            'The load-bearing field: a one-line explanation of why this ' +
            'flow was chosen, in the same `key=value` shape the rest of ' +
            'the gate envelopes use.',
        },
        alternatives: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['fast-track', 'direct-pr', 'full-request'],
          },
          description:
            'Other flows the operator can fall back to if the primary ' +
            'recommendation does not fit the situation.',
        },
        inputs: {
          type: 'object',
          description:
            'Echo of the inputs the engine consumed, so the response is ' +
            'self-describing without the caller having to retain argv.',
          properties: {
            severity: { type: 'string' },
            area: { type: 'string' },
            scope: { type: 'string' },
          },
        },
      },
      required: ['recommended', 'reason', 'alternatives', 'inputs'],
    },
  },
  {
    name: 'transcript',
    category: 'read',
    summary:
      "narrative render of one request's full arc — the prose-first sibling of `gate show`. Text output reads as paragraphs; JSON output carries both the narrative and a structured summary (actors, review_verdicts, duration_ms).",
    input: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'positional; request id (YYYY-MM-DD-NNNN)' },
        format: {
          type: 'string',
          enum: ['text', 'json'],
          description: "output format (default: text — the narrative is what's useful here)",
        },
      },
      required: ['id'],
    },
    output: {
      type: 'object',
      properties: {
        id: str,
        arc: str,
        summary: {
          type: 'object',
          properties: {
            actors: { type: 'array' },
            actor_count: { type: 'integer' },
            review_count: { type: 'integer' },
            review_verdicts: { type: 'array' },
            final_state: str,
            duration_ms: { type: 'integer' },
          },
        },
      },
    },
  },
  {
    name: 'wave-status',
    category: 'read',
    summary:
      "per-executor in-flight slice status for a multi-executor request (#295). Composes witness notes + claim state + status_log timestamps to surface 'is each executor making progress?' inside a single wave. Sibling of `gate boot`'s cross-request overlap surface (#234) — this one is wave-axis, that one is actor-axis.",
    input: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'positional; request id (YYYY-MM-DD-NNNN)' },
        format: {
          type: 'string',
          enum: ['text', 'json'],
          description: 'output format (default: text — the per-executor block is human-readable)',
        },
      },
      required: ['id'],
    },
    output: {
      type: 'object',
      properties: {
        id: str,
        state: str,
        from: str,
        executors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: str,
              witness_note: { type: 'string', description: 'null when no witness note recorded for this executor' },
              witness_session: { type: 'string', description: 'null when no session_id was stamped on the witness' },
              claim_held: { type: 'boolean' },
              last_attributable_at: { type: 'string', description: 'most recent ISO timestamp in status_log attributable to this executor; null when no transition by them' },
              activity_band: {
                type: 'string',
                enum: ['fresh', 'in-progress', 'stale', 'active'],
              },
            },
          },
        },
        age_ms: { type: 'integer', description: 'ms since wave was approved; null when wave has never been approved' },
        age_band: {
          type: 'string',
          enum: ['fresh', 'in-progress', 'stale'],
        },
        approved_at: { type: 'string', description: 'ISO timestamp of the first approved entry in status_log; null when wave has never been approved' },
      },
    },
  },
  {
    name: 'swarm-status',
    category: 'read',
    summary:
      "cross-wave director / participant view (#346). Closes the principle-14 loop: composes wave-status across all active waves into one envelope so the director never has to compose 1 + N + N×M sub-reads. Returns waves, distinct-executor count, and a flat alerts array (stale_executor / overlapping_target / attribution_risk). Read-only; live picture not a stored snapshot.",
    input: {
      type: 'object',
      properties: {
        orchestrating: {
          type: 'string',
          description:
            'director-centric scope: keep only waves where this actor is the `from` author. "what swarm am I conducting?" When neither this nor --for is set and GUILD_ACTOR is in the env, defaults to orchestrating=GUILD_ACTOR (reported as scope.for_source="env").',
        },
        for: {
          type: 'string',
          description:
            'participant-centric scope: keep waves where this actor is from / executor / auto-review / with-partner. "what swarm am I part of?" Composes with --orchestrating via AND when both are set.',
        },
        format: formatField,
      },
    },
    output: {
      type: 'object',
      properties: {
        as_of: str,
        scope: {
          type: 'object',
          properties: {
            orchestrating: { type: 'string', description: 'echoed --orchestrating; null when unset' },
            for: { type: 'string', description: 'echoed --for; null when unset' },
            for_source: {
              type: 'string',
              enum: ['flag', 'env'],
              description: 'whether the scope came from a flag or from GUILD_ACTOR; null when no scope applied',
            },
          },
        },
        summary: {
          type: 'object',
          properties: {
            active_waves: { type: 'integer' },
            distinct_executors: { type: 'integer' },
            alerts: { type: 'integer' },
          },
        },
        waves: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: str,
              state: str,
              from: str,
              age_ms: { type: 'integer', description: 'ms since wave was approved; null when never approved' },
              age_band: { type: 'string', enum: ['fresh', 'in-progress', 'stale'] },
              approved_at: { type: 'string', description: 'ISO timestamp of first approved entry; null when never approved' },
              executors: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: str,
                    slice_status: { type: 'string', enum: ['pending', 'completed', 'failed', 'unknown'] },
                    last_attributable_at: { type: 'string', description: 'most recent ISO timestamp attributable to this executor; null when none' },
                    activity_band: {
                      type: 'string',
                      enum: ['fresh', 'in-progress', 'stale', 'active'],
                    },
                    claim_held: { type: 'boolean' },
                    witness_session: { type: 'string', description: 'null when no session_id was stamped on the witness' },
                  },
                },
              },
              wave_stale_effective: { type: 'boolean', description: 'true when every executor reads as stale (#309 semantics)' },
            },
          },
        },
        alerts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['stale_executor', 'overlapping_target', 'attribution_risk'] },
              wave_id: str,
              actor: str,
              why: str,
            },
          },
        },
      },
    },
  },
  {
    name: 'lense-stats',
    category: 'read',
    summary:
      "lense rotation diagnostic (#305): count review entries per lense over a window, highlight the most-frequent and least-frequent lense so bias surfaces. Sources gate `Request.reviews[]` + devil-passage `DevilReview.entries[]`. Read-only; default window 7d.",
    input: {
      type: 'object',
      properties: {
        for: { type: 'string', description: 'filter by author of the review/entry (review.by / entry.by)' },
        since: {
          type: 'string',
          description: 'window size as <int><s|m|h|d>; default 7d',
        },
        format: {
          type: 'string',
          enum: ['text', 'json'],
          description: 'output format (default: text)',
        },
      },
    },
    output: {
      type: 'object',
      properties: {
        window: {
          type: 'object',
          properties: {
            since: { type: 'string', description: 'ISO cutoff (now - duration)' },
            duration: { type: 'string', description: 'echoed --since value, e.g. "7d"' },
          },
        },
        filter: {
          type: 'object',
          properties: {
            actor: { type: 'string', description: 'echoed --for value; null when omitted' },
          },
        },
        totals: {
          type: 'object',
          properties: {
            entries_counted: { type: 'integer' },
            lenses_with_use: { type: 'integer' },
          },
        },
        most: { type: 'string', description: 'most-frequent lense; null when totals.entries_counted=0' },
        least: { type: 'string', description: 'least-frequent lense among those with ≥1 use; null when totals=0' },
        stats: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              lense: str,
              count: { type: 'integer' },
              last_at: { type: 'string', description: 'most recent ISO timestamp seen for this lense; null when count=0' },
              sources: {
                type: 'object',
                properties: {
                  gate_reviews: { type: 'integer' },
                  devil_entries: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
  },
  {
    name: 'review-context',
    category: 'read',
    summary:
      'reviewer-facing bundle for a wave: action/reason/target, executors, depth advisory (#221), recommended lense set by depth, and prior reviews. Lets a devil/reviewer agent drive behaviour from substrate state instead of out-of-band prompt content (#310 Layer A). Read-only; depth and lense-set are advisory not directive (principle 02).',
    input: {
      type: 'object',
      properties: {
        id: idStr,
        format: formatField,
      },
      required: ['id'],
    },
    output: {
      type: 'object',
      properties: {
        id: str,
        state: str,
        from: str,
        action: str,
        reason: str,
        target: { type: 'string', description: 'null when wave has no target field' },
        executors: { type: 'array', items: str },
        depth: {
          type: 'string',
          enum: ['shallow', 'standard', 'deep'],
          description: 'null when no depth was recorded on this wave',
        },
        recommended_lenses: { type: 'array', items: str },
        recommended_extras: { type: 'array', items: str },
        prior_reviews: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              by: str,
              lense: str,
              verdict: str,
              at: str,
              comment: { type: 'string', description: 'null when review carried no comment' },
            },
          },
        },
        warning: { type: 'string', description: 'empty string when depth is recorded' },
      },
    },
  },
  {
    name: 'decisions',
    category: 'read',
    summary:
      "actor's authored state transitions (approve / deny / execute / complete / fail) within a window. Decision-shaped sibling of `voices` (review-shaped) and `lense-stats` (lense-shaped). Defaults --for to GUILD_ACTOR.",
    input: {
      type: 'object',
      properties: {
        for: { type: 'string', description: "filter by status_log[].by (default: GUILD_ACTOR)" },
        since: {
          type: 'string',
          description: 'window size as <int><s|m|h|d>; default 7d',
        },
        limit: {
          type: 'string',
          description:
            'truncate the rendered list to the most-recent N entries after sort. ' +
            '`totals.entries_counted` continues to reflect pre-truncation total ' +
            'so callers can detect whether more existed past the cap. Sibling ' +
            '`gate voices --limit` shares this convention.',
        },
        format: formatField,
      },
    },
    output: {
      type: 'object',
      properties: {
        window: {
          type: 'object',
          properties: {
            since: str,
            duration: str,
          },
        },
        filter: {
          type: 'object',
          properties: { actor: str },
        },
        totals: {
          type: 'object',
          properties: {
            entries_counted: { type: 'integer' },
            by_transition: {
              type: 'object',
              properties: {
                approve: { type: 'integer' },
                deny: { type: 'integer' },
                execute: { type: 'integer' },
                complete: { type: 'integer' },
                fail: { type: 'integer' },
              },
            },
          },
        },
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              at: str,
              request_id: str,
              transition: { type: 'string', enum: ['approve', 'deny', 'execute', 'complete', 'fail'] },
              note: { type: 'string', description: 'null when no note recorded' },
            },
          },
        },
      },
    },
  },
  {
    name: 'self-pattern',
    category: 'read',
    summary:
      "actor's behavioral bias surface across a window: decision counts, review verdict ratio (ok/concern/reject), top review lense, approve-rate, ok-rate. Composes from existing substrate; for the *full* lense breakdown see `gate lense-stats --for <actor>`. Defaults --for to GUILD_ACTOR.",
    input: {
      type: 'object',
      properties: {
        for: { type: 'string', description: 'filter by author of status_log / review entries (default: GUILD_ACTOR)' },
        since: { type: 'string', description: 'window size as <int><s|m|h|d>; default 7d' },
        format: formatField,
      },
    },
    output: {
      type: 'object',
      properties: {
        window: { type: 'object', properties: { since: str, duration: str } },
        filter: { type: 'object', properties: { actor: str } },
        decisions: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            by_transition: {
              type: 'object',
              properties: {
                approve: { type: 'integer' },
                deny: { type: 'integer' },
                execute: { type: 'integer' },
                complete: { type: 'integer' },
                fail: { type: 'integer' },
              },
            },
          },
        },
        reviews: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            by_verdict: {
              type: 'object',
              description: 'verdict-keyed counts; keys present only when verdict was observed in window',
            },
            top_lense: { type: 'string', description: 'most-reached-for lense in window; null when no reviews' },
          },
        },
        ratios: {
          type: 'object',
          properties: {
            approve_rate: { type: 'number', description: 'approve / (approve + deny); null when both zero' },
            ok_rate: { type: 'number', description: 'ok / total reviews; null when no reviews' },
          },
        },
        hint: str,
      },
    },
  },
  {
    name: 'summarize',
    category: 'read',
    summary:
      'compressed view of a request: current state, decision, open concerns, review/thank counts. The 30-second-read sibling of transcript.',
    input: {
      type: 'object',
      properties: {
        id: idStr,
        format: formatField,
      },
      required: ['id'],
    },
    output: {
      type: 'object',
      properties: {
        id: str,
        state: str,
        decision: str,
        open_concerns: { type: 'array', items: { type: 'object' } },
        review_count: { type: 'integer' },
        thank_count: { type: 'integer' },
        actors: { type: 'array', items: str },
      },
    },
  },
  {
    name: 'why',
    category: 'read',
    summary:
      'decision-chain trace: terminal transition, reviews aligned with outcome, reviews that contested it. Perception, not judgement — shows which voices were heard, not whether the decision was correct.',
    input: {
      type: 'object',
      properties: {
        id: idStr,
        format: formatField,
      },
      required: ['id'],
    },
    output: {
      type: 'object',
      properties: {
        id: str,
        state: str,
        terminal_transition: { type: 'object' },
        aligned_reviews: { type: 'array', items: { type: 'object' } },
        contested_reviews: { type: 'array', items: { type: 'object' } },
        review_count: { type: 'integer' },
      },
    },
  },
  {
    name: 'resume',
    category: 'read',
    summary:
      'same-actor continuation: last utterance, last transition, open loops, suggested next. Does not surface cross-actor signals (inbox, --with); for orientation after a handoff, use `gate boot` instead.',
    input: {
      type: 'object',
      properties: {
        format: formatField,
        locale: { type: 'string', enum: ['en', 'ja'], description: 'prose language; also via GUILD_LOCALE env' },
        'with-doctor': {
          type: 'boolean',
          description:
            '#306 — augment payload with a `gate doctor` summary so session re-entry surfaces a dirty substrate before the agent starts writing again.',
        },
        'auto-repair': {
          type: 'boolean',
          description:
            '#306 — only meaningful with --with-doctor; runs `gate repair --apply` inline for quarantineable findings. Without --with-doctor this flag is rejected.',
        },
      },
    },
    output: {
      type: 'object',
      properties: {
        actor: str,
        session_hint: str,
        last_boundary: {
          type: 'object',
          description:
            'Most recent session-boundary record stamped by this actor (#36 Phase 2). ' +
            "Null when the actor has no `gate rest` / `gate wake` / `gate farewell` " +
            'records on file. Distinct from `session_hint` (which is the actor\'s last ' +
            'activity timestamp); a boundary record is an explicit "I am putting this ' +
            'down" / "picking it back up" / "until next session" stamp.',
          properties: {
            kind: { type: 'string', enum: ['rest', 'wake', 'farewell'] },
            at: str,
            age_hint: str,
            note: strOpt(),
          },
        },
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
        doctor: {
          type: 'object',
          description:
            '#306 — present only when --with-doctor was passed. Carries the diagnostic findings and a one-line summary; when --auto-repair was also passed, an `auto_repair` sub-object reports the quarantine outcome.',
          properties: {
            findings: { type: 'array', items: { type: 'object' } },
            summary: str,
            is_clean: { type: 'boolean' },
            auto_repair: {
              type: 'object',
              properties: {
                attempted: { type: 'boolean' },
                quarantined: { type: 'integer' },
                skipped: { type: 'integer' },
                errors: { type: 'integer' },
                summary: str,
              },
            },
          },
        },
      },
    },
  },
  {
    name: 'rest',
    category: 'write',
    summary:
      'boundary record (#36 Phase 2): stamps a "putting this down now" timestamp; not a lifecycle toggle. Optional --note. Pairs with `gate wake` — both verbs are independent, the relationship is observed by readers.',
    input: {
      type: 'object',
      properties: {
        by: strOpt('actor (defaults to $GUILD_ACTOR)'),
        note: strOpt('optional free-form context (≤ 240 chars)'),
        format: formatField,
      },
    },
    output: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        id: { type: 'string', description: 'YYYY-MM-DD-NNN per-day sequence' },
        kind: { type: 'string', enum: ['rest', 'wake', 'farewell'] },
        by: str,
        at: str,
        note: strOpt(),
        message: str,
        suggested_next: { type: 'object' },
      },
    },
  },
  {
    name: 'wake',
    category: 'write',
    summary:
      'boundary record (#36 Phase 2): stamps a "picking this back up" timestamp. Pairs with `gate rest` but does NOT require a prior rest record. Suggests `gate boot` next so a returning agent re-orients.',
    input: {
      type: 'object',
      properties: {
        by: strOpt('actor (defaults to $GUILD_ACTOR)'),
        note: strOpt('optional free-form context (≤ 240 chars)'),
        format: formatField,
      },
    },
    output: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        id: { type: 'string', description: 'YYYY-MM-DD-NNN per-day sequence' },
        kind: { type: 'string', enum: ['rest', 'wake', 'farewell'] },
        by: str,
        at: str,
        note: strOpt(),
        message: str,
        suggested_next: { type: 'object' },
      },
    },
  },
  {
    name: 'farewell',
    category: 'write',
    summary:
      'ceremonial close (#36 Phase 2): stamps an "until next session" timestamp. Distinct from `gate rest` — farewell ends the session, rest is a mid-session break. Pairs with `gate resume` at the next session start. suggested_next is null (terminal in the session sense).',
    input: {
      type: 'object',
      properties: {
        by: strOpt('actor (defaults to $GUILD_ACTOR)'),
        note: strOpt('optional free-form context (≤ 240 chars)'),
        format: formatField,
      },
    },
    output: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        id: { type: 'string', description: 'YYYY-MM-DD-NNN per-day sequence' },
        kind: { type: 'string', enum: ['rest', 'wake', 'farewell'] },
        by: str,
        at: str,
        note: strOpt(),
        message: str,
        suggested_next: { type: 'object' },
      },
    },
  },
  {
    name: 'whoami',
    category: 'read',
    summary: 'identity + recent utterances (requires GUILD_ACTOR)',
    input: {
      type: 'object',
      properties: {
        limit: str,
        format: formatField,
      },
    },
    output: {
      type: 'object',
      properties: {
        actor: str,
        role: { type: 'string', enum: ['member', 'host', 'unknown'] },
        display_name: {
          type: 'string',
          description:
            "member's human-facing label when present; emitted as null " +
            'for hosts or members without a display_name field. ' +
            "(Schema dialect doesn't model nullable; runtime field can be null.)",
        },
        actor_source: {
          type: 'string',
          enum: ['env', 'file'],
          description:
            'how GUILD_ACTOR was resolved: `env` (shell env var) or ' +
            '`file` (.guild-actor walked up from cwd). Surfaced so a ' +
            'fresh agent can tell shell-export apart from tree-dropped ' +
            'identity (principle 09: orientation-disclosure).',
        },
        recent_utterances: utteranceArraySchema,
      },
      required: ['actor', 'role', 'actor_source', 'recent_utterances'],
    },
  },
  {
    name: 'tail',
    category: 'read',
    summary: 'unified recent-activity stream across all actors',
    input: {
      type: 'object',
      properties: {
        limit: { type: 'string', description: 'max utterances (default 20); --limit or positional N' },
        format: formatField,
      },
    },
    output: utteranceArraySchema,
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
        'with-calibration': {
          type: 'boolean',
          description:
            'JSON mode only: opts into the {utterances, calibration} ' +
            'object shape (default bare array). Text mode emits the ' +
            'calibration footer regardless of this flag.',
        },
      },
      required: ['name'],
    },
    // voices defaults to a bare array; with --with-calibration the
    // shape becomes `{utterances, calibration}` (json mode only).
    // The schema declares the bare-array case; the calibration
    // wrapper is documented in the --with-calibration field's
    // description and remains the agent's opt-in.
    output: utteranceArraySchema,
  },
  {
    name: 'show',
    category: 'read',
    summary: 'detail view of one request',
    input: {
      type: 'object',
      properties: {
        id: idStr,
        format: formatField,
        fields: strOpt(
          'comma-separated key list to project the JSON payload to ' +
            '(agent-facing; --format json only). e.g. `state,from`.',
        ),
        plain: {
          type: 'boolean',
          description:
            '--plain + --fields <single-key>: emit just the value (no JSON ' +
            'quotes), so shell composers can substitute directly: ' +
            '`state=$(gate show $id --fields state --plain)`.',
        },
      },
      required: ['id'],
    },
    output: { type: 'object' },
  },
  {
    name: 'chain',
    category: 'read',
    summary:
      'walk cross-references one hop in both directions (forward: ids the root mentions; inbound: records that mention the root). Cross-passage: request-shaped ids that miss the gate store are probed against the agora play store and labelled when found.',
    input: {
      type: 'object',
      properties: {
        id: idStr,
        format: formatField,
      },
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
        format: {
          type: 'string',
          enum: ['json', 'text'],
          description: "default 'text'; --format json emits {requests, _meta} envelope",
        },
      },
      required: ['state'],
    },
    output: { type: 'object' },
  },
  {
    name: 'pending',
    category: 'read',
    summary: 'list requests in pending state',
    input: {
      type: 'object',
      properties: {
        for: str,
        format: {
          type: 'string',
          enum: ['json', 'text'],
          description: "default 'text'; --format json emits {requests, _meta} envelope",
        },
      },
    },
    output: { type: 'object' },
  },
  {
    name: 'board',
    category: 'read',
    summary:
      "what's in flight: pending + approved + executing, grouped by state. Sibling to status (counts) and list (single state). Terminal states (completed/failed/denied) and issues are out of scope.",
    input: {
      type: 'object',
      properties: { for: str, format: formatField },
    },
    output: {
      type: 'object',
      properties: {
        pending: { type: 'array' },
        approved: { type: 'array' },
        executing: { type: 'array' },
      },
    },
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
        'dry-run': dryRunField,
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
        action: strOpt(
          'request action. Required UNLESS --from-agora is supplied; ' +
            'with --from-agora the play\'s suspension `invitation` is ' +
            'used as action (override by passing --action explicitly).',
        ),
        reason: strOpt(
          'request reason. Required UNLESS --from-agora is supplied; ' +
            'with --from-agora the play\'s suspension `cliff` is used ' +
            'as reason (override by passing --reason explicitly).',
        ),
        executors: strOpt(
          'comma-separated executor list, whitespace-trimmed per entry, ' +
            'e.g. "miki, leysia" or "miki,leysia" (issue #230, ' +
            'multi-executor). Each name must match ' +
            '/^[a-z][a-z0-9_-]{0,31}$/; duplicates and empty entries ' +
            'rejected. Under profile=swarm, supplying >1 executor ' +
            'auto-stamps requires_worktree_isolation: true on the record ' +
            'so a later `gate execute` from the same physical cwd is ' +
            'refused (issue #231). The pre-v0.6 singular `--executor` ' +
            'alias was removed in v0.6 (#239 cut).',
        ),
        target: str,
        depth: {
          type: 'string',
          enum: ['shallow', 'standard', 'deep'],
          description:
            'reviewer-depth advisory (issue #221). shallow = surface ' +
            'point-check, no scope-widening; standard = current default ' +
            '(unchanged); deep = arch / threat-model. Advisory only — ' +
            'the substrate carries the value; the reviewer (typically ' +
            'the Devil agent) is the one that adapts. Default is ' +
            '"standard" when omitted.',
        },
        'auto-review': strOpt('member assigned as critic'),
        with: strOpt('comma-separated dialogue partners (pair-mode)'),
        'from-agora': strOpt(
          'agora play id (YYYY-MM-DD-NNN) to bridge into this request ' +
            '(#232). Lifts the play\'s most-recent suspension cliff into ' +
            '--reason and invitation into --action; either flag may still ' +
            'be passed explicitly to override the corresponding lift. ' +
            'Stamps source_agora_play on the record as ambient ' +
            'audit material (advisory per principle 02; #344 audit ' +
            'confirmed cold-reader-only consumer in `gate show` today). ' +
            'Refuses on concluded plays and on plays with no suspension ' +
            'on record (state=playing, never suspended).',
        ),
        game: strOpt(
          'agora game slug; only meaningful with --from-agora (#232). ' +
            'Disambiguates cross-game play-id collisions (each game ' +
            'sequences plays independently per day). Errors when passed ' +
            'without --from-agora.',
        ),
        format: formatField,
        template: strOpt(
          'wave-brief template name (#235). Expands a brief skeleton ' +
            'into action/reason defaults; explicit --action / --reason ' +
            "override. The template name + version are stamped onto the " +
            'request record (template / template_version / ' +
            'gate_required_acknowledged). Use `gate templates list` to ' +
            'see the catalogue.',
        ),
      },
      // action/reason are conditionally required: required unless one
      // of `--from-agora` (#232) or `--template` (#235) is supplied,
      // each of which provides its own action/reason defaults. `oneOf`
      // expresses the three-shape contract for JSON Schema consumers
      // (codegen, form-builders, AI tool-use schemas) so they don't
      // read action as unconditionally optional. The runtime handler
      // enforces the same branches via `requireOption`, and rejects
      // `--from-agora` + `--template` as mutually exclusive (both
      // supply defaults; precedence would be ambiguous).
      required: [],
      oneOf: [
        { required: ['action', 'reason'] },
        { required: ['from-agora'] },
        { required: ['template'] },
      ],
    },
    output: writeResponseSchema,
  },
  {
    name: 'templates',
    category: 'read',
    summary:
      'wave-brief template registry (#235, two-tier #302). Subcommands: list (catalogue), show <name> (full body). Two sources are resolved with content_root shadowing built-in: user override at <content_root>/data/guild/templates/wave-brief/, built-in shipped with guild-cli under <packageRoot>/templates/wave-brief/. Each list entry is tagged with its source.',
    input: {
      type: 'object',
      properties: {
        subcommand: {
          type: 'string',
          enum: ['list', 'show'],
        },
        name: strOpt('template name (positional, `show` only)'),
        format: formatField,
      },
    },
    output: { type: 'object' },
  },
  {
    name: 'lore',
    category: 'read',
    summary:
      'package-shipped doctrine reader. Subcommands: list (catalogue + frontmatter-aware filters), show <name> (full markdown body). Reads <packageRoot>/lore/principles/*.md and <packageRoot>/lore/traps/*.md; no per-content_root tier. Lets agents touch doctrine from inside the substrate without needing to know the lore/ layout.',
    input: {
      type: 'object',
      properties: {
        subcommand: {
          type: 'string',
          enum: ['list', 'show'],
        },
        name: strOpt('lore entry name (positional, `show` only); filename without `.md` (e.g. `11-ai-first-human-as-projection`, `trap_doc_coverage_drift_post_ship`)'),
        type: {
          type: 'string',
          enum: ['principle', 'trap'],
          description: "`list` filter — narrow to one kind of entry.",
        },
        'applies-to': strOpt(
          "`list` filter for principles — match `applies_to:` frontmatter (e.g. `swarm`). Entries without an explicit `applies_to` are treated as universal (`all`) and surface regardless of the filter value.",
        ),
        'relevant-until': {
          type: 'string',
          enum: ['current', 'expired', 'indefinite'],
          description:
            "`list` filter for traps — `current` keeps indefinite + future-dated, `expired` keeps past-dated, `indefinite` keeps only literally `indefinite`.",
        },
        format: formatField,
      },
    },
    output: { type: 'object' },
  },
  {
    name: 'rom',
    category: 'read',
    summary:
      'validate a v1 RomPlugin report envelope (docs/design/rom-plugin.md). ' +
      'Subcommand: verify <file|->. Beyond shape, it checks the invariants ' +
      'where the envelope restates a fact twice and the copies can drift: ' +
      'engine.names.length === engine.windows, capabilities.declared === ' +
      'engine.windows, capabilities.used === used_names.length, and every ' +
      'used window NAME present in engine.names (the real `declared ⊇ used` — ' +
      'comparing counts alone would accept a run that touched windows the ' +
      'engine never offered). Read-only: guild-cli owns the contract, not an ' +
      'engine, and this verb records nothing on a wave — where a verified ' +
      'envelope lands is still open by design.',
    input: {
      type: 'object',
      properties: {
        subcommand: {
          type: 'string',
          enum: ['verify'],
        },
        source: strOpt(
          'path to the envelope (positional), or `-` to read stdin. Accepts a bare JSON document, or a run log in which one line carries the JSON object (the first `{` on the line begins it) — no engine-specific prefix is assumed.',
        ),
        format: formatField,
      },
      required: ['subcommand', 'source'],
    },
    output: { type: 'object' },
  },
  {
    name: 'approve',
    category: 'write',
    summary:
      'transition pending → approved. Self-approve (by === request.from) ' +
      'is gated by `features.self_approve` { allowed | warn | forbidden } ' +
      '(#233). Profile defaults: warn under standard (notice + pass), ' +
      'forbidden under swarm (exit 1 + actionable error). fast-track is ' +
      'unaffected — use it for legitimate single-step self-flow.',
    input: {
      type: 'object',
      properties: {
        id: idStr,
        by: strOpt('approver (defaults to $GUILD_ACTOR)'),
        note: textField(),
        format: formatField,
        'dry-run': dryRunField,
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
        reason: textField('alias for --note'),
        note: textField('closure note; falls back to positional arg'),
        format: formatField,
        'dry-run': dryRunField,
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
      properties: {
        id: idStr,
        by: str,
        note: textField(),
        cwd: {
          type: 'string',
          description:
            'filesystem cwd at which this execute is issued; defaults to process.cwd(). Stamped on the status_log entry as executing_at_cwd, and used by the worktree-isolation check (issue #231) when the request was created with requires_worktree_isolation=true. Same-cwd peer in `executing` → refused.',
        },
        format: formatField,
        'dry-run': dryRunField,
      },
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
      properties: {
        id: idStr,
        by: str,
        note: textField(),
        cliff: {
          type: 'string',
          description:
            'Forward-pointing hint for whoever picks up after this completion: ' +
            '"next agent should...". Sibling of --note (which captures what ' +
            'just happened). Lineage: borrows agora\'s cliff/invitation ' +
            'semantic and ports the forward half. Optional; absence is ' +
            'the common case. v1 scope: completed-only — fail/deny carry ' +
            'forward intent in their reasons already. Stored on the ' +
            'terminal status_log entry; projected to the top-level ' +
            '`cliff` field on the JSON envelope. Surfaced by `gate boot` ' +
            'under `past_cliffs` for the authoring / executing actor on ' +
            'subsequent sessions (Zeigarnik continuity).',
        },
        format: formatField,
        'dry-run': dryRunField,
      },
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
      properties: {
        id: idStr,
        by: str,
        reason: textField(),
        note: textField(),
        format: formatField,
        'dry-run': dryRunField,
      },
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
        // #228 sub-task 1: --note is the canonical comment flag (parity
        // with approve/deny/execute/complete/fail/fast-track). --comment
        // is preserved as a deprecated alias. Both shapes appear here so
        // the schema/handler drift detector accepts either, and MCP
        // wirings see both options surfaced.
        note: strOpt('review body; "-" for STDIN (canonical, parity with the other write verbs)'),
        comment: strOpt('DEPRECATED alias of --note; kept for back-compat. Pass only one.'),
        format: formatField,
        'dry-run': dryRunField,
      },
      required: ['id', 'by', 'lense', 'verdict'],
    },
    output: writeResponseSchema,
  },
  {
    name: 'claim',
    category: 'write',
    summary:
      'stake a cross-session claim on a pending or approved request (issue #226 phase 1). ' +
      'Same-actor re-claim is a no-op; conflicting claim by a different actor is refused. ' +
      'Auto-releases when the request reaches a terminal state (completed/failed/denied). ' +
      'Concurrency: each mutation bumps a monotonic mutation_seq mediated by the optimistic-lock; ' +
      'concurrent writes throw RequestVersionConflict and rely on the use-case retry loop.',
    input: {
      type: 'object',
      properties: {
        id: idStr,
        by: strOpt('claimant (defaults to $GUILD_ACTOR)'),
        note: stakeNoteField(
          'optional stake metadata (issue #246). Single short string ' +
            '≤ 80 chars — metadata for THIS stake event, not commentary. ' +
            'Cross-actor discussion belongs in agora plays; the note is ' +
            'for context like "watching the dedup fix" or "blocked on ' +
            'review #233". Same-actor re-claim with a divergent --note ' +
            'overwrites the previous note (single value per claim). ' +
            'Auto-cleared on terminal transitions and on release.',
        ),
        format: formatField,
        'dry-run': dryRunField,
      },
      required: ['id'],
    },
    output: writeResponseSchema,
  },
  {
    name: 'witness',
    category: 'write',
    summary:
      'register as a non-exclusive observer on a pending/approved/executing request (issue #244). ' +
      'Multiple actors may witness simultaneously; coexists with any claim. ' +
      'Same-actor re-witness is a no-op. Auto-resets when the request reaches a terminal state. ' +
      'Concurrency: each mutation bumps a monotonic mutation_seq mediated by the optimistic-lock; ' +
      'concurrent writes throw RequestVersionConflict and rely on the use-case retry loop.',
    input: {
      type: 'object',
      properties: {
        id: idStr,
        by: strOpt('observer (defaults to $GUILD_ACTOR)'),
        note: stakeNoteField(
          'optional per-witness metadata (issue #246). Single short string ' +
            '≤ 80 chars — metadata for THIS stake event, not commentary. ' +
            'Cross-actor discussion belongs in agora plays. Same-actor ' +
            're-witness with a divergent --note overwrites the previous ' +
            'note (single value per witness). Auto-cleared on terminal ' +
            'transitions and on unwitness.',
        ),
        format: formatField,
        'dry-run': dryRunField,
      },
      required: ['id'],
    },
    output: writeResponseSchema,
  },
  {
    name: 'unwitness',
    category: 'write',
    summary:
      "remove the caller's own witness from a request (issue #244). " +
      'Refuses if the caller is not currently a witness, or for any other actor. ' +
      'Concurrency: each mutation bumps a monotonic mutation_seq mediated by the optimistic-lock; ' +
      'concurrent writes throw RequestVersionConflict and rely on the use-case retry loop.',
    input: {
      type: 'object',
      properties: {
        id: idStr,
        by: strOpt('observer to remove (must match caller; defaults to $GUILD_ACTOR)'),
        format: formatField,
        'dry-run': dryRunField,
      },
      required: ['id'],
    },
    output: writeResponseSchema,
  },
  {
    name: 'thank',
    category: 'write',
    summary:
      "record cross-actor appreciation against a request. Sibling of review — no verdict, no state change, no calibration impact. `to` is positional; `--for` names the request id.",
    input: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'positional; the actor being thanked' },
        for: {
          type: 'string',
          description: 'request id (YYYY-MM-DD-NNNN) the thanks pertains to',
        },
        by: str,
        reason: strOpt('optional prose; "-" for STDIN'),
        format: formatField,
        'dry-run': dryRunField,
      },
      required: ['to', 'for'],
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
        executors: strOpt(
          'comma-separated executor list, whitespace-trimmed per entry ' +
            '(issue #230). Defaults to [from] when omitted ' +
            '(self-execute happy path).',
        ),
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
    summary: 'subcommands: add|list|show|note|resolve|defer|start|reopen|promote',
    input: {
      type: 'object',
      properties: {
        subcommand: {
          type: 'string',
          enum: ['add', 'list', 'show', 'note', 'resolve', 'defer', 'start', 'reopen', 'promote'],
          description:
            "`note` appends an annotation without mutating severity/area/text — the issue record is otherwise immutable. " +
            "`show <id>` is the per-id reader, sibling of `gate show <id>` / `agora show <id>` — full body + nested notes.",
        },
        state: {
          type: 'string',
          description:
            "`list` filter. Default: open (worklist semantic). " +
            'Special: `all` returns every state with no filter. ' +
            'Note: status.open_issues counts open+in_progress (triage) — ' +
            'list and status report different scopes by design.',
          enum: ['open', 'in_progress', 'deferred', 'resolved', 'all'],
        },
        format: {
          type: 'string',
          enum: ['text', 'json'],
          description:
            "`list` and `show`. text (default) flattens notes for human reading; " +
            'json keeps notes nested per issue.',
        },
        note: strOpt(
          'optional rationale for `resolve`/`defer`/`start`/`reopen` ' +
            'transitions (#289 hunk 1). Persisted onto the matching ' +
            'state_log entry as `note: <s>`; omitted when absent so ' +
            'pre-#289 records and same-body unstamped writes round-trip ' +
            'byte-identical YAML.',
        ),
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
      properties: {
        from: str,
        to: str,
        text: str,
        type: strOpt('optional message kind label (e.g. "handoff", "note") — free-form, surfaced verbatim in inbox'),
      },
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
      properties: {
        from: str,
        text: str,
        type: strOpt('optional message kind label (e.g. "handoff", "note") — free-form, surfaced verbatim in each recipient inbox'),
        'expects-response': {
          type: 'boolean',
          description:
            'opt-in (default false). When true, each recipient inbox entry ' +
            'is stamped expects_response: true; gate boot surfaces unread ' +
            'opt-in broadcasts under suggested_next as ' +
            '`broadcast-pending-response` until the recipient marks the ' +
            'entry read (read = ack proxy). Phase 1 tracks expectation, ' +
            'not resolution.',
        },
      },
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
      properties: {
        // Sub-verb is positional ('mark-read'), modeled here as
        // `subcommand` for parity with `gate doctor` / `gate issues`
        // / `gate templates` schema entries. Without this field, the
        // `summary` claim "mark-read as subcommand" was unbacked by
        // the structured contract — an MCP orchestrator reading the
        // schema would see no way to invoke `inbox mark-read`
        // (trap_help_text_drift_on_new_verb: the registry-of-
        // surfaces drifted past one of the entries).
        subcommand: {
          type: 'string',
          enum: ['mark-read'],
          description:
            'optional sub-verb. `mark-read [N]` marks the Nth-most-' +
            "recent entry (or all when N omitted) as read; absence " +
            'runs the standard list view.',
        },
        for: str,
        unread: { type: 'boolean' },
        format: formatField,
      },
    },
    output: {
      type: 'array',
      description:
        '--format json: array of inbox-entry objects with snake_case ' +
        "keys ({from, to, type, text, at, read, read_at?, read_by?, " +
        'invoked_by?, related?}). Optional fields are omitted when ' +
        'undefined.',
    },
  },
  {
    name: 'doctor',
    category: 'admin',
    summary:
      'read-only content-root health check. Sub-verb `sweep-traps` (#327) ' +
      'retires expired trap memory: --apply quarantines, --revive <name> ' +
      'restores; both write a YAML audit entry to trap-retirement-log.yaml.',
    input: {
      type: 'object',
      properties: {
        // Sub-verb is positional, not a flag — modeled as `subcommand`
        // for parity with `gate issues` / `gate templates` schema entries.
        subcommand: {
          type: 'string',
          enum: ['sweep-traps'],
          description:
            'optional sub-verb. `sweep-traps` retires expired trap memory; ' +
            'absence runs the standard read-only diagnostic.',
        },
        summary: { type: 'boolean' },
        apply: {
          type: 'boolean',
          description:
            '[sweep-traps only] when true, move expired traps to ' +
            '<content_root>/trap-quarantine/ and append an entry to ' +
            'trap-retirement-log.yaml. Without --apply, sweep-traps is a ' +
            'dry-run that lists what would happen.',
        },
        revive: {
          type: 'string',
          description:
            '[sweep-traps only] bare filename of a quarantined trap to ' +
            'restore to <content_root>/lore/traps/. Mutually exclusive ' +
            'with --apply. Records a `revive` event in the audit log.',
        },
        format: formatField,
      },
    },
    output: { type: 'object' },
  },
  {
    name: 'repair',
    category: 'admin',
    summary: 'quarantine malformed records (reads gate doctor json)',
    input: {
      type: 'object',
      properties: {
        apply: { type: 'boolean' },
        'from-doctor': str,
        format: formatField,
      },
    },
    output: { type: 'object' },
  },
  {
    name: 'schema',
    category: 'meta',
    summary: 'this introspection payload',
    input: {
      type: 'object',
      properties: {
        verb: str,
        format: formatField,
        voice: {
          type: 'string',
          description:
            'Voice-flavored description overlay (#345 cluster #5). When set ' +
            "to a loaded voice plugin's `name`, overlays the plugin's " +
            '`schema.verbs.<verb>.summary` / `.input.<flag>` strings onto the ' +
            'doctrinal descriptions before emitting. Augment-only: a field ' +
            'not overridden falls through verbatim. Unknown name → silent ' +
            'miss (no error, no overlay). Mirrors the write-envelope ' +
            '`GUILD_VOICE` semantic but kept per-invocation so a reader can ' +
            'switch voices without exporting an env var.',
        },
      },
    },
    output: { type: 'object' },
  },
  {
    name: 'unresponded',
    category: 'read',
    summary:
      'concern/reject verdicts on the actor\'s authored or pair-made requests with no follow-up record yet. Deliberately coarse follow-up detector (existence-only); the reader walks `gate chain <id>` to verify whether existing references actually address a concern. Perception, not judgement.',
    input: {
      type: 'object',
      properties: {
        for: strOpt('actor to inspect (default: GUILD_ACTOR)'),
        'max-age-days': strOpt('window for concern detection (default: 30)'),
        format: formatField,
      },
    },
    output: {
      type: 'object',
      properties: {
        actor: str,
        max_age_days: { type: 'integer' },
        count: { type: 'integer' },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              request_id: str,
              action: str,
              concerns: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    by: str,
                    lense: str,
                    verdict: { type: 'string', enum: ['concern', 'reject'] },
                    at: str,
                    age_days: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
];

export async function schemaCmd(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, SCHEMA_KNOWN_FLAGS, 'schema');
  const format = parseFormat(args, 'json');
  const verbFilter = optionalOption(args, 'verb');
  // Plugin verbs (#36 Phase 1 step 4) are spliced into the schema
  // payload as siblings of built-ins. They carry `source: 'plugin'`
  // so a consumer can filter on origin without a name lookup. Built-
  // ins always come first — `gate schema --format text` reads
  // top-down, and burying core surface under plugins would push the
  // most-used verbs off-screen on small terminals.
  const pluginVerbs: VerbSchema[] = c.verbPlugins.map((p) => ({
    name: p.name,
    category: p.category,
    summary: p.summary,
    input: p.input,
    output: p.output,
    source: 'plugin',
  }));
  const allVerbs: VerbSchema[] = [...VERBS, ...pluginVerbs];
  const verbs = verbFilter
    ? allVerbs.filter((v) => v.name === verbFilter)
    : allVerbs;
  if (verbFilter && verbs.length === 0) {
    throw new Error(`unknown verb: ${verbFilter}`);
  }
  // --voice <name> overlay (#345 cluster #5). Looks up the named voice
  // plugin and applies its `schema.verbs.<verb>.summary` / `.input.<flag>`
  // overrides onto each VerbSchema. Augment-not-replace: any field not
  // overridden falls through to the doctrinal description held in
  // handlers (principle 08 unchanged). Unknown voice name → no error,
  // no overlay (silent miss, mirroring write-envelope --voice semantics).
  const voiceName = optionalOption(args, 'voice');
  const overlaidVerbs = voiceName
    ? applyVoiceSchemaOverlay(verbs, voiceName, c.voicePlugins)
    : verbs;
  const payload = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    // semver so consumers can pin a major and tolerate additions.
    // Bump the major only for breaking changes to the schema payload
    // itself (not to individual verb schemas).
    version: '0.1.0',
    verbs: overlaidVerbs.map((v) => ({
      name: v.name,
      category: v.category,
      // `source` defaults to 'core' when the VerbSchema entry omits
      // it — the built-in VERBS table never sets it explicitly so a
      // future loader landing 'plugin' is the only signal worth
      // emitting verbatim. Always emitted on the wire so consumers
      // never see undefined and can filter unconditionally. See
      // VerbSchema interface comment for the discrimination contract.
      source: v.source ?? 'core',
      summary: v.summary,
      input: v.input,
      output: v.output,
    })),
  };
  if (format === 'json') {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    const lines: string[] = [];
    for (const v of overlaidVerbs) {
      const req = v.input.required?.join(', ') ?? '';
      // `source` is rendered only for plugin verbs — every built-in
      // verb is `core` and a `[core]` tag on every line would just
      // be noise (voice budget). The plugin marker calls attention
      // to extensions because filtering by it is the typical reason
      // a reader would consult `gate schema --format text`.
      const src = v.source === 'plugin' ? ' [plugin]' : '';
      lines.push(`${v.name} [${v.category}]${src} — ${v.summary}`);
      if (req) lines.push(`  required: ${req}`);
    }
    process.stdout.write(lines.join('\n') + '\n');
  }
  return 0;
}

export { VERBS };

/**
 * Overlay voice-flavored description overrides from the named voice
 * plugin onto the verb schemas (#345 cluster #5).
 *
 * Strict augment-only: a field NOT covered by an override falls
 * through to the doctrinal description verbatim. Voice cannot delete
 * doctrinal prose; it can only paint a flavored layer on top.
 *
 * Unknown voice name → returns the verbs array unchanged (silent
 * miss, mirroring `_meta.voice` semantics on write envelopes).
 *
 * Pure synchronous; no I/O.
 */
function applyVoiceSchemaOverlay(
  verbs: readonly VerbSchema[],
  voiceName: string,
  voicePlugins: ReadonlyArray<import('../../../application/plugin/VoicePlugin.js').VoicePlugin>,
): VerbSchema[] {
  const plugin = voicePlugins.find((p) => p.name === voiceName);
  const overrides = plugin?.schema?.verbs;
  if (!overrides) {
    // Either plugin not loaded or it has no schema section — return
    // the doctrinal verbs unchanged. Mirrors the write-envelope
    // silent-miss contract: unknown voice never errors.
    return verbs.map((v) => v);
  }
  return verbs.map((v) => {
    const ov = overrides[v.name];
    if (!ov) return v;
    let next: VerbSchema = v;
    if (ov.summary !== undefined) {
      next = { ...next, summary: ov.summary };
    }
    if (ov.input !== undefined) {
      // Walk the input schema's properties and replace descriptions
      // where the override map has a matching key. Properties NOT in
      // the override map keep their doctrinal description intact.
      const baseProps = (v.input.properties ?? {}) as Record<string, JsonSchema>;
      const nextProps: Record<string, JsonSchema> = {};
      for (const [key, propSchema] of Object.entries(baseProps)) {
        const newDesc = ov.input[key];
        if (newDesc !== undefined && typeof propSchema === 'object' && propSchema !== null) {
          nextProps[key] = { ...propSchema, description: newDesc };
        } else {
          nextProps[key] = propSchema;
        }
      }
      next = { ...next, input: { ...next.input, properties: nextProps } };
    }
    return next;
  });
}
