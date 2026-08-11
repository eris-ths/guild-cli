**ROM envelope v1: `policy`, `timeline` and `exit` are now specified.**

The reference engine emitted all three from the start; the contract
described none of them. They were accepted as unknown keys and stored
verbatim in `ObservationBody.extra`, which is why they could be
specified from **recorded runs** rather than from the design document —
the document named only `policy`, and had already been wrong once about
a field it did restate.

All three are optional (`guild-cli` owns the contract and no engine, so
an engine that observes without enforcing conforms). What is refused is
a *present but hollow* block.

The invariant worth the work is `capabilities.used_names ⊆
policy.granted` under `enforced: true`. `used ⊆ declared` was already
checked against `engine.names`; under enforcement the binding surface
is the grant set, which is narrower. An engine reporting a used window
it never granted is reporting that its own enforcement leaked — and the
arithmetic stays consistent throughout, so no count comparison can see
it. `timeline` must be complete or absent: a truncated one is
indistinguishable from a whole one at the reading end.

`gate rom verify` now reports enforcement state, denials and the stop
location, and distinguishes an absent `policy` ("no enforcement claim")
from `enforced: false` ("every declared window was permitted").

Two shape restatements were bound rather than updated, per principle
17. `ROM_CONTRACT_KEYS` moved to the module that owns the contract and
is checked against the keys the parser returns; `romEnvelopeToJSON` is
checked by round-trip. The second guard was written because that
serializer had *already* been dropping the three blocks — they parsed,
they validated, and then they did not reach disk.
