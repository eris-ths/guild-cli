// parseYamlSafe — thin wrapper around YAML.parse that routes
// lexer/parser-level failures through the onMalformed callback
// instead of throwing out of the listAll / listByState / findById
// paths.
//
// Background: `gate doctor` and the other cross-cutting reads rely
// on the invariant that "malformed records surface as DiagnosticFinding
// rather than crashing the process". The hydrate paths honored that
// invariant via onMalformed for domain-level failures, but YAML.parse
// itself could still throw — a file with unparseable YAML syntax
// would take down the whole read. This helper closes that gap.
//
// The returned value is `undefined` (not `null`) on failure so the
// caller can distinguish "parseable YAML that happens to be null"
// from "YAML that did not parse at all". The `yaml parse failed:`
// prefix is matched by DiagnosticReport.classifyMessage which maps
// it to the `yaml_parse_error` DiagnosticKind, and RepairPlan in
// turn routes that kind to quarantine.

import YAML from 'yaml';
import { OnMalformed } from '../../application/ports/OnMalformed.js';

/**
 * Parse YAML text, returning `undefined` on lexer/parser failure
 * after notifying `onMalformed`. Returns the parsed value (including
 * `null` for empty documents) on success.
 *
 * **Contract (important):** callers MUST use a strict `=== undefined`
 * check to distinguish parse failure from a successfully-parsed empty
 * document. A truthiness check (`if (!parsed)`) would conflate the
 * two since `null` is also falsy — and that silent conflation would
 * turn every empty file into a silently-dropped "parse failed" event.
 * The 6 call sites in the Yaml*Repository hydrate paths follow this
 * rule; tests in `tests/infrastructure/parseYamlSafe.test.ts` pin it.
 */
export function parseYamlSafe(
  raw: string,
  source: string,
  onMalformed: OnMalformed,
): unknown {
  try {
    return YAML.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Flatten newlines only, preserving intentional horizontal
    // spacing inside the parser's quoted substrings. A greedy
    // `\s+` → ` ` collapse would also squeeze double-spaces inside
    // quoted tokens like `unexpected 'foo  bar'`, losing information
    // for no benefit — diagnostic readability comes from single-line
    // output, not from space normalization.
    const oneLine = msg.split('\n').join(' ').trim();
    onMalformed(source, `yaml parse failed: ${oneLine}`);
    return undefined;
  }
}
