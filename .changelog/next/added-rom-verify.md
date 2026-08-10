`gate rom verify <file|->` — validates a v1 `RomPlugin` report envelope
(`docs/design/rom-plugin.md`), which until now existed only as prose.

Beyond shape, it checks the places where the envelope restates a fact
twice and the two copies can drift: `engine.names.length ===
engine.windows`, `capabilities.declared === engine.windows`,
`capabilities.used === used_names.length`, and — the one that matters —
every used window **by name** present in `engine.names`. Comparing only
counts would accept a run that touched windows the engine never
offered, which is the exact claim the envelope exists to make checkable.

Accepts a bare JSON document or a run log carrying the envelope on one
line; no engine-specific prefix is assumed, so the substrate stays
independent of any one engine. Read-only — where a verified envelope
should be *recorded* on a wave is still deliberately open.

Hidden from default help (`extra` tier); present in `gate schema`.
