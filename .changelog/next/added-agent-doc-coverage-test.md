`tests/docs/agentVerbCoverage.test.ts` — pins AGENT.md against
`gate schema`.

Both `README.md` and `docs/verbs.md` tell readers that AGENT.md carries
every verb, and `docs/verbs.md` is explicitly partial *because* of that
promise. The promise was prose, and prose cannot fail: AGENT.md was
missing four verbs (`next`, `swarm-status`, `lore`, `rom`), three of
them long-standing.

All four are now documented, including a new § ROM reports section, and
the check derives its expectation from the CLI rather than from a
checked-in list.

Direction is one-way on purpose — every schema verb must appear in
AGENT.md, but a `gate foo` string in AGENT.md with no schema entry is
not flagged, since the file legitimately shows composed shell examples.
