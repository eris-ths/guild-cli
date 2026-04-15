// Numeric-aware comparison for guild ids of the form
// `YYYY-MM-DD-NNN[N]` (request) or `i-YYYY-MM-DD-NNN[N]` (issue).
//
// Naive lexicographic comparison breaks once the sequence width changes
// (e.g. 999 -> 9999, see PR#12 / i-2026-04-15-0017): "001" sorts after
// "0011" because '0' < '1' character by character. We compare the
// date prefix lexicographically (ISO-8601 sorts correctly as text) and
// the trailing sequence numerically.
//
// Inputs that don't match the expected shape fall back to a stable
// localeCompare so unknown shapes still produce a deterministic order
// rather than throwing. This keeps the comparator safe for use in
// listings that may include legacy or hand-edited records.

const ID_PATTERN = /^(?:i-)?(\d{4}-\d{2}-\d{2})-(\d{3,4})$/;

export function compareSequenceIds(a: string, b: string): number {
  const ma = ID_PATTERN.exec(a);
  const mb = ID_PATTERN.exec(b);
  if (!ma || !mb) return a.localeCompare(b);
  const dateCmp = (ma[1] as string).localeCompare(mb[1] as string);
  if (dateCmp !== 0) return dateCmp;
  return parseInt(ma[2] as string, 10) - parseInt(mb[2] as string, 10);
}
