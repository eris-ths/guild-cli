// gate --help — tiered renderer (issue #324, axis 2 of solo/swarm
// coexistence).
//
// `gate --help` previously listed every verb in one flat catalog,
// mixing the solo-flow primitives (request/approve/execute/complete)
// with cross-session coordination (claim/witness/wave-status) and
// alpha utilities (transcript/voices/rest/wake/...). For a solo user
// on `profile: standard`, the catalog reads as if half the verbs are
// permanently aspirational. For a swarm user, the coordination verbs
// are buried in the noise.
//
// Tiered model:
//   BASE          — the 14 verbs every operator needs.
//   COORDINATION  — cross-session stake + wave-level visibility (5).
//   EXTRA         — everything else (issues, messages, calibration,
//                   rest/wake/farewell, transcript, templates, ...).
//
// Default surface is profile-driven:
//   profile=standard  → BASE only
//   profile=swarm     → BASE + COORDINATION
//   --all flag        → BASE + COORDINATION + EXTRA (irrespective of
//                       profile)
//
// `gate schema --format json` is unchanged and ALWAYS exhaustive —
// the orchestrator contract (principle 11: AI-first) takes precedence
// over the human-readable tiering here.

import type { GuildProfile } from '../../infrastructure/config/GuildConfig.js';

export type HelpTier = 'base' | 'coordination' | 'extra';

interface VerbEntry {
  readonly tier: HelpTier;
  readonly text: string;
}

interface Section {
  readonly heading: string;
  readonly entries: readonly VerbEntry[];
}

// Verb -> tier mapping. The lists below are authoritative for the
// design lock (issue #324). Adding a new verb without an entry just
// means it never appears in `gate --help`; the dispatch table in
// `index.ts` is the single source of truth for runtime behaviour.
//
// BASE (14): request, approve, execute, complete, fail, review,
//            show, list, tail, boot, register, doctor, fast-track,
//            schema
// COORDINATION (5): claim, witness, unwitness, wave-status,
//                   slice-complete (slice-complete is forthcoming
//                   and intentionally absent from the help body).

const SECTIONS: readonly Section[] = [
  {
    heading: 'Getting started:',
    entries: [
      {
        tier: 'base',
        text:
          '  gate register --name <n> [--category <c>] [--display-name <s>]\n' +
          '                 [--dry-run] [--format json|text]\n' +
          '                       Register yourself (or another member) as an\n' +
          '                       actor. Category defaults to "professional";\n' +
          '                       aliases accepted (pro, prof, member). Host is\n' +
          '                       NOT registerable via CLI — edit\n' +
          '                       guild.config.yaml directly. --dry-run shows\n' +
          '                       the YAML that would be written.',
      },
    ],
  },
  {
    heading: 'Requests:',
    entries: [
      {
        tier: 'base',
        text:
          '  gate request --from <m> --action <a> --reason <r>\n' +
          '                 [--executor <m>] [--target <s>] [--auto-review <m>]\n' +
          '                 [--with <n1>[,<n2>...]] [--depth shallow|standard|deep]',
      },
      {
        tier: 'extra',
        text: '  gate pending [--for <m>]',
      },
      {
        tier: 'extra',
        text:
          '  gate board [--for <m>] [--format json|text]\n' +
          "                       What's in flight: pending + approved +\n" +
          '                       executing, grouped by state.',
      },
      {
        tier: 'base',
        text:
          '  gate list --state <state> [--for <m>] [--from <m>]\n' +
          '                            [--executor <m>] [--auto-review <m>]',
      },
      {
        tier: 'base',
        text:
          '  gate show <id> [--format json|text] [--fields k1,k2,...] [--plain]\n' +
          '                       --fields trims the JSON payload to just the\n' +
          '                       requested keys (agent-facing; JSON only).\n' +
          '                       --plain + --fields <single-key> emits just\n' +
          '                       the value (no JSON quotes) for shell combos:\n' +
          '                         state=$(gate show $id --fields state --plain)\n' +
          '                         [ "$state" = "pending" ] && gate approve $id',
      },
      {
        tier: 'extra',
        text:
          '  gate voices <name> [--lense <l>] [--verdict <v>] [--limit <N>]\n' +
          '                     [--format json|text]          (default: json)',
      },
      {
        tier: 'base',
        text: '  gate tail [N]                                   (default 20)',
      },
      {
        tier: 'extra',
        text: '  gate whoami                                     (needs GUILD_ACTOR)',
      },
      {
        tier: 'extra',
        text:
          '  gate chain <id>                                 (request or issue;\n' +
          '                                                   forward refs + inbound)',
      },
      {
        tier: 'base',
        text: '  gate approve <id> --by <m> [--note <s>] [--dry-run]',
      },
      {
        // BASE — symmetric with the terminal states block: `denied`
        // is listed alongside completed/failed at the bottom of help,
        // but the verb that reaches it was previously --all-only.
        // Cold-session callers searching for "cancel a pending"
        // would hit `gate fail` (illegal transition pending→failed)
        // before discovering deny. Surface it next to approve.
        tier: 'base',
        text:
          '  gate deny <id> --by <m> [--note <s> | --reason <s> | <reason>] [--dry-run]',
      },
      {
        tier: 'base',
        text: '  gate execute <id> --by <m> [--note <s>] [--dry-run]',
      },
      {
        tier: 'base',
        text:
          '  gate complete <id> --by <m> [--note <s>] [--cliff <s>] [--dry-run]\n' +
          '                       --cliff "next agent should..." leaves a\n' +
          '                       forward-pointing hint for whoever picks up\n' +
          '                       after this completion. Surfaced under\n' +
          '                       `past_cliffs` in `gate boot` for the\n' +
          '                       authoring / executing actor next session\n' +
          '                       (Zeigarnik continuity). Sibling of --note\n' +
          '                       (what just happened); --cliff is forward-\n' +
          '                       pointing (what next).',
      },
      {
        tier: 'base',
        text:
          '  gate fail <id> --by <m> [--note <s> | --reason <s> | <reason>] [--dry-run]',
      },
      {
        tier: 'base',
        text:
          '  gate review <id> --by <m> --lense <l> --verdict <v>\n' +
          '                   [--comment <s> | --comment - | <comment>] [--dry-run]',
      },
      {
        tier: 'extra',
        text:
          '  gate thank <to> --for <id> [--by <m>] [--reason <s> | --reason -]\n' +
          '                  [--dry-run]\n' +
          '                       Record cross-actor appreciation against a\n' +
          "                       specific request. Sibling of 'review' — no\n" +
          '                       verdict, no state change, no calibration\n' +
          '                       impact. Reviews track judgement; thanks\n' +
          '                       track gratitude.',
      },
      {
        tier: 'base',
        text:
          '  gate fast-track --from <m> --action <a> --reason <r>\n' +
          '                  [--executor <m>] [--auto-review <m>] [--note <s>]\n' +
          '                  [--with <n1>[,<n2>...]]',
      },
    ],
  },
  {
    heading: 'Coordination:',
    entries: [
      {
        tier: 'coordination',
        text:
          '  gate claim <id> --by <m> [--dry-run]\n' +
          '                       Stake a cross-session claim on a pending or\n' +
          '                       approved request (issue #226 phase 1). Same-\n' +
          '                       actor re-claim is a no-op; a different actor\n' +
          '                       attempting to claim while one is already held\n' +
          '                       is refused. The claim auto-releases when the\n' +
          '                       request reaches a terminal state (completed /\n' +
          '                       failed / denied).',
      },
      {
        tier: 'coordination',
        text:
          '  gate witness <id> --by <m> [--dry-run]\n' +
          '  gate unwitness <id> --by <m> [--dry-run]\n' +
          '                       Register / remove a non-exclusive observer on\n' +
          '                       a pending / approved / executing request\n' +
          '                       (issue #244). Multiple actors may witness in\n' +
          '                       parallel and witness coexists with any claim.\n' +
          '                       Same-actor re-witness is a no-op; unwitness\n' +
          "                       only removes the caller's own witness (refuses\n" +
          '                       on a foreign actor). Auto-resets to no\n' +
          '                       witnesses when the request reaches a terminal\n' +
          '                       state.\n' +
          '                       --dry-run on any write verb above emits a\n' +
          '                       preview JSON envelope (dry_run/verb/would_\n' +
          '                       transition/preview) without persisting.',
      },
      {
        tier: 'coordination',
        text:
          '  gate wave-status <id> [--format text|json]\n' +
          '                       Roll-up view of a multi-executor wave: per-\n' +
          '                       executor progress, claim/witness occupancy,\n' +
          '                       and aggregate state. Companion to claim /\n' +
          '                       witness for swarm coordination.',
      },
      {
        tier: 'coordination',
        text:
          '  gate review-context <id> [--format text|json]\n' +
          '                       Reviewer-facing bundle for a wave: action /\n' +
          '                       reason / target, executors, depth advisory,\n' +
          '                       recommended lense set by depth, prior reviews.\n' +
          '                       Lets a reviewer agent drive behaviour from\n' +
          '                       substrate state instead of out-of-band prompt\n' +
          '                       content. depth=shallow→[Logic], standard→6\n' +
          '                       lenses, deep→all 10 + memory MCP + state-\n' +
          '                       machine + cross-check. Advisory not directive.',
      },
    ],
  },
  {
    heading: 'Issues:',
    entries: [
      {
        tier: 'extra',
        text:
          '  gate issues add --from <m> --severity <s> --area <a>\n' +
          '                  [--text <s> | --text - | <text>]',
      },
      {
        tier: 'extra',
        text:
          '  gate issues list [--state <s>] [--format json|text]\n' +
          '                       Default --state is open (worklist semantic).\n' +
          '                       Use --state all to see every state, or pass a\n' +
          '                       specific state. Note: status.open_issues\n' +
          '                       counts open+in_progress (triage), so list and\n' +
          '                       status report different scopes on purpose.',
      },
      {
        tier: 'extra',
        text: '  gate issues resolve|defer|start|reopen <id>',
      },
      {
        tier: 'extra',
        text:
          '  gate issues note <id> --by <m> [--text <s> | --text - | <text>]',
      },
      {
        tier: 'extra',
        text:
          '  gate issues promote <id> --from <m> [--executor <m>] [--auto-review <m>]\n' +
          '                                      [--action <a>] [--reason <r>]',
      },
    ],
  },
  {
    heading: 'Messages:',
    entries: [
      {
        tier: 'extra',
        text: '  gate message --from <m> --to <m> [--text <s> | --text -]',
      },
      {
        tier: 'extra',
        text: '  gate broadcast --from <m> [--text <s> | --text -]',
      },
      {
        tier: 'extra',
        text: '  gate inbox --for <m> [--unread] [--format json|text]',
      },
      {
        tier: 'extra',
        text: '  gate inbox mark-read [N] [--for <m>]',
      },
    ],
  },
  {
    heading: 'Diagnostic / Repair:',
    entries: [
      {
        tier: 'base',
        text:
          '  gate doctor [--summary | --format json]\n' +
          '                       Read-only health check over the content root.\n' +
          '                       Exits 1 if any malformed records are detected.',
      },
      {
        tier: 'extra',
        text:
          '  gate doctor sweep-traps [--apply] [--revive <name>] [--format json]\n' +
          '                       Trap-memory retirement (#327). Trap files at\n' +
          '                       <content_root>/lore/traps/*.md may carry a\n' +
          '                       relevant_until: YYYY-MM-DD or "indefinite"\n' +
          '                       frontmatter field. Without --apply, lists which\n' +
          '                       traps would be quarantined (dry-run). With\n' +
          '                       --apply, moves expired traps to\n' +
          '                       <content_root>/trap-quarantine/ and appends an\n' +
          '                       audit entry to\n' +
          '                       <content_root>/trap-retirement-log.yaml.\n' +
          '                       --revive <filename> restores a quarantined\n' +
          '                       trap and records a revive entry. Per principle\n' +
          '                       04 (records outlive writers): never deletes;\n' +
          '                       quarantine is the only retirement shape.',
      },
      {
        tier: 'extra',
        text:
          '  gate repair [--apply] [--from-doctor <path>] [--format json]\n' +
          '                       Intervention layer paired with doctor. Reads\n' +
          "                       'gate doctor --format json' from stdin (or\n" +
          '                       --from-doctor <file>) and either prints the\n' +
          '                       proposed plan (default --dry-run) or executes\n' +
          '                       it (--apply). Quarantine is the only action;\n' +
          '                       duplicate_id and unknown findings are no-op.\n' +
          '                       Usage:\n' +
          '                         gate doctor --format json | gate repair\n' +
          '                         gate doctor --format json | gate repair --apply',
      },
    ],
  },
  {
    heading: 'Status:',
    entries: [
      {
        tier: 'extra',
        text:
          '  gate status [--for <m>] [--format json|text]\n' +
          '                       Agent orientation: pending/approved/executing\n' +
          '                       counts, open issues, unread inbox, last activity.\n' +
          '                       Default output is JSON (agent-first).',
      },
      {
        tier: 'base',
        text:
          '  gate boot [--format json|text] [--tail <N>] [--utterances <N>]\n' +
          '            [--since <ISO-ts> | --since-last-mine] [--session-id <id>]\n' +
          '                       Single-command session bootstrap for agents.\n' +
          '                       Returns identity + status + tail + your recent\n' +
          '                       utterances + inbox unread as one JSON payload.\n' +
          '                       GUILD_ACTOR optional (global view if unset).\n' +
          '                       Defaults: --tail 5 --utterances 5 (lean for\n' +
          '                       hot-path session start; pass higher N for deeper\n' +
          '                       history).\n' +
          '                       --since <ISO-ts> trims tail / your_recent /\n' +
          '                       inbox_unread to entries strictly newer than the\n' +
          '                       cutoff (lexicographic). Token-cost lever for\n' +
          '                       long sessions: pass the previous boot\'s\n' +
          '                       `last_activity` to get only what changed.\n' +
          '                       --since-last-mine is sugar: resolves to your\n' +
          '                       last authored write internally. Requires\n' +
          '                       GUILD_ACTOR. Mutually exclusive with --since.\n' +
          '                       `status.inbox_unread` stays truthful (full\n' +
          '                       count); only the surfaced entries are filtered.',
      },
      {
        tier: 'base',
        text:
          '  gate voice [<name> | off] [--format json|text]\n' +
          '                       Mode-switch for the voice plugin layer.\n' +
          '                       Bare `gate voice` shows the active voice +\n' +
          '                       which layer resolved it. `gate voice <name>`\n' +
          '                       writes <content_root>/.guild-voice so the\n' +
          '                       deployment picks up <name> until you change\n' +
          '                       it. `gate voice off` clears the marker.\n' +
          '                       Resolution: --voice flag > GUILD_VOICE env\n' +
          '                       > .guild-voice file > voice.default config.',
      },
      {
        tier: 'base',
        text:
          '  gate next [--confirm] [--format json|text]\n' +
          '                       One-call read-and-dispatch of the top actionable\n' +
          '                       verb. Without --confirm: prints the plan (verb /\n' +
          '                       args / reason) without mutating. With --confirm:\n' +
          '                       dispatches the verb via subprocess and returns\n' +
          '                       its exit code. Auto-dispatches only verbs that\n' +
          '                       need only --by (complete / execute / approve /\n' +
          '                       show); verbs needing extra args (review / deny /\n' +
          '                       fail) refuse and prompt for manual invocation.\n' +
          '                       Agent loop: `while gate next --confirm; do :; done`\n' +
          '                       drains the actionable ladder one verb at a time.\n' +
          '                       Exit 2 = nothing actionable; the loop terminates.',
      },
      {
        tier: 'extra',
        text:
          '  gate flow-suggest --severity <low|med|high> --area <s> [--scope <s>]\n' +
          '                    [--format json|text]\n' +
          '                       Advisory: maps (severity, area, [scope]) → a\n' +
          '                       recommended flow (fast-track / direct-pr /\n' +
          '                       full-request) plus reason and alternatives. Pure\n' +
          '                       read — no substrate writes. Heuristic, not a\n' +
          '                       directive; the reason field is the load-bearing\n' +
          '                       output (override when judgement differs).',
      },
      {
        tier: 'extra',
        text:
          '  gate suggest [--format json|text]\n' +
          '                       Tight-loop sibling of boot: returns ONLY the\n' +
          '                       suggested_next triple (verb/args/reason) or\n' +
          '                       null. Use when you want "what\'s the one next\n' +
          '                       thing?" without the full orientation payload.\n' +
          '                       Priority ladder is shared with boot, so the\n' +
          '                       two never disagree.',
      },
      {
        tier: 'extra',
        text:
          '  gate summarize <id> [--format text|json]\n' +
          '                       Compressed view: state, decision, open\n' +
          '                       concerns, review/thank counts. The "30-second\n' +
          '                       read" sibling of transcript.',
      },
      {
        tier: 'extra',
        text:
          '  gate why <id> [--format text|json]\n' +
          '                       Trace the decision chain: terminal transition,\n' +
          '                       reviews that aligned with the outcome, reviews\n' +
          '                       that contested it. Perception, not judgement.',
      },
      {
        tier: 'extra',
        text:
          '  gate transcript <id> [--format text|json]\n' +
          "                       Narrative prose render of one request's arc,\n" +
          '                       composed from status_log + reviews. Sibling\n' +
          "                       of 'gate show' (structured) and 'gate voices'\n" +
          '                       (per-actor). JSON mode carries both the\n' +
          '                       narrative and a summary (actors/verdicts/\n' +
          '                       duration_ms) for programmatic consumers.',
      },
      {
        tier: 'extra',
        text:
          '  gate resume [--with-doctor [--auto-repair]] [--format json|text]\n' +
          '                       Reconstruct what the actor was doing when the\n' +
          '                       last session ended. Returns last utterance,\n' +
          '                       last transition, open loops (awaiting/\n' +
          '                       executing/pending review/unreviewed), and a\n' +
          '                       prose restoration note. Requires GUILD_ACTOR.\n' +
          '                       Same-actor continuation only — for a newcomer\n' +
          "                       arriving via handoff, use 'gate boot' to see\n" +
          '                       cross-actor signals (inbox, --with assignments).\n' +
          '                       --with-doctor folds a gate doctor summary\n' +
          '                       into the payload (substrate health at session\n' +
          '                       re-entry); --auto-repair (requires --with-\n' +
          '                       doctor) processes quarantineable findings\n' +
          '                       inline via gate repair.',
      },
      {
        tier: 'extra',
        text:
          '  gate unresponded [--for <m>] [--max-age-days <N>] [--format json|text]\n' +
          "                       Read-only surface for concern/reject verdicts on\n" +
          "                       the actor's authored or pair-made requests that\n" +
          '                       have no follow-up record yet. Thin wrapper over\n' +
          '                       UnrespondedConcernsQuery — same detector that\n' +
          "                       drives 'gate resume'. Default actor is\n" +
          '                       GUILD_ACTOR; default window is 30 days. The\n' +
          '                       detector is deliberately coarse (does not infer\n' +
          '                       whether a follow-up actually addresses a\n' +
          "                       concern); 'gate chain <id>' walks the actual\n" +
          '                       references when the reader wants to verify.',
      },
    ],
  },
  {
    heading: 'Calibration:',
    entries: [
      {
        tier: 'extra',
        text:
          '  gate lense-stats [--for <m>] [--since <duration>] [--format json|text]\n' +
          '                       Count review entries per lense in the window.\n' +
          '                       Highlights the most-frequent and least-frequent\n' +
          '                       lense so a reader can spot bias ("I keep hitting\n' +
          '                       auth-access; have I run devil or composition\n' +
          '                       lately?"). Sources: gate `review` records +\n' +
          '                       devil-passage entries. Duration: <int><s|m|h|d>\n' +
          '                       (default 7d). Read-only.',
      },
      {
        tier: 'extra',
        text:
          '  gate decisions [--for <m>] [--since <duration>] [--format json|text]\n' +
          '                       Surface authored state transitions (approve /\n' +
          '                       deny / execute / complete / fail) by an actor\n' +
          '                       within a window. Decision-shaped sibling of\n' +
          '                       voices (review-shaped) and lense-stats (lense-\n' +
          "                       shaped). Defaults --for to GUILD_ACTOR — bare\n" +
          '                       `gate decisions` answers "what did I decide?"\n' +
          '                       Dedupes by (request_id, transition).',
      },
      {
        tier: 'extra',
        text:
          '  gate self-pattern [--for <m>] [--since <duration>] [--format json|text]\n' +
          '                       Behavioral bias surface: decision counts,\n' +
          '                       review verdict ratio (ok/concern/reject), top\n' +
          '                       review lense, approve_rate, ok_rate. Composes\n' +
          '                       from status_log + reviews; no schema change.\n' +
          '                       For the FULL lense breakdown, the verb hints\n' +
          '                       at gate lense-stats rather than duplicating.\n' +
          '                       Defaults --for to GUILD_ACTOR.',
      },
    ],
  },
  {
    heading: 'Templates:',
    entries: [
      {
        tier: 'extra',
        text:
          '  gate templates list [--format json|text]\n' +
          '  gate templates show <name> [--format json|text]',
      },
      {
        tier: 'extra',
        text:
          '  gate lore list [--type principle|trap] [--applies-to <scope>]\n' +
          '                 [--relevant-until current|expired|indefinite]\n' +
          '                 [--format json|text]\n' +
          '  gate lore show <name> [--format json|text]\n' +
          '                       Package-shipped doctrine reader. Reads\n' +
          '                       lore/principles/*.md and lore/traps/*.md and\n' +
          '                       lets agents browse principles + traps from\n' +
          '                       inside the substrate. <name> is the filename\n' +
          '                       without .md (e.g. 11-ai-first-human-as-projection).',
      },
    ],
  },
  {
    heading: 'Presence:',
    entries: [
      {
        tier: 'extra',
        text:
          '  gate rest --by <m> [--note <s>] [--dry-run]\n' +
          '  gate wake --by <m> [--note <s>] [--dry-run]\n' +
          '  gate farewell --by <m> [--note <s>] [--dry-run]\n' +
          '                       Session presence verbs. rest pauses, wake\n' +
          "                       resumes, farewell marks the actor's exit.",
      },
    ],
  },
  {
    heading: 'Meta:',
    entries: [
      {
        tier: 'base',
        text:
          "  gate schema [--verb <name>] [--voice <name>] [--format json|text]\n" +
          "                       Introspection: JSON Schema for every verb's\n" +
          '                       inputs and outputs. Consumed by LLM tool layers.\n' +
          '                       Output is exhaustive regardless of profile or\n' +
          '                       --all — orchestrators see every verb.\n' +
          '                       --voice <name> overlays a loaded voice\n' +
          "                       plugin's schema overrides (summary +\n" +
          '                       per-flag descriptions) onto the doctrinal\n' +
          "                       descriptions. Augment-only — unmatched fields\n" +
          '                       fall through verbatim. Unknown name → no\n' +
          '                       overlay, no error.',
      },
      {
        tier: 'base',
        text: '  gate --version       Print version and exit',
      },
    ],
  },
];

const HEADER = `gate — request lifecycle & dialogue CLI`;

const FOOTER = `States: pending | approved | executing | completed | failed | denied
Verdicts: ok | concern | reject
Lenses: devil | layer | cognitive | user (configurable via guild.config.yaml)

Values beginning with "--":
  Bare \`--key <value>\` will not consume a value that itself starts
  with "--" (the parser can't tell it from the next flag). Use either
  form below to pass such literals:
    --key=<value>                            # inline, any content
    ... -- <value> [<value>...]              # POSIX end-of-options marker
  Example:
    gate issues note <id> --by eris -- "the --reason - sentinel is cool"

Environment:
  GUILD_ACTOR=<name>   If set, used as the default for --from / --by /
                       --for when those flags are omitted. Explicit flags
                       always win. Intended for interactive shells
                       (export it in your shell profile or direnv).
                       Automations should continue to pass --from / --by
                       explicitly.
                       When GUILD_ACTOR differs from the explicit --by
                       (e.g. an AI agent acting for a human), write
                       verbs record invoked_by=<GUILD_ACTOR> on the
                       status_log entry (or review) and print a
                       one-line delegation notice to stderr. The on-
                       record actor (--by) still wins for attribution;
                       invoked_by preserves the delegation for audits.
                       Same pattern as inbox read_by.`;

export interface RenderHelpOptions {
  readonly profile: GuildProfile;
  readonly all: boolean;
  /**
   * Curated essentials list from the active voice plugin (#345
   * cluster mode-switch follow-up). When provided, `renderHelp`
   * switches to a voice-driven curation: only the entries whose
   * verb names are in `essentials.verbs` render. Tier filtering
   * (profile / `all`) is bypassed — essentials is its own axis,
   * orthogonal to BASE / COORDINATION / EXTRA.
   *
   * Null when no voice or no essentials section — `renderHelp`
   * falls back to the profile-driven tiering.
   */
  readonly essentials?: {
    readonly voiceName: string;
    readonly verbs: readonly string[];
    readonly note?: string;
  } | null;
  /**
   * Render the essentials list as one line per verb instead of the
   * full multi-line entry (#382 dogfood-driven, polish PR-A3).
   * Trade-off: loses per-verb detail but gives a one-screen overview
   * of "the verbs I reach for". Only meaningful under --essentials —
   * a noop on the profile tier surface where multi-line is intended.
   */
  readonly compact?: boolean;
}

function tierVisible(tier: HelpTier, opts: RenderHelpOptions): boolean {
  if (opts.all) return true;
  if (tier === 'base') return true;
  if (tier === 'coordination') return opts.profile === 'swarm';
  return false;
}

function tierBanner(opts: RenderHelpOptions): string {
  if (opts.essentials) {
    const noteSuffix = opts.essentials.note
      ? ` — ${opts.essentials.note}`
      : '';
    return `(showing: ESSENTIALS curated by voice "${opts.essentials.voiceName}"${noteSuffix}; pass --all for the full catalog)`;
  }
  if (opts.all) {
    return '(showing: BASE + COORDINATION + EXTRA — full catalog via --all)';
  }
  if (opts.profile === 'swarm') {
    return '(showing: BASE + COORDINATION — profile=swarm; pass --all for the full catalog)';
  }
  return '(showing: BASE — profile=standard; pass --all for the full catalog)';
}

// First non-trivial word on the first usage line of an entry =
// the verb name. Mirrors the regex used in `visibleVerbs()` so the
// two paths agree on what counts as "the verb of this entry."
const VERB_LINE_RE = /^ {2}gate ([a-z-]+(?:\s+[a-z-]+)?)/;

function entryVerb(text: string): string | null {
  for (const line of text.split('\n')) {
    const m = line.match(VERB_LINE_RE);
    if (m) return m[1]!.split(/\s+/)[0]!;
  }
  return null;
}

function essentialsVisible(text: string, essentials: NonNullable<RenderHelpOptions['essentials']>): boolean {
  const v = entryVerb(text);
  return v !== null && essentials.verbs.includes(v);
}

export function renderHelp(opts: RenderHelpOptions): string {
  const lines: string[] = [];
  lines.push(HEADER);
  lines.push('');
  lines.push(tierBanner(opts));
  lines.push('');
  const wantCompact = opts.essentials !== null && opts.essentials !== undefined && opts.compact === true;
  for (const section of SECTIONS) {
    const visible = opts.essentials
      ? section.entries.filter((e) => essentialsVisible(e.text, opts.essentials!))
      : section.entries.filter((e) => tierVisible(e.tier, opts));
    if (visible.length === 0) continue;
    lines.push(section.heading);
    for (const e of visible) {
      if (wantCompact) {
        // 1-line-per-verb projection: take the first usage line of
        // each entry (the line starting `  gate <verb>`) and emit
        // just that. Multi-line entries collapse to their headline.
        // The full description stays available via `gate schema
        // --verb <name>` — essentials --compact is an overview, not
        // a substitute for the detail.
        const firstUsage = e.text
          .split('\n')
          .find((line) => /^ {2}gate [a-z]/.test(line));
        lines.push(firstUsage ?? e.text);
      } else {
        lines.push(e.text);
      }
    }
    lines.push('');
  }
  lines.push(FOOTER);
  lines.push('');
  return lines.join('\n');
}

// Exposed for the tiered-help test. Returns the set of verb tokens
// (the first non-trivial word on the first usage line of each entry)
// rendered under the given tiering options. Keeping this derivation
// adjacent to renderHelp() rather than re-grepping the rendered text
// in tests keeps the "what verbs appear" contract grounded in the
// section data, not in fragile output formatting.
export function visibleVerbs(opts: RenderHelpOptions): readonly string[] {
  const seen = new Set<string>();
  for (const section of SECTIONS) {
    for (const e of section.entries) {
      if (!tierVisible(e.tier, opts)) continue;
      for (const line of e.text.split('\n')) {
        const m = line.match(/^ {2}gate ([a-z-]+(?:\s+[a-z-]+)?)/);
        if (m) {
          const verb = m[1]!.split(/\s+/)[0]!;
          seen.add(verb);
        }
      }
    }
  }
  return [...seen].sort();
}
