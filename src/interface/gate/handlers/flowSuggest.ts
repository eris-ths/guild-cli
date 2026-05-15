import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { parseFormat } from '../../shared/parseFormat.js';
import { C } from './internal.js';
import {
  suggestFlow,
  FlowSeverity,
  FlowSuggestResult,
} from '../../../application/request/flowSuggest.js';

const FLOW_SUGGEST_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'severity',
  'area',
  'scope',
  'format',
]);

const SEVERITIES: ReadonlySet<string> = new Set(['low', 'med', 'high']);

/**
 * gate flow-suggest --severity <low|med|high> --area <s> [--scope <s>]
 *                    [--format json|text]
 *
 * Advisory verb: maps (severity, area, scope) → a recommended flow
 * (fast-track / direct-pr / full-request) plus a reason and the
 * alternatives the operator can fall back to. Pure read — no
 * substrate writes. The rule engine lives in
 * `application/request/flowSuggest.ts` so a future v2 layer (config
 * override) can wrap it without touching the CLI surface.
 *
 * The reason output uses the same `key=value` shape as the
 * suggested_next.args echo in `gate suggest` so a downstream agent
 * doesn't have to learn a second envelope.
 */
export async function flowSuggestCmd(
  _c: C,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, FLOW_SUGGEST_KNOWN_FLAGS, 'flow-suggest');

  const severityRaw = requireOption(args, 'severity', '<low|med|high>');
  const area = requireOption(args, 'area', '<copy|doc|style|bug|auth|...>');
  const scope = optionalOption(args, 'scope');
  const format = parseFormat(args, 'json');

  if (!SEVERITIES.has(severityRaw)) {
    // The check fires AFTER format validation so a `--format xml` typo
    // still surfaces the format error first (more likely the operator
    // mis-typed the format than the severity). Order matters because
    // both errors are equally cheap to compute; we surface the most
    // actionable first.
    throw new Error(
      `--severity must be one of low|med|high, got: ${severityRaw}`,
    );
  }

  const result: FlowSuggestResult = suggestFlow(
    scope === undefined
      ? { severity: severityRaw as FlowSeverity, area }
      : { severity: severityRaw as FlowSeverity, area, scope },
  );

  if (format === 'json') {
    // Echo back the inputs alongside the recommendation so the call is
    // self-describing — a downstream agent doesn't have to keep the
    // original argv around to interpret the answer. `scope` is omitted
    // when not provided (byte-stable: empty fields stay empty), matching
    // the same omit-rule the YAML persistence layer uses.
    const payload: Record<string, unknown> = {
      recommended: result.recommended,
      reason: result.reason,
      alternatives: result.alternatives,
      inputs: scope
        ? { severity: severityRaw, area, scope }
        : { severity: severityRaw, area },
    };
    process.stdout.write(JSON.stringify(payload) + '\n');
  } else {
    // Text rendering: three short lines (recommended / reason /
    // alternatives) and a one-line stderr advisory footer mirroring
    // `gate suggest`. The footer reminds the reader this is a
    // heuristic, not a directive, at the point they read the answer.
    process.stdout.write(`recommended: ${result.recommended}\n`);
    process.stdout.write(`reason: ${result.reason}\n`);
    const alts =
      result.alternatives.length === 0
        ? '(none)'
        : result.alternatives.join(', ');
    process.stdout.write(`alternatives: ${alts}\n`);
    process.stderr.write('# advisory — override freely\n');
  }
  return 0;
}
