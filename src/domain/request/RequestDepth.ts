import { DomainError } from '../shared/DomainError.js';

/**
 * Reviewer-depth advisory carried on a Request.
 *
 * Surfaced by issue #221 (substrate-experiment 実験 2 sharp edge):
 * substrate enables cheap iteration but has no built-in adjustment
 * for how *deeply* a downstream reviewer (typically the Devil
 * agent) should engage with a given wave. Default is 'standard' —
 * pre-#222 behaviour, what the agent has been doing.
 *
 * The values are an **advisory** to the reviewer (principle 02):
 * the substrate carries the signal, but it does not enforce
 * anything on the reviewer's actual behaviour. Adjusting the
 * agent's prompt to honour the depth lives outside the substrate
 * (operator/agent setup), not in this repo.
 *
 *   - shallow:  1-file / <50 LOC / no architectural change.
 *               Reviewer is invited to point-check the surface
 *               and not grep-walk the rest of the tree.
 *   - standard: current default. Up to 3 review rounds, normal
 *               grep + threading. The pre-#221 behaviour, kept
 *               name-equivalent so no silent change occurs.
 *   - deep:     architectural / cross-cutting / security-bearing
 *               waves where the reviewer is invited to widen
 *               scope to threat model and posture.
 */
export type RequestDepth = 'shallow' | 'standard' | 'deep';

const VALID_DEPTHS: ReadonlySet<RequestDepth> = new Set([
  'shallow',
  'standard',
  'deep',
]);

export function isRequestDepth(raw: unknown): raw is RequestDepth {
  return typeof raw === 'string' && VALID_DEPTHS.has(raw as RequestDepth);
}

export function parseRequestDepth(raw: unknown): RequestDepth {
  if (!isRequestDepth(raw)) {
    throw new DomainError(
      `depth must be one of ${[...VALID_DEPTHS].join(', ')}, got: ${String(raw)}`,
      'depth',
    );
  }
  return raw;
}
