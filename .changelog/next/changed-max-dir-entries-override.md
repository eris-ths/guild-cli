- `GUILD_MAX_DIR_ENTRIES` now overrides the per-directory scan cap (default
  1000, ceiling 100000). A long-lived `content_root` outgrows the default
  legitimately — one dogfood instance passed 1096 completed requests — and the
  choice used to be "list blind" or "archive today". Malformed values throw
  rather than falling back to the default, so a typo cannot silently restore
  the truncated listing this cap was already fixed for once. The overflow
  warning now names the effective cap and the env var. OKF bundle import reads
  the same effective value, so import can never be stricter than the store.
