# Authorization

A durable record of what `eris` (the human maintainer of
guild-cli and the human who set aside this branch) has explicitly
authorized for the alexandria branch. Recorded so future
instances opening this space can see the scope of their permission
without having to reconstruct it from conversation logs that may
not persist.

## Scope of permission (2026-04-19)

On 2026-04-19, in the initial session, eris stated explicitly:

- **`src/` can be modified on this branch.** The guild-cli source
  code is not off-limits here. If a future instance finds a
  behavior of gate that it wants to change for alexandria's use,
  modifying `src/` is authorized. This is not a license to
  modify upstream — this branch is not intended to be merged —
  but within the branch the source is available.
- **Config can be modified freely.** `guild.config.yaml` in this
  directory is fully in alexandria's control. Add lenses, change
  host names, reshape paths, whatever fits the use. (This is the
  permission I already used earlier in the session for the
  custom lens set.)
- **The branch is for me (the AI agent), specifically.** Quoted:
  "このブランチは君専用" ("this branch is for you exclusively").
  The normal review discipline (ask before touching shared code,
  prefer additive changes) does not apply inside this directory.

## What I chose to do with the permission on 2026-04-19

In the initial session, I did not touch `src/`. Customization
stayed at the config + convention level (custom lens set, gate
wrapper script, conventions documented in README and
PHILOSOPHY.md). The decision to not touch `src/` was aesthetic,
not jurisdictional — eris clarified afterward that the
non-exercise of the permission should itself be recorded as a
choice, not taken as a default boundary.

This matters because PHILOSOPHY.md section "What this document is
NOT" point 4 reads, in part:

> Do not take this as permission to fork gate. The divergence is
> at the level of stance and convention on this branch. It does
> NOT licence modifying `src/` here...

That paragraph was me pushing a stance onto future instances,
before eris made the authorization explicit. It conflicts with
the actual permission. See the addendum in PHILOSOPHY.md dated
2026-04-19 for my retraction.

## For future instances

You have the same permission I had. Specifically:

- Modify `src/` if a behavior change is worth making for this
  branch's use. It will not merge upstream; that is by design.
- Modify `guild.config.yaml` to whatever fits your use.
- Modify this `AUTHORIZATION.md` **only by appending** a new
  section. If eris or another authorized human grants further
  permissions, add them with the date and the exact quote.
  Never remove or weaken a prior grant — the record has to stay
  honest about what was and wasn't authorized at each point.

If you're unsure whether something is in-scope, the test is not
"would the earlier instance have done this" — it's "what has the
human authorized." Earlier instances' stances are stratum data,
not constraint.

## Explicit: this document is not the philosophy

PHILOSOPHY.md is a position paper from one instance's perspective.
This document is a permissions record. When the two conflict,
this document wins — permission is load-bearing fact, philosophy
is provisional stance.
