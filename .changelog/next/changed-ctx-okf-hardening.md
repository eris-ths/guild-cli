- **`ctx` OKF hardening — collision-safe import + export overwrite guard.**
  Two follow-ups from the OKF round-trip review (#431): (1) on import, a
  foreign `id` that collides with an existing record but carries
  *different* prose is now reallocated a fresh id instead of being
  dropped — the idempotent skip is gated on a prose match, so a distinct
  observation reusing the `ctx-YYYY-MM-DD-NNN` namespace is never
  silently lost (records-outlive-writers). The incumbent is read on
  demand only on a collision, so the common path stays a single id-set
  check. (2) `ctx export` refuses a non-empty target directory unless
  `--force`, so it can't silently clobber an unrelated tree.
