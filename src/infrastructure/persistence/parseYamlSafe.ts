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
//
// Defense-in-depth: prototype-key stripping (issue #154). The
// `yaml` library returns plain Maps/objects with `__proto__` set
// as a literal key (not via the prototype slot), but that guarantee
// is upstream. We add an independent guard here so the safety of
// the hydrate layer doesn't rest on the lib's internal behaviour
// alone. Every parsed object/array passes through `stripPrototypeKeys`
// before returning, walking the tree and dropping `__proto__` /
// `constructor` / `prototype` literal keys at every level. The
// `Object.create(null)` rebuild ensures the returned tree has no
// prototype chain at all — domain restore code reads bracket-indexed
// keys (`obj['action']` etc.) so this is invisible to callers, but
// closes the gap where a future yaml-lib version, a YAML-spec corner
// case (merge keys, anchors, custom tags), or a downstream
// `Object.assign` could reintroduce pollution.

import YAML from 'yaml';
import { OnMalformed } from '../../application/ports/OnMalformed.js';

const DANGEROUS_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/**
 * Recursively rebuild `value` with prototype-poisoning keys removed.
 *
 * - Plain objects → new prototype-less object via `Object.create(null)`.
 *   Dangerous keys are dropped; remaining keys are recursed.
 * - Arrays → new array with each element recursed.
 * - Primitives, null, undefined → returned as-is.
 * - Class instances (Date, Map, etc.) → returned as-is. The yaml lib
 *   returns plain objects/arrays for normal documents, so this branch
 *   is for safety on hostile inputs that shape into other carriers
 *   via custom tags (`!!js/regexp`, etc.) — passing them through
 *   unchanged is correct because they're not the JSON-shaped tree
 *   we walk in hydrate.
 *
 * Why three names: `__proto__` is the historical pollution vector,
 * `constructor` lets an attacker reach `Function` and arbitrary code
 * via `obj.constructor.constructor('...')`, `prototype` rounds out
 * the trio used in defensive guards across the npm ecosystem
 * (see e.g. `lodash._baseSet`, `qs.parse`, `mongoose`).
 */
function stripPrototypeKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripPrototypeKeys);
  // Only recurse into plain objects. Class instances pass through
  // unchanged (see comment above).
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const cleaned = Object.create(null) as Record<string, unknown>;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(k)) continue;
    cleaned[k] = stripPrototypeKeys(v);
  }
  return cleaned;
}

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
 *
 * The returned tree is sanitized against prototype pollution
 * (issue #154 defense-in-depth). See `stripPrototypeKeys` above.
 */
export function parseYamlSafe(
  raw: string,
  source: string,
  onMalformed: OnMalformed,
): unknown {
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
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
  return stripPrototypeKeys(parsed);
}
