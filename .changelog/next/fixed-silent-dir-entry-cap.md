- **Record listings no longer drop the newest records in silence.**
  `MAX_DIR_ENTRIES` (1000) is a memory guard, but four repositories applied
  it with a bare `.slice(0, MAX_DIR_ENTRIES)`. A long-lived content_root
  *does* reach that ceiling — a dogfood instance hit 1006 completed requests
  and `gate list` / `gate tail` began returning exit 0 with a short list.
  Records written seconds earlier were absent with no error, no warning and
  no exit code; `gate show <id>` still returned them, so the writes had
  succeeded and only the listings had gone blind. Worse, it dropped the
  wrong end: ids are date-prefixed and the scan is ordered, so slicing from
  the front discarded the *newest* records — precisely what `tail` exists to
  show and what a session had just written, while a stale 1000-record window
  survived. Listings now go through `capDirEntries`, which keeps the cap,
  takes it from the end so the newest records always survive, preserves
  ascending order for callers, and warns on stderr naming the directory, the
  real entry count and how many older entries were dropped. Affects
  `requests/<state>`, `issues`, `members` and `sessions`. The OKF bundle
  reader already threw on the same condition; this closes the gap where one
  constant was loud in one place and mute in four others.
