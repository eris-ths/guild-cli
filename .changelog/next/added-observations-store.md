**`observations/` — a fifth substrate kind, for machine-emitted facts.**

`gate rom record <file|->` validates a v1 `RomPlugin` envelope and
appends an Observation; `gate rom list [--for <request-id>]` and
`gate rom show <o-id>` read them back.

Why a separate store rather than a field on the request record: the
four existing kinds all record something a *person* did or decided, and
all are built around transitions. An observation has no author's intent
and no state machine — it is a fact about a run that already happened,
so it cannot be reviewed, superseded, or transitioned. Keeping
measurements in `requests/` (as `fast-track` records, which is what was
happening) forced every projection of "what was decided" to filter them
back out by prefix-matching the action string — a hand-written literal
in the projection layer. With a separate store the machine/human
discriminator is **structural**: everything under
`<paths.observations>/` is machine-origin by construction.

Details worth knowing:

- **Append-only by port shape.** `ObservationRepository` exposes
  `saveNew` and no `save`; with no update path there is nothing to race
  over, so no version/CAS machinery exists either.
- **Envelope keys outside the v1 contract are preserved verbatim.** The
  reference engine emits a `policy` block the contract does not
  describe, carrying `denied` — the windows a ROM *tried* to reach and
  was refused. Storing only the contract fields would discard the most
  security-relevant thing in the report.
- **Re-validated on read.** A record hand-edited on disk into an
  inconsistent state fails when it is read, not merely when it was
  written — "recorded means verified" has to be true for the reader.
- **One-directional link.** An observation names its `subject` request;
  the request does not list its observations, so a completed wave stays
  terminal. Join from this side with `--for`.

Config: `paths.observations` (default `observations/`).
Format: `docs/storage-format.md` § Observation.
