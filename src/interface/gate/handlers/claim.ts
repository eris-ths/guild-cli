import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { C, isDryRun, emitDryRunPreview } from './internal.js';
import { emitWriteResponse, parseFormat } from './writeFormat.js';
import { resolveGuildSessionId } from '../../shared/resolveGuildSessionId.js';

// Issue #226 phase 1 — cross-session stake claim.
//
// `gate claim <id> --by <actor>` writes a `(claimed_by, claimed_at)`
// pair into the request record so a *different* concurrent session
// (the substrate-experiment 5 race: two agents independently picking
// up the same id) can read the stake and back off before duplicating
// work. This wave ships claim only; the witness/release verbs the
// follow-up issue is scoped for are intentionally NOT implemented
// here (scope discipline — small surface, easy to evaluate before
// the witness shape is settled).
//
// Design points crystallised in implementation:
//
//   - Re-claim by the same actor is a no-op. We deliberately do NOT
//     stamp a fresh `claimed_at` on re-claim (rationale on Request.claim).
//     The handler still returns ok and the standard write-response
//     payload so a session that lost track of its own state can
//     re-assert without a special branch.
//
//   - State guard lives in the domain (Request.claim throws if state
//     is not pending/approved). The handler doesn't pre-check; the
//     domain message is the user-facing one and we want a single
//     source of truth.
//
//   - Auto-release lives in `Request.transition` for completed/failed/
//     denied. Phase 1 has no explicit release verb. Deferred to #226
//     follow-up alongside witness.
const CLAIM_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'note',
  'dry-run',
  'format',
]);

export async function reqClaim(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, CLAIM_KNOWN_FLAGS, 'claim');
  const id = args.positional[0];
  if (!id) {
    throw new Error('Usage: gate claim <id> --by <m> [--note <text>] [--dry-run]');
  }
  const by = requireOption(args, 'by', '<m>', 'GUILD_ACTOR');
  // Optional stake-note (issue #246). Tight-scope: single short
  // string ≤ 80 chars, sanitized at the domain boundary; empty /
  // whitespace-only collapses to undefined so a bare `--note ""`
  // is a true no-op on the note dimension. Discussion belongs in
  // agora plays — the schema description names this "metadata,
  // not commentary".
  const note = optionalOption(args, 'note');
  // Boot-context session_id (#249 slice 2). Read GUILD_SESSION_ID via
  // the shared resolver — env-only by design (no `.guild-session-id`
  // file: see resolveGuildSessionId.ts header). Absent stays absent
  // on disk.
  const bySession = resolveGuildSessionId();
  if (isDryRun(args)) {
    const { request } = await c.requestUC.claim({
      id,
      by,
      ...(note !== undefined ? { note } : {}),
      ...(bySession !== undefined ? { bySession } : {}),
      dryRun: true,
    });
    // Claim doesn't transition lifecycle state — the verb is orthogonal
    // to pending/approved/etc — so omit `would_transition`. The preview
    // payload carries the prospective claimed_by/at via toRenderJSON.
    emitDryRunPreview({
      verb: 'claim',
      id,
      by,
      after: request,
      format: parseFormat(args),
    });
    return 0;
  }
  const { request, mutated } = await c.requestUC.claim({
    id,
    by,
    ...(note !== undefined ? { note } : {}),
    ...(bySession !== undefined ? { bySession } : {}),
  });
  // Re-claim message is distinct so a caller that re-runs claim (e.g.
  // a session restart) sees that the call was idempotent rather than
  // wondering whether anything changed. The state of the record is
  // identical either way; only the success line differs.
  const message = mutated
    ? `✓ claimed: ${id} by ${by}`
    : `✓ already claimed: ${id} by ${by} (no change)`;
  emitWriteResponse(parseFormat(args), request, message, c.config);
  return 0;
}
