- **`ctx import` tags type-less docs `okf:untyped`.** OKF requires a
  `type` on every concept; import stays tolerant (a frontmatter-less or
  `type`-empty `.md` still records — its body is the fact) but now tags
  such a doc `okf:untyped` instead of letting it pass as a plain Fact. A
  stray non-concept file in a bundle (a README, a note) is therefore
  auditable after the fact via `ctx list --tag okf:untyped`, rather than
  being indistinguishable from a real guild fact. A document with a usable
  type is unchanged (`Fact` stays tag-clean; other types keep their
  `okf:<type>` provenance tag). Also clarifies, in help and the docs, that
  prose dedup matches on a **trim + whitespace-collapse only — case and
  punctuation are significant** (it catches a markdown re-wrap, not a
  hand-edited copy).
