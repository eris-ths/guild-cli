import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { C, isDryRun, emitDryRunPreview } from './internal.js';
import { emitWriteResponse, parseFormat } from './writeFormat.js';
import { resolveGuildSessionId } from '../../shared/resolveGuildSessionId.js';

// Issue #244 (#226 phase 2) — non-exclusive cross-session observer.
//
// `gate witness <id> --by <actor>` registers the actor as an observer
// without taking the exclusive stake `claim` provides. Unlike claim,
// multiple actors can witness the same request simultaneously, and a
// witness coexists with any claim (by the same actor or a different
// one). Companion verb `unwitness` removes the caller's own witness;
// removing another actor's witness is refused.
//
// Design points:
//
//   - Re-witness by the same actor is a no-op (idempotent). The
//     witness list doubles as a set ordered by first registration —
//     duplicates are not appended.
//
//   - State guard lives in the domain: witness allowed on pending /
//     approved / executing (the live race window — passive observation
//     of in-progress work is legitimate). Terminal states refuse.
//
//   - unwitness has NO state guard so an observer who joined a
//     request which then progressed to terminal can still clean up
//     manually (in practice the auto-reset on terminal already does
//     this, so this matters for races).
//
//   - Auto-reset to [] lives in `Request.transition` for completed/
//     failed/denied — same terminal frontier as claim.

// witness accepts --note for the per-witness stake metadata
// (issue #246). unwitness does NOT — it removes a stake, and a
// note has no anchor when the witness entry is gone.
const WITNESS_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'note',
  'dry-run',
  'format',
]);
const UNWITNESS_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'dry-run',
  'format',
]);

export async function reqWitness(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, WITNESS_KNOWN_FLAGS, 'witness');
  const id = args.positional[0];
  if (!id) {
    throw new Error('Usage: gate witness <id> --by <m> [--note <text>] [--dry-run]');
  }
  const by = requireOption(args, 'by', '<m>', 'GUILD_ACTOR');
  // Optional stake-note (issue #246) — same tight-scope contract as
  // claim's. Domain sanitizes empty / whitespace-only to undefined,
  // so a bare `--note ""` is a true no-op on the note dimension.
  const note = optionalOption(args, 'note');
  // Boot-context session_id (#249 slice 2). Same env-only resolver as
  // claim — see resolveGuildSessionId.ts for the rationale.
  const bySession = resolveGuildSessionId();
  if (isDryRun(args)) {
    const { request } = await c.requestUC.witness({
      id,
      by,
      ...(note !== undefined ? { note } : {}),
      ...(bySession !== undefined ? { bySession } : {}),
      dryRun: true,
    });
    // Witness doesn't transition lifecycle state — orthogonal to
    // pending/approved/executing — so omit `would_transition`.
    emitDryRunPreview({
      verb: 'witness',
      id,
      by,
      after: request,
      format: parseFormat(args),
    });
    return 0;
  }
  const { request, mutated } = await c.requestUC.witness({
    id,
    by,
    ...(note !== undefined ? { note } : {}),
    ...(bySession !== undefined ? { bySession } : {}),
  });
  // Re-witness message is distinct so the caller can tell whether
  // anything landed (idempotent re-run is legitimate; we just want
  // to make the no-op visible).
  const message = mutated
    ? `✓ witnessed: ${id} by ${by}`
    : `✓ already witnessing: ${id} by ${by} (no change)`;
  emitWriteResponse(parseFormat(args), request, message, c.config);
  return 0;
}

export async function reqUnwitness(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, UNWITNESS_KNOWN_FLAGS, 'unwitness');
  const id = args.positional[0];
  if (!id) {
    throw new Error('Usage: gate unwitness <id> --by <m> [--dry-run]');
  }
  const by = requireOption(args, 'by', '<m>', 'GUILD_ACTOR');
  if (isDryRun(args)) {
    const request = await c.requestUC.unwitness({ id, by, dryRun: true });
    emitDryRunPreview({
      verb: 'unwitness',
      id,
      by,
      after: request,
      format: parseFormat(args),
    });
    return 0;
  }
  const request = await c.requestUC.unwitness({ id, by });
  emitWriteResponse(
    parseFormat(args),
    request,
    `✓ unwitnessed: ${id} by ${by}`,
    c.config,
  );
  return 0;
}
