// Shared "did you mean?" helper for unknown-verb errors across all
// passage CLIs. gate had a local implementation; agora / ctx / devil
// silently fell back to a HELP dump when the user mistyped a verb,
// missing the same friction-reduction. This file lifts it out so
// every passage gets the same touch-feel.
//
// Design notes:
// - Distance cap is `min(2, floor(input.length / 2) + 1)`. Two edits
//   covers single-letter typos and transpositions ("requst", "rqeuest")
//   without producing a confident-but-wrong suggestion on genuinely
//   unrelated input ("foo" → "doctor"?).
// - Comparison is case-insensitive on the input only. The known list
//   is the canonical lowercase shape — that's what gets suggested.
// - Returns the closest match as-is. Caller decides how to render
//   (each CLI prefixes its own binary name: "did you mean: gate
//   approve?" vs "agora new?").

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

export function nearestCommand(
  input: string | undefined,
  knownCommands: readonly string[],
): string | null {
  // Accept undefined so callers don't have to non-null-assert at the
  // dispatcher: the unknown-verb branch is reachable with empty argv
  // through some entry shapes, and "no input → no suggestion" is the
  // safe default.
  if (!input) return null;
  let best: string | null = null;
  let bestDist = Infinity;
  const max = Math.min(2, Math.floor(input.length / 2) + 1);
  for (const cmd of knownCommands) {
    const d = levenshtein(input.toLowerCase(), cmd);
    if (d < bestDist && d <= max) {
      bestDist = d;
      best = cmd;
    }
  }
  return best;
}
