import { buildContainer } from '../shared/container.js';
import { parseArgs, optionalOption } from '../shared/parseArgs.js';
import { DomainError } from '../../domain/shared/DomainError.js';
import { REQUEST_STATES } from '../../domain/request/RequestState.js';
import { getPackageVersion, isVersionFlag } from '../shared/version.js';
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
                 [--with <n1>[,<n2>...]]
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
  gate issues list [--state <s>]
  gate issues resolve|defer|start|reopen <id>
  gate issues note <id> --by <m> [--text <s> | --text - | <text>]
  gate issues promote <id> --from <m> [--executor <m>] [--auto-review <m>]
                                      [--action <a>] [--reason <r>]

Messages:
  gate message --from <m> --to <m> [--text <s> | --text -]
  gate broadcast --from <m> [--text <s> | --text -]
  gate inbox --for <m> [--unread]
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
  gate suggest [--format json|text]
                       Tight-loop sibling of boot: returns ONLY the
                       suggested_next triple (verb/args/reason) or
                       null. Use when you want "what's the one next
                       thing?" without the full orientation payload.
                       Priority ladder is shared with boot, so the
                       two never disagree.
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
  'complete', 'fail', 'review', 'thank', 'fast-track', 'issues', 'message',
  'broadcast', 'inbox', 'doctor', 'repair', 'status', 'boot',
  'suggest', 'transcript', 'resume', 'schema',
] as const;

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  const cur = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        cur[j - 1] + 1,
        prev[j]! + 1,
        prev[j - 1]! + cost,
      );
    }
    prev = cur.slice();
  }
  return prev[n]!;
}

function nearestCommand(input: string): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  // Cap distance at 2 so genuinely unrelated typos ("foo") don't draw
  // a confident-but-wrong suggestion ("did you mean: doctor?"). Two
  // edits covers single-letter typos AND transpositions ("requst" /
  // "rqeuest" / "approveee").
  const max = Math.min(2, Math.floor(input.length / 2) + 1);
  for (const cmd of KNOWN_COMMANDS) {
    const d = levenshtein(input.toLowerCase(), cmd);
    if (d < bestDist && d <= max) {
      bestDist = d;
      best = cmd;
    }
  }
  return best;
}

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
      case 'request':
        return await reqCreate(c, args);
      case 'pending':
        return await reqList(c, 'pending', args);
      case 'board':
        return await boardCmd(c, args);
      case 'list': {
        // `gate list` without --state is a common first-try ("show me
        // everything"). Rather than just erroring on the missing flag,
        // spell out the list vs status distinction — the question most
        // first-time users actually have is "which verb do I want?"
        const state = optionalOption(args, 'state');
        if (state === undefined) {
          process.stderr.write(
            `gate list needs --state <s> (${REQUEST_STATES.join(' | ')}).\n` +
              '  For counts across every state:  gate status\n' +
              '  For the contents of one state:  gate list --state <s>\n',
          );
          return 1;
        }
        return await reqList(c, state, args);
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
      case 'resume':
        return await resumeCmd(c, args);
      case 'schema':
        return await schemaCmd(c, args);
      default: {
        const hint = nearestCommand(cmd);
        const suggest = hint ? `\n  did you mean: gate ${hint}?` : '';
        process.stderr.write(
          `unknown command: ${cmd}${suggest}\n` +
            `  see 'gate --help' for the full command list.\n`,
        );
        return 1;
      }
    }
  } catch (e) {
    // The `error:` prefix gives the CLI-universal "this failed" cue;
    // prepending "DomainError:" on top leaked an internal class name
    // into user-facing output without adding information. Keep the
    // field suffix (`(id)`, `(from)`, etc.) — that actually names
    // which flag was bad.
    const msg = e instanceof DomainError
      ? `${e.message}${e.field ? ` (${e.field})` : ''}`
      : e instanceof Error
        ? e.message
        : String(e);
    // When the caller asked for JSON output, mirror the error on
    // stderr as a JSON envelope so a tool layer doesn't have to run
    // two parsers (one on stdout JSON, one on stderr text). The
    // human-readable `error: …` line still goes out too — pipelines
    // that ignore stderr keep working, and humans reading the
    // terminal still get a scannable message at the top.
    if (args.options['format'] === 'json') {
      const payload: Record<string, unknown> = {
        ok: false,
        error: {
          message:
            e instanceof DomainError ? e.message : msg,
        },
      };
      const errObj = payload['error'] as Record<string, unknown>;
      if (e instanceof DomainError && e.field) errObj['field'] = e.field;
      const code = deriveErrorCode(e);
      if (code) errObj['code'] = code;
      process.stderr.write(JSON.stringify(payload) + '\n');
    }
    process.stderr.write(`error: ${msg}\n`);
    return 1;
  }
}

/**
 * Macro-level error classification for the JSON envelope. Patterns
 * match the current set of `DomainError` messages so a tool layer
 * can branch on `code` instead of regex-matching the prose.
 *
 * The codes are intentionally coarse (a 4-way fork covers most retry
 * / escalate decisions): fine-grained differentiation stays in the
 * `message` + `field` pair.
 *
 * Message-pattern derivation rather than a per-throw `code` argument
 * keeps the change surgical — adding a code later at the throw site
 * remains compatible; a call that doesn't yet name one still produces
 * the right classification here.
 */
function deriveErrorCode(e: unknown): string | null {
  if (!(e instanceof Error)) return null;
  const m = e.message;
  if (/\bnot found\b/i.test(m)) return 'not_found';
  if (/\bis already \w+\.?/i.test(m)) return 'already_in_state';
  if (/illegal state transition/i.test(m)) return 'illegal_transition';
  if (e instanceof DomainError) return 'validation_error';
  return null;
}
