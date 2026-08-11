**`gate request --reason -` no longer loses the reason.**

The stdin read was written twice: once while resolving the optional
`--reason` for the `--template` / `--from-agora` paths, and again
inside the plain-request branch. The first drained the stream, the
second returned `""`, and the wave failed as `reason required` with the
author's text already consumed. The failure looked like a missing flag.

`gate fast-track --reason -` reads once and always worked, which is
what let this survive: the two verbs share the flag, the docs and the
wrapper's advice, and only one of them was ever exercised. Both are now
pinned by a test that round-trips the reason through the store.
