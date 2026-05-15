- **`gate decisions --limit <N>`** truncates the rendered decision
  list to the most-recent N entries after sort. `totals.entries_counted`
  continues to reflect pre-truncation total so callers can detect
  whether more decisions existed past the cap. Sibling
  `gate voices --limit` already had this; aligning the flag surface
  removes a cross-verb inconsistency.
