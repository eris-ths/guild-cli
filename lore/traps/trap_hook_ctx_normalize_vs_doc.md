---
relevant_until: indefinite
---

# trap: hook ctx normalize vs. doc drift

**Pattern.** A plugin / hook surface accepts a context object whose
runtime normalization (case-fold, trim, default-fill) is performed by
the host before invoking the plugin — but the schema / hook docs
describe the *raw* shape, not the normalized one.

Plugin authors test against documented field semantics, host runs the
normalized values; the discrepancy hides until a plugin's case-
sensitive comparison or its strict-equality match against a documented
literal silently fails. The hook still runs; the verdict it would have
returned just doesn't fire. Worst kind of silent failure: behaviour
diverges from contract without an error.

The trap is a specific instance of "schema as contract" (principle
10): the schema is not what the host normalizes *to*, it's what the
plugin author reads. Drift between the two erodes the agent-
dispatchable surface.

## Trigger conditions for review

Flag any change to:

- `HookCtx` field shapes / `HookEvent` payloads where the host
  applies a transform before invoking the plugin (lowercase actor
  name, trim path, resolve to absolute) without the schema entry
  documenting the transform explicitly.
- New hook subscription points whose context surface differs from
  the underlying domain object's at-rest field types.
- `gate schema --verb <name>` output that describes a field as
  "actor name" without specifying that the runtime value is always
  lowercase + trimmed (the canonical `MemberName.value` form).

## Promotion history

Surfaced during the PR #243/#244 hook ctx work (claim/witness phase
1+2). Pinned as a trap rather than a principle because the underlying
fix — make the schema describe the *normalized* shape and document
the transform — is a single-cycle ship, not a recurring pattern that
warrants a new principle. Promotion path: if the same drift recurs
on a future hook subscription, this trap graduates to a corollary of
principle 10.
