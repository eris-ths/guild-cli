- **`gate complete` (from approved) and `gate deny` (from executing) now
  redirect by verb name**, completing the verb-shape redirect family
  alongside the existing `fail`-from-pending/approved and the
  `execute`-from-pending cases. Scoped (per a dev-substrate agora play) to
  the two transitions with a clean single-verb bridge:
  - `gate complete` on an *approved* request → names `gate execute`
    (start the work first), recovery `{verb:"execute"}`.
  - `gate deny` on an *executing* request → names `gate fail` (deny is the
    *pending* cancel path; once work has started, fail is the cancel),
    recovery `{verb:"fail"}`; the dry-run path redirects identically.
  Deliberately left on the domain's state-name hint: `complete`-on-pending
  (recovery is multi-step approve→execute→complete, no single verb) and
  `deny`-on-approved (no clean cancel verb exists from approved). State
  vocabulary stays in the domain; the verb hint is an interface concern.
