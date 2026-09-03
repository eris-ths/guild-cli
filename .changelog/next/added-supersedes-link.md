`--supersedes <id>` on `gate request` / `gate fast-track` — a
forward-only link to an older request this one corrects.

Principle 04 has stated the shape since it was written ("a correction is
a new record that references the old"), and the `ctx` passage has
shipped `ctx supersede` for a while. `gate` never had it, so corrections
lived in `action` prose: measured against a 2213-record content_root,
67 records (3.0%) name an older id in prose that no reader can traverse
mechanically. That is principle 17 — a restatement bound to nothing.

The old record is never mutated; both stay in the ledger. A target that
does not exist is refused at the write boundary, before any id is
allocated, so a bad link never leaves a half-written record behind.

Deliberately absent: an inverse `superseded_by` field (it would mutate
an immutable record) and any taxonomy of correction kinds (`--reason`
carries which of the four shapes applies). `gate show <old-id>` stays
silent about corrections that point at it — closing that costs a full
scan, 0.11s to 0.91s on the measured root, and belongs on `gate chain`.
