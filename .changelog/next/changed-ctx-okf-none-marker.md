- **`ctx import` tags type-less docs `okf:none`.** OKF requires a
  `type` on every concept; import stays tolerant (a frontmatter-less or
  `type`-empty `.md` still records — its body is the fact) but now tags
  such a doc `okf:none` instead of letting it pass as a plain Fact. A
  stray non-concept file in a bundle (a README, a note) is therefore
  auditable after the fact via `ctx list --tag okf:none`, rather than
  being indistinguishable from a real guild fact. The marker is `none`,
  not `untyped`: a real type literally named "Untyped" slugs to
  `okf:untyped`, so using `untyped` for the missing-type marker would
  collide the two and defeat the audit; `none` is not a plausible OKF
  concept type and stays unambiguous. A document with a usable
  type is unchanged (`Fact` stays tag-clean; other types keep their
  `okf:<type>` provenance tag). Also clarifies, in help and the docs, that
  prose dedup matches on a **trim + whitespace-collapse only — case and
  punctuation are significant** (it catches a markdown re-wrap, not a
  hand-edited copy).
