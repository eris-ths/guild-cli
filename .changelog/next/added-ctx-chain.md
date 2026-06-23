- **`ctx chain <id>` — the second phase-2 ctx verb (read-side).** Shows
  the one-hop neighborhood of a fact so a reader can follow related
  observations without grepping the substrate. It walks four edge kinds
  from a single read: **outbound** (ctx ids the root's prose mentions, each
  resolved to its fact or surfaced as `(referenced but not found)` rather
  than dropped), **inbound** (facts whose prose mentions the root),
  **supersedes** (the fact the root corrects), and **superseded by** (the
  facts that correct the root — a fork shows more than one). One hop only,
  like `gate chain`: to go deeper, run `ctx chain` on a surfaced id. A
  missing root is a recoverable not-found; an isolated fact reports an
  empty neighborhood rather than an error.
- The shared id scanner `extractReferences` (also behind `gate chain`) now
  recognizes the `ctx-YYYY-MM-DD-NNN` id shape as a third kind alongside
  request and issue ids, returned in a new `ctxIds` field. This also fixes
  a latent mis-classification: the leading boundary allowed a hyphen, so a
  `ctx-…` (or `i-…`) id's digits could leak into `requestIds`; capturing
  the prefix keeps the three kinds disjoint. `gate chain` behavior is
  unchanged (it does not surface ctx ids). Remaining phase-2 verbs: `fork`
  / `status`.
