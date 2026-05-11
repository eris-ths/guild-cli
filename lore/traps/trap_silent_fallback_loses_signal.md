---
relevant_until: indefinite
---

# trap: silent fallback loses signal

**Pattern.** A code path catches its own error, falls back to a
default, and continues — but the surface that produced the result
shows no evidence the fallback fired. The output looks authoritative
to the next consumer, who has no way to know it isn't.

Surfaced (combo C3, 2026-05-10 dogfood) at four sites in the
codebase:

- `gate boot` enrichment catches that swallowed transient repository
  errors and returned an under-populated payload as if it were complete.
- `agora new` silently created `./agora/` when no content_root was
  resolvable, leaving the operator pointing at an unintended directory.
- Devil concern2 on PR #105 (2026-04-16) — error path returned the
  pre-error draft as if it were the post-fix shape.
- `formatContentRootDisclosure` originally signalled fallback but
  didn't suggest a recovery path, so a reader saw the disclosure as
  noise instead of a `next:` cue.

## Trigger conditions for review

Flag any new code path that:

- Catches an error inside its own boundary AND returns a non-error
  value to its caller, without recording the catch on a record the
  caller can inspect (warnings array, status_log entry, stderr line
  with `next:`).
- Falls back to a "default" derived from runtime conditions (cwd, env
  var, `null` config) without disclosing the fallback to the caller.
- Returns the same shape on success and recovered-from-error, with no
  discriminator the next consumer can branch on.

The fix shape is `BootPayload.warnings: string[]` (PR #292) — make
the catch record itself as a structured datum the consumer reads,
not as a silently-mutated default.

## Promotion history

Partially shipped: combo C3 instance 2 in PR #292 (boot warnings).
Instance 1 (cwd-fallback `next:` hint) was deferred per single-
observation evidence. The trap stays pinned so a future fallback-path
PR review surfaces the pattern without re-derivation.
