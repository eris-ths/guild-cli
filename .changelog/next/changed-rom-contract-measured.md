**The ROM envelope contract has been checked against the running
engine, not only against its source.**

`policy` / `timeline` / `exit` were specified by reading the reference
engine's emitter. They have now been validated against its *output*:
two runs, both harnesses, including a run under enforcement where a
window was refused and the ROM trapped.

The measurement that matters: `ObservationBody.extra` was **empty** for
both records. Every top-level key the engine emits is owned by the
contract — the documented key set and the wire agree, measured rather
than asserted. This document had been wrong about that twice before.

Recorded in `docs/design/rom-plugin.md` § Measured against the running
engine, with the reproduction command and an explicit statement of what
the measurement does *not* show.
