import { buildContainer } from '../shared/container.js';
import { GuildConfig } from '../../infrastructure/config/GuildConfig.js';
import { loadVerbPlugins } from '../../infrastructure/plugin/VerbPluginLoader.js';
import { parseArgs, optionalOption, HelpRequested } from '../shared/parseArgs.js';
import { renderVerbHelp } from '../shared/verbHelp.js';
import { nearestCommand } from '../shared/nearestCommand.js';
import { REQUEST_STATES } from '../../domain/request/RequestState.js';
import { getPackageVersion, isVersionFlag } from '../shared/version.js';
import { emitErrorEnvelope } from '../shared/errorEnvelope.js';
import {
  reqCreate,
  reqList,
  reqShow,
  reqApprove,
  reqDeny,
  reqExecute,
  reqComplete,
  reqFail,
  reqFastTrack,
} from './handlers/request.js';
import { reqReview } from './handlers/review.js';
import { reqClaim } from './handlers/claim.js';
import { reqWitness, reqUnwitness } from './handlers/witness.js';
import { reqThank } from './handlers/thank.js';
import {
  reqVoices,
  reqTail,
  reqWhoami,
  reqChain,
} from './handlers/read.js';
import { issuesCmd } from './handlers/issues.js';
import { boardCmd } from './handlers/board.js';
import { doctorCmd } from './handlers/doctor.js';
import { repairCmd } from './handlers/repair.js';
import { bootCmd } from './handlers/boot.js';
import { schemaCmd } from './handlers/schema.js';
import { resumeCmd } from './handlers/resume.js';
import { reqRegister } from './handlers/register.js';
import {
  msgSend,
  msgBroadcast,
  msgInbox,
} from './handlers/messages.js';
import { statusCmd } from './handlers/status.js';
import { suggestCmd } from './handlers/suggest.js';
import { transcriptCmd } from './handlers/transcript.js';
import { summarizeCmd } from './handlers/summarize.js';
import { whyCmd } from './handlers/why.js';
import { unrespondedCmd } from './handlers/unresponded.js';
import { templatesCmd } from './handlers/templates.js';
import { withEntryLock } from '../../infrastructure/lock/withEntryLock.js';
import { resolveGuildActor } from '../shared/resolveGuildActor.js';
import { READ_VERBS, WRITE_VERBS, LOCK_EXEMPT_VERBS } from './verbs.js';
import type { Container } from '../shared/container.js';
import type { ParsedArgs } from '../shared/parseArgs.js';

// Re-export for test backward-compat (tests/interface/reviewMarkers.test.ts).
// formatReviewMarkers and computeReviewMarkerWidth live in handlers/request.ts
// but tests still import from this module path.
export {
  formatReviewMarkers,
  computeReviewMarkerWidth,
} from './handlers/request.js';

const HELP = `gate — request lifecycle & dialogue CLI

Getting started:
  gate register --name <n> [--category <c>] [--display-name <s>]
                 [--dry-run] [--format json|text]
                       Register yourself (or another member) as an
                       actor. Category defaults to "professional";
                       aliases accepted (pro, prof, member). Host is
                       NOT registerable via CLI — edit
                       guild.config.yaml directly. --dry-run shows
                       the YAML that would be written.

Requests:
  gate request --from <m> --action <a> --reason <r>
                 [--executor <m>] [--target <s>] [--auto-review <m>]
                 [--with <n1>[,<n2>...]] [--depth shallow|standard|deep]
  gate pending [--for <m>]
  gate board [--for <m>] [--format json|text]
                       What's in flight: pending + approved +
                       executing, grouped by state.
  gate list --state <state> [--for <m>] [--from <m>]
                            [--executor <m>] [--auto-review <m>]
  gate show <id> [--format json|text] [--fields k1,k2,...] [--plain]
                       --fields trims the JSON payload to just the
                       requested keys (agent-facing; JSON only).
                       --plain + --fields <single-key> emits just
                       the value (no JSON quotes) for shell combos:
                         state=$(gate show $id --fields state --plain)
                         [ "$state" = "pending" ] && gate approve $id
  gate voices <name> [--lense <l>] [--verdict <v>] [--limit <N>]
                     [--format json|text]          (default: json)
  gate tail [N]                                   (default 20)
  gate whoami                                     (needs GUILD_ACTOR)
  gate chain <id>                                 (request or issue;
                                                   forward refs + inbound)
  gate approve <id> --by <m> [--note <s>] [--dry-run]
  gate deny <id> --by <m> [--note <s> | --reason <s> | <reason>] [--dry-run]
  gate execute <id> --by <m> [--note <s>] [--dry-run]
  gate complete <id> --by <m> [--note <s>] [--dry-run]
  gate fail <id> --by <m> [--note <s> | --reason <s> | <reason>] [--dry-run]
  gate review <id> --by <m> --lense <l> --verdict <v>
                   [--comment <s> | --comment - | <comment>] [--dry-run]
  gate claim <id> --by <m> [--dry-run]
                       Stake a cross-session claim on a pending or
                       approved request (issue #226 phase 1). Same-
                       actor re-claim is a no-op; a different actor
                       attempting to claim while one is already held
                       is refused. The claim auto-releases when the
                       request reaches a terminal state (completed /
                       failed / denied).
  gate witness <id> --by <m> [--dry-run]
  gate unwitness <id> --by <m> [--dry-run]
                       Register / remove a non-exclusive observer on
                       a pending / approved / executing request
                       (issue #244). Multiple actors may witness in
                       parallel and witness coexists with any claim.
                       Same-actor re-witness is a no-op; unwitness
                       only removes the caller's own witness (refuses
                       on a foreign actor). Auto-resets to no
                       witnesses when the request reaches a terminal
                       state.
                       --dry-run on any write verb above emits a
                       preview JSON envelope (dry_run/verb/would_
                       transition/preview) without persisting.
  gate thank <to> --for <id> [--by <m>] [--reason <s> | --reason -]
                  [--dry-run]
                       Record cross-actor appreciation against a
                       specific request. Sibling of 'review' — no
                       verdict, no state change, no calibration
                       impact. Reviews track judgement; thanks
                       track gratitude.
  gate fast-track --from <m> --action <a> --reason <r>
                  [--executor <m>] [--auto-review <m>] [--note <s>]
                  [--with <n1>[,<n2>...]]

Issues:
  gate issues add --from <m> --severity <s> --area <a>
                  [--text <s> | --text - | <text>]
  gate issues list [--state <s>] [--format json|text]
                       Default --state is open (worklist semantic).
                       Use --state all to see every state, or pass a
                       specific state. Note: status.open_issues
                       counts open+in_progress (triage), so list and
                       status report different scopes on purpose.
  gate issues resolve|defer|start|reopen <id>
  gate issues note <id> --by <m> [--text <s> | --text - | <text>]
  gate issues promote <id> --from <m> [--executor <m>] [--auto-review <m>]
                                      [--action <a>] [--reason <r>]

Messages:
  gate message --from <m> --to <m> [--text <s> | --text -]
  gate broadcast --from <m> [--text <s> | --text -]
  gate inbox --for <m> [--unread] [--format json|text]
  gate inbox mark-read [N] [--for <m>]

States: pending | approved | executing | completed | failed | denied
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
                       Same pattern as inbox read_by.

Diagnostic / Repair:
  gate doctor [--summary | --format json]
                       Read-only health check over the content root.
                       Exits 1 if any malformed records are detected.
  gate repair [--apply] [--from-doctor <path>] [--format json]
                       Intervention layer paired with doctor. Reads
                       'gate doctor --format json' from stdin (or
                       --from-doctor <file>) and either prints the
                       proposed plan (default --dry-run) or executes
                       it (--apply). Quarantine is the only action;
                       duplicate_id and unknown findings are no-op.
                       Usage:
                         gate doctor --format json | gate repair
                         gate doctor --format json | gate repair --apply

Status:
  gate status [--for <m>] [--format json|text]
                       Agent orientation: pending/approved/executing
                       counts, open issues, unread inbox, last activity.
                       Default output is JSON (agent-first).
  gate boot [--format json|text] [--tail <N>] [--utterances <N>]
                       Single-command session bootstrap for agents.
                       Returns identity + status + tail + your recent
                       utterances + inbox unread as one JSON payload.
                       GUILD_ACTOR optional (global view if unset).
                       Defaults: --tail 5 --utterances 5 (lean for
                       hot-path session start; pass higher N for deeper
                       history).
  gate suggest [--format json|text]
                       Tight-loop sibling of boot: returns ONLY the
                       suggested_next triple (verb/args/reason) or
                       null. Use when you want "what's the one next
                       thing?" without the full orientation payload.
                       Priority ladder is shared with boot, so the
                       two never disagree.
  gate summarize <id> [--format text|json]
                       Compressed view: state, decision, open
                       concerns, review/thank counts. The "30-second
                       read" sibling of transcript.
  gate why <id> [--format text|json]
                       Trace the decision chain: terminal transition,
                       reviews that aligned with the outcome, reviews
                       that contested it. Perception, not judgement.
  gate transcript <id> [--format text|json]
                       Narrative prose render of one request's arc,
                       composed from status_log + reviews. Sibling
                       of 'gate show' (structured) and 'gate voices'
                       (per-actor). JSON mode carries both the
                       narrative and a summary (actors/verdicts/
                       duration_ms) for programmatic consumers.
  gate resume [--format json|text]
                       Reconstruct what the actor was doing when the
                       last session ended. Returns last utterance,
                       last transition, open loops (awaiting/
                       executing/pending review/unreviewed), and a
                       prose restoration note. Requires GUILD_ACTOR.
                       Same-actor continuation only — for a newcomer
                       arriving via handoff, use 'gate boot' to see
                       cross-actor signals (inbox, --with assignments).
  gate unresponded [--for <m>] [--max-age-days <N>] [--format json|text]
                       Read-only surface for concern/reject verdicts on
                       the actor's authored or pair-made requests that
                       have no follow-up record yet. Thin wrapper over
                       UnrespondedConcernsQuery — same detector that
                       drives 'gate resume'. Default actor is
                       GUILD_ACTOR; default window is 30 days. The
                       detector is deliberately coarse (does not infer
                       whether a follow-up actually addresses a
                       concern); 'gate chain <id>' walks the actual
                       references when the reader wants to verify.

Meta:
  gate schema [--verb <name>] [--format json|text]
                       Introspection: JSON Schema for every verb's
                       inputs and outputs. Consumed by LLM tool layers.
  gate --version       Print version and exit
`;

// Mirror of the switch below for typo suggestions. Keeping it adjacent
// to the switch (rather than auto-derived) is an obvious-when-broken
// signal: a new verb forgotten here just loses its did-you-mean entry,
// it doesn't crash anything.
const KNOWN_COMMANDS = [
  'request', 'pending', 'board', 'list', 'show', 'voices', 'tail',
  'whoami', 'register', 'chain', 'approve', 'deny', 'execute',
  'complete', 'fail', 'review', 'claim', 'witness', 'unwitness',
  'thank', 'fast-track', 'issues', 'message',
  'broadcast', 'inbox', 'doctor', 'repair', 'status', 'boot',
  'suggest', 'transcript', 'summarize', 'why', 'resume', 'schema',
  'unresponded',
  'templates',
] as const;

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
  // Verb plugins (#36 Phase 1 step 4). Loaded before buildContainer
  // because dynamic ESM `import()` is async; the container itself
  // stays synchronous so test bootstraps don't need to thread an
  // async pre-pass through their helpers. Built-in command names
  // are reserved — the loader rejects collisions, so a plugin can
  // never shadow a core verb.
  const config = GuildConfig.load();
  const builtInNames = new Set<string>(KNOWN_COMMANDS);
  const verbPluginLoad = await loadVerbPlugins(
    config.verbPluginPaths,
    builtInNames,
  );
  const c = buildContainer({
    verbPlugins: verbPluginLoad.plugins,
    verbPluginErrors: verbPluginLoad.errors,
    verbPluginsLoaded: verbPluginLoad.pluginsLoaded,
  });
  try {
    // #200: <write-verb> --help must not block on the lock. Help is
    // read-only; routing it through withEntryLock would surface
    // lock_busy when another writer holds the lock, even though the
    // dispatch path here only walks to the handler's rejectUnknownFlags
    // which throws HelpRequested before any side effect.
    if (args.options['help'] === true) {
      return await dispatch(cmd, c, args);
    }
    // #196: prefer an explicit placeholder over an empty string so
    // lock metadata / LockBusyError messages remain self-explanatory
    // when GUILD_ACTOR / .guild-actor are absent. Pass-through of
    // --by/--from at the entry layer is intentionally out of scope
    // (deferred follow-up); this is a strictly diagnostic improvement.
    const actor = resolveGuildActor() ?? '(unset)';
    // Augment the verb sets with the loaded plugins so the lock
    // middleware classifies plugin verbs by their declared category
    // rather than falling through to the unknown→write fail-safe.
    // category 'meta' rides with READ (introspection); 'admin' rides
    // with LOCK_EXEMPT (doctor / repair maintenance pattern).
    const readSet = new Set<string>(READ_VERBS);
    const writeSet = new Set<string>(WRITE_VERBS);
    const exemptSet = new Set<string>(LOCK_EXEMPT_VERBS);
    for (const p of c.verbPlugins) {
      if (p.category === 'read' || p.category === 'meta') readSet.add(p.name);
      else if (p.category === 'write') writeSet.add(p.name);
      else if (p.category === 'admin') exemptSet.add(p.name);
    }
    return await withEntryLock(
      c.config,
      'gate',
      cmd,
      { READ_VERBS: readSet, WRITE_VERBS: writeSet, LOCK_EXEMPT_VERBS: exemptSet },
      actor,
      () => dispatch(cmd, c, args),
    );
  } catch (e) {
    if (e instanceof HelpRequested) {
      renderVerbHelp('gate', e);
      return 0;
    }
    const fmt = args.options['format'];
    emitErrorEnvelope(
      e,
      typeof fmt === 'string' ? fmt : undefined,
      c.config.contentRoot,
    );
    return 1;
  }
}

async function dispatch(
  cmd: string,
  c: Container,
  args: ParsedArgs,
): Promise<number> {
  switch (cmd) {
    case 'request':
      return await reqCreate(c, args);
    case 'pending':
      return await reqList(c, 'pending', args, 'pending');
    case 'board':
      return await boardCmd(c, args);
    case 'list': {
      // `gate list` (no --state) defaults to `--state all`: the
      // muscle-memory call returns every request across every state,
      // matching `agora list` / `devil list` / `gate issues list`.
      // Pre-#218 this exited 1 with a hint that disclosed the
      // `--state` enum + the `all` sugar; now the hint lives in
      // `<verb> --help` (PR #163) and the hot-path call "just
      // works." Behaviour change documented under BREAKING (#217).
      //
      // The deliberate default-all is consistent with sibling list
      // verbs across all 4 passages and with `ls`-style muscle
      // memory; agents that want a specific subset still pass
      // `--state pending` (or any other state) and get the same
      // narrow result they did before.
      const state = optionalOption(args, 'state') ?? 'all';
      return await reqList(c, state, args, 'list');
    }
    case 'show':
      return await reqShow(c, args);
    case 'voices':
      return await reqVoices(c, args);
    case 'tail':
      return await reqTail(c, args);
    case 'whoami':
      return await reqWhoami(c, args);
    case 'register':
      return await reqRegister(c, args);
    case 'chain':
      return await reqChain(c, args);
    case 'approve':
      return await reqApprove(c, args);
    case 'deny':
      return await reqDeny(c, args);
    case 'execute':
      return await reqExecute(c, args);
    case 'complete':
      return await reqComplete(c, args);
    case 'fail':
      return await reqFail(c, args);
    case 'review':
      return await reqReview(c, args);
    case 'claim':
      return await reqClaim(c, args);
    case 'witness':
      return await reqWitness(c, args);
    case 'unwitness':
      return await reqUnwitness(c, args);
    case 'thank':
      return await reqThank(c, args);
    case 'fast-track':
      return await reqFastTrack(c, args);
    case 'issues':
      return await issuesCmd(c, args);
    case 'message':
      return await msgSend(c, args);
    case 'broadcast':
      return await msgBroadcast(c, args);
    case 'inbox':
      return await msgInbox(c, args);
    case 'doctor':
      return await doctorCmd(c, args);
    case 'repair':
      return await repairCmd(c, args);
    case 'status':
      return await statusCmd(c, args);
    case 'boot':
      return await bootCmd(c, args);
    case 'suggest':
      return await suggestCmd(c, args);
    case 'transcript':
      return await transcriptCmd(c, args);
    case 'summarize':
      return await summarizeCmd(c, args);
    case 'why':
      return await whyCmd(c, args);
    case 'resume':
      return await resumeCmd(c, args);
    case 'schema':
      return await schemaCmd(c, args);
    case 'unresponded':
      return await unrespondedCmd(c, args);
    case 'templates':
      return await templatesCmd(c, args);
    default: {
      // Verb plugin dispatch (#36 Phase 1 step 4). Built-in cases
      // run first (the switch above); plugins are the fall-through
      // step before "unknown command". Built-in name collisions are
      // already filtered out in the loader, so a plugin reaching
      // this point is guaranteed not to shadow core dispatch.
      for (const p of c.verbPlugins) {
        if (p.name === cmd) {
          return await p.run(c, args);
        }
      }
      // The did-you-mean hint searches both core verbs and loaded
      // plugins so a typo against a plugin verb still gets a useful
      // suggestion ("did you mean: gate myverb?").
      const candidates = [
        ...KNOWN_COMMANDS,
        ...c.verbPlugins.map((p) => p.name),
      ];
      const hint = nearestCommand(cmd, candidates);
      const suggest = hint ? `\n  did you mean: gate ${hint}?` : '';
      process.stderr.write(
        `unknown command: ${cmd}${suggest}\n` +
          `  see 'gate --help' for the full command list.\n`,
      );
      return 1;
    }
  }
}

