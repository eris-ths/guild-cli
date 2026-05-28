- **`gate boot` / `gate suggest`: new `suggested_next_reason` field.**
  When `suggested_next` is `null` but the substrate has open
  (`pending` / `approved` / `executing`) requests that don't name the
  caller as executor, the field carries a one-line explanation —
  closing the asteria-dogfood gap where `status.pending.total: 1`
  next to `suggested_next: null` read as a substrate bug for a host
  who approves from `gate list --state pending` rather than through
  the suggest ladder. Field is `null` when silence is genuine. Text
  mode renders the reason inline as `(nothing urgent — <reason>)` /
  `→ (no suggestion — <reason>)`.
- **`gate register --name <n>`: host-collision error front-loads the
  fix.** The "pick a different `--name`" path is now the lead
  recovery hint; "remove from `host_names:`" is parenthetical. Lines
  up with the asteria observation that a first-time user hitting
  `nao` (a default `host_names` reservation) was reading the longer
  guidance first. README `30 seconds` block also picks up a
  one-liner: `<you>` should be distinct from `host_names:` (default
  reservations: `eris`, `nao`).
