- **`members/`: identity resolution chain hardened (#407).** Two
  related gaps in the `members/` actor identity boundary, surfaced
  by a first-impression dogfood:
  - An empty (0-byte) or malformed `members/<name>.yaml` no longer
    promotes `<name>` to a registered actor. Previously `exists()`
    was filename-only, so `touch members/ghost.yaml` was enough for
    `gate fast-track --from ghost ...` to slip past `assertActor`
    while `whoami` already classified `ghost` as `unknown` — write
    verbs and the read-side identity surface disagreed. Both
    surfaces now follow the same parse + hydrate contract.
  - The internal `name:` field of `members/<filename>.yaml`, if
    present, must match the filename stem. A divergence (e.g.
    `members/alice.yaml` containing `name: leysia`) is now flagged
    as malformed by `hydrate` and the record is rejected — neither
    `alice` nor `leysia` resolves to member status from such a file.
    Previously yaml.name silently won, letting a write-access
    adversary (or careless operator) promote arbitrary names to
    `member` by editing the yaml internals without renaming the file.
  - `SECURITY.md` "Invariants enforced in code" gains an "Identity
    resolution chain" entry documenting the `GUILD_ACTOR` env /
    filename / yaml.name resolution rules now enforced.
  - Three new tests under
    `tests/infrastructure/hydrateErrorSurface.test.ts` cover the
    empty-file path, the divergence path, and the regression guard
    that properly-registered actors (with or without an explicit
    yaml.name) continue to work transparently.
