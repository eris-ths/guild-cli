- **Docs maintenance: audited every README-linked doc for drift and fixed
  the stale spots.** `AGENT.md` claimed the singular `--executor` flag on
  `gate request` was "still accepted as a deprecated alias (removed at
  v0.7)" — but v0.6 already removed it (the runtime rejects `gate request
  --executor` with "unknown flag"); corrected to "removed from `gate
  request` in v0.6 — use `--executors`." Also fixed an inconsistent
  relative link (`docs/storage-format.md` → `./docs/storage-format.md`)
  and, in `docs/verbs.md`, the `--with` actor-validation note that cited
  `--executor` while describing `gate request` (whose flag is
  `--executors`). The rest of the linked set (playbook, swarm,
  eris-playbook, concepts-for-newcomers, POLICY, storage-format,
  SECURITY, CONTRIBUTING, plugins/README, README.ja) audited clean against
  current behavior — including the recent not-found-hint / transition-
  redirect / fresh-start-wording changes, which those docs don't pin
  verbatim. (`gate list --executor` is unchanged — that singular filter
  flag is correct and stays.)
