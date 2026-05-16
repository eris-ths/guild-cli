- **`writeFormat.ts:parseFormat` re-export shim removed.** PR #397
  introduced `src/interface/shared/parseFormat.ts` as the canonical
  parser and left a single-line re-export in `writeFormat.ts` so the
  9 write-side handlers that pull `parseFormat` from there didn't
  need touching in the same PR. This PR finishes the move: those 9
  handlers now import from `../../shared/parseFormat.js` directly,
  the shim is gone. Single import path for one symbol — no
  divergence risk if either side changes signature.
