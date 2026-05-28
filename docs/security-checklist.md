# Security Checklist for Contributors

> Practical, tool-agnostic rules for changes to `guild-cli`. Designed to be
> consumed by humans, AI assistants, and automated reviewers alike.
>
> Upper threat model lives in [`SECURITY.md`](../SECURITY.md). The 12-lense
> `devil-review` catalog (see `src/passages/devil/README.md`) is the deliberation
> substrate; this document is the day-to-day floor that informs entries on
> those lenses.
>
> Keep changes to this file additive and short. Each item should be something a
> reviewer can verify in the diff without external knowledge.

## How this composes with upstream review tools

`guild-cli` is designed to **compose** with upstream security tooling rather
than replace it. Examples (non-exhaustive, in alphabetical order):

- Anthropic `/ultrareview` and Claude Code security plugins
- `eris-ths/supply-chain-guard` (`scg`) for npm dependency vetting
- Static analysis (Semgrep, CodeQL, ESLint security plugins)
- Human reviewers running through this checklist

Findings from these tools flow into the substrate via
`devil ingest --from <source>`. This checklist gives every reviewer — automated
or human — the same floor of repo-specific rules to apply.

## Trust boundary (recap from SECURITY.md)

- `guild-cli` is a local file-based CLI. It is **not** designed for
  multi-tenant or network exposure. The trust boundary is "anyone with write
  access to `content_root`".
- Concurrency assumption: **one CLI process at a time per `content_root`**.
  Sequential CAS catches the load-then-act-then-write race that re-entering
  callers naturally produce. File locking is out of v0 scope. Parallel waves
  require worktree isolation (`profile: swarm`, see #231).

## TypeScript / Node rules

- Do not pass user input or substrate file contents to `eval`,
  `new Function(...)`, or `vm.runInNewContext`. Values read from substrate are
  untrusted.
- Avoid `child_process.exec` / `execSync`. Prefer
  `spawn(cmd, [args...], { shell: false })` with array-form arguments so shell
  metacharacters cannot inject.
- When merging `JSON.parse` results via `Object.assign` or spread, guard
  against prototype pollution: reject `__proto__` / `constructor` / `prototype`
  keys, or start from `Object.create(null)`.
- Load YAML with the safe default schema of `js-yaml`. Do not enable custom
  types or function tags. Substrate YAML is untrusted.
- File I/O must resolve to an absolute path **inside `content_root`**. Use
  `path.resolve(contentRoot, userInput)` then assert the result starts with
  `contentRoot + path.sep` before any `fs` operation. Run paths through
  `fs.realpath` first so symlinks cannot escape the boundary.

## Substrate write safety (records-outlive-writers)

- Free-text fields exposed by verbs (`gate request --reason`,
  `agora play --note`, `devil ingest --comment`, etc.) end up in a substrate
  that downstream users may commit to a public repository. Do not put secrets
  in those fields. Record intent rather than verbatim quotes of host messages.
- Record writes are append-only or CAS. Do not introduce destructive in-place
  rewrites of existing records; dismissal and cancellation must go through the
  dedicated verbs so the audit trail survives.
- Do not assume invariance between `load → mutate → write`. If a callsite
  needs it, add CAS retry at the caller.

## `devil ingest` input validation

- `devil ingest --from <source>` accepts strict JSON shapes. Reject unknown
  fields, validate enum fields (`severity`, `kind`) against the v0 catalog,
  and constrain path fields to `content_root`.
- Preserve the `source` field as-is on transit. Do not abstract it away — it
  is required for audit ("which upstream tool flagged this").

## npm dependency hygiene

- Vet new dependencies for typosquats, post-install scripts, and known
  compromised versions before adding them. `scg` is the recommended tool but
  any equivalent vetting flow is acceptable.
- Do not introduce `postinstall` / `preinstall` scripts in `package.json`
  unless `SECURITY.md` documents the root cause; this preserves
  `npm ci --ignore-scripts` as a viable CI hardening.
- Keep `dependencies` and `devDependencies` separated so shipped CLI artifacts
  do not pull in dev tooling.

## CLI surface

- After argument parsing in `bin/*.mjs` dispatchers, route every path argument
  through the `content_root` resolution helper. Do not pass raw user paths to
  `fs`.
- Error messages surfaced to the user must not leak full filesystem paths or
  stack traces — CI logs and public substrates inherit them. Show category +
  actionable hint instead.
- Validate `--executor` / `--by` actor names against the `members/` allowlist.
  Do not silently accept unknown actors.

## Test substrate

- Do not place real secrets, real customer names, or real client repository
  identifiers in `tests/fixtures/`. Use generic placeholders.
- Snapshot tests must normalize variable fields (paths, timestamps) to stable
  placeholders (`<CONTENT_ROOT>`, `<TIMESTAMP>`).

## Public artifacts

- Commit messages, PR bodies, issues, discussions, and release notes must not
  reference customer project names, client repository names, or internal
  service code names. Rephrase generically.
- When opening PRs against third-party repositories, translate internal review
  tone (`bug` / `dead` / `broken`) into a contributor tone (`i18n` / `extend` /
  `harden`).
