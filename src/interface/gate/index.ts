import { buildContainer } from '../shared/container.js';
import { parseArgs, requireOption } from '../shared/parseArgs.js';
import { DomainError } from '../../domain/shared/DomainError.js';
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
import {
  reqVoices,
  reqTail,
  reqWhoami,
  reqChain,
} from './handlers/read.js';
import { issuesCmd } from './handlers/issues.js';
import { doctorCmd } from './handlers/doctor.js';
import { repairCmd } from './handlers/repair.js';
import {
  msgSend,
  msgBroadcast,
  msgInbox,
} from './handlers/messages.js';
import { statusCmd } from './handlers/status.js';

// Re-export for test backward-compat (tests/interface/reviewMarkers.test.ts).
// formatReviewMarkers and computeReviewMarkerWidth live in handlers/request.ts
// but tests still import from this module path.
export {
  formatReviewMarkers,
  computeReviewMarkerWidth,
} from './handlers/request.js';

const HELP = `gate — request lifecycle & dialogue CLI

Requests:
  gate request --from <m> --action <a> --reason <r>
                 [--executor <m>] [--target <s>] [--auto-review <m>]
  gate pending [--for <m>]
  gate list --state <state> [--for <m>] [--from <m>]
                            [--executor <m>] [--auto-review <m>]
  gate show <id> [--format json|text]          (default: json)
  gate voices <name> [--lense <l>] [--verdict <v>] [--limit <N>]
                     [--format json|text]          (default: json)
  gate tail [N]                                   (default 20)
  gate whoami                                     (needs GUILD_ACTOR)
  gate chain <id>                                 (request or issue)
  gate approve <id> --by <m> [--note <s>]
  gate deny <id> --by <m> <reason>
  gate execute <id> --by <m> [--note <s>]
  gate complete <id> --by <m> [--note <s>]
  gate fail <id> --by <m> <reason>
  gate review <id> --by <m> --lense <l> --verdict <v>
                   [--comment <s> | --comment - | <comment>]
  gate fast-track --from <m> --action <a> --reason <r>
                  [--executor <m>] [--auto-review <m>] [--note <s>]

Issues:
  gate issues add --from <m> --severity <s> --area <a> <text>
  gate issues list [--state <s>]
  gate issues resolve|defer|start|reopen <id>
  gate issues promote <id> --from <m> [--executor <m>] [--auto-review <m>]
                                      [--action <a>] [--reason <r>]

Messages:
  gate message --from <m> --to <m> --text <s>
  gate broadcast --from <m> --text <s>
  gate inbox --for <m> [--unread]
  gate inbox mark-read [N] [--for <m>]

States: pending | approved | executing | completed | failed | denied
Verdicts: ok | concern | reject
Lenses: devil | layer | cognitive | user (configurable via guild.config.yaml)

Environment:
  GUILD_ACTOR=<name>   If set, used as the default for --from / --by /
                       --for when those flags are omitted. Explicit flags
                       always win. Intended for interactive shells
                       (export it in your shell profile or direnv).
                       Automations should continue to pass --from / --by
                       explicitly.

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

Meta:
  gate --version       Print version and exit
`;

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
      case 'list': {
        const state = requireOption(args, 'state', 'gate list --state <s>');
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
