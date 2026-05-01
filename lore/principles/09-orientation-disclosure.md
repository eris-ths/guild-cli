# Orientation disclosure

**A verb that produces a count, finding, or status about a
content_root must let the operator verify the content_root
identity in surprising cases — and stay quiet otherwise.**

## Statement

The operator's mental model when reading any output from `gate`
is: *"this number / this state applies to **which content_root?**"*
For most invocations the answer is obvious — `cwd === content_root`,
config sits at `cwd/guild.config.yaml`, the answer is "right
here." For some invocations the answer is non-obvious — `gate`
walked up to a parent's `guild.config.yaml` and the operator's
cwd is a subdir of an active guild, or there was no config at all
and `cwd` was silently used as the fallback root. In those cases
the operator's mental model and `gate`'s reality have drifted,
and any number / finding / state the verb emits is no longer
trustworthy without verification.

So: every verb whose output is a count, finding, or status
*about* a content_root has a duty to make the content_root
identity verifiable when the situation is surprising. Disclosure
is conditional, not perpetual — voice budget says we don't burn
a line on the 99% case where the operator is exactly where they
expect to be.

## What "surprising" means here

The trigger has two cases, both detectable at the verb layer:

1. **`cwd !== resolved_content_root`** — operator ran the verb
   from a subdirectory; gate walked up to a parent's config.
   Their writes / reads target the parent.
2. **`config_file === null` and the content_root has data** —
   no `guild.config.yaml` was found; cwd was silently used as
   the implicit content_root. The operator may not realize the
   fallback default exists.

A bigger warning takes precedence (`misconfigured_cwd`: no config
+ no data) — that case has its own diagnostic block. When the
bigger warning fires, the disclosure stays silent: **disclosure
is exactly one surface at a time**.

## Which verbs disclose

A verb owes disclosure when its output is *about* a content_root
and the operator's mental model is load-bearing for trusting
that output:

- **`gate boot`** — orientation surface; status counts apply to
  the content_root the verb just resolved. Discloses (PR #110).
- **`gate doctor`** — produces findings / area totals about a
  content_root. Discloses (this principle).
- **`gate register`** — write surface; the YAML lands somewhere
  specific. Stderr-discloses on success (PR #108).

A verb does *not* owe disclosure when its output is id-scoped
and the content_root identity is incidental:

- **`gate show <id>`** — the id IS the resolution; the operator
  already trusts that the right record came back because they
  named it.
- **`gate whoami`** — actor-scoped; the GUILD_ACTOR env is the
  resolution.

Other verbs (status, board, list, voices, tail, chain, suggest,
schema) inherit the test case-by-case as the dogfood surfaces
the gap. The default for new verbs: if the operator's mental
model could plausibly disagree with the resolved content_root,
disclose conditionally.

## Phrasing

One canonical line shape, used identically across verbs so the
operator recognises the orientation cue without re-reading:

```
content root: <abs> (config: <abs>/guild.config.yaml)
content root: <abs> (config: none — cwd used as fallback root)
```

The `(config: ...)` segment matches `gate register`'s success
notice (PR #108) verbatim. Same shape, same parens, same em-dash.

## Why this is a separate principle

Principle 03 (legibility costs) says the tool labels what's been
silenced. This principle is a corollary specific to the
content_root identity question — the identity isn't silenced per
se, but it's invisible by default at most surfaces, and the
invisibility becomes a silent failure exactly when the operator
expects one content_root and gets another.

Principle 02 (advisory not directive) says the tool flags edges
without forbidding crossings. Disclosure here is advisory in the
same shape: the verb still runs, still produces output, still
exits zero — it just adds one line so the operator can check the
identity if they want.

Principle 08 (voice as doctrine) says the tool's prose carries
lore. The phrasing convergence — `(config: ...)` reused across
register / boot / doctor — is the voice substrate that makes the
rule learnable from the runtime alone.

## What this principle is NOT

- **Not a mandate to disclose everywhere.** Voice budget is real.
  The conditional emission is the whole design — perpetual
  disclosure would degrade to noise within a session.
- **Not a substitute for `gate doctor`.** Doctor is the deep
  diagnostic; orientation disclosure is one line on a hot
  surface saying "you're acting on this content_root."
- **Not part of the JSON contract for every verb.** Where a
  verb's JSON envelope has natural room for a structured
  boolean (`gate boot.hints.cwd_outside_content_root` does;
  `gate doctor` doesn't yet), the boolean joins the contract.
  Where it doesn't, text-only is acceptable. Asymmetry between
  text and JSON modes is the lesser evil compared to inflating
  every JSON envelope.
