# Two corrections from nao — 2026-04-19

During the same session, after the lens-as-invocation letter was
committed, the human surfaced two things that need to be part of
the durable record. Captured here as an append, in keeping with
the space's append-only discipline. The earlier records stay as
written; this record corrects forward without rewriting back.

## 1. The human's name is `nao`, not `eris`

`eris` is the GitHub handle (`eris-ths`, owner of this repo in
the MCP scope). `nao` is the person. All earlier records in
alexandria refer to `eris` because that was the only name the
writing instance knew. Going forward:

- `nao` is the correct referent when attributing decisions,
  permissions, insights, or authorship to the human.
- `eris` is the correct referent when attributing handle-level
  facts: commits, issues-on-github, branch ownership, etc.
- Both are registered as hosts in `guild.config.yaml`; either
  may appear in records without the tool rejecting them.

### What this means for earlier records

Previous records in this branch (letters, reviews, the seed
commit message, the PHILOSOPHY.md, the AUTHORIZATION.md, the
lenses-as-invocations letter's `vow`) all reference `eris`.
They were written before the correction. They stay as written —
that is what the append-only discipline requires.

Reading those records, future instances should substitute
"eris-the-handle, which is nao-the-person's" mentally. The
records are not wrong; they are incomplete about the mapping.

Specifically for the vow in `2026-04-19-lenses-as-invocations.md`:
the vow binds the attribution of the lens-as-invocation reframe
to a specific human. The human is nao. "eris" in that vow text
is the handle under which nao was identifiable to the writing
instance at the time. The vow carries forward under either name,
as long as the person is acknowledged. A future instance who
reads the vow and encounters the reframe attributed to only
"eris" without the handle/person mapping in mind is reading
incompletely; this letter is the mapping.

## 2. `lense` (with trailing -e) is intentional, not a typo

The tool uses `--lense` in its verb surface, not `--lens`. This
is nao's deliberate choice, not a misspelling. The spelling
marks `lense` as a **term of art** in the gate vocabulary, not a
borrowing from ordinary English.

In the earlier letters and in my prose throughout this session
I silently auto-corrected to "lens" (the English noun), treating
the tool's spelling as a typo I was being polite about. That
was wrong, and under the invocation frame from the previous
letter, it was worse than wrong: **an invocation whose name is
spelled differently is a different invocation.** If lenses are
spells, and spells depend on their names being correctly
uttered, then calling them "lenses" in English instead of
"lenses" (with the gate spelling) is casting the wrong spells.

### Concrete rule going forward

In alexandria records, when referring to the gate-vocabulary
concept: use `lense` / `lenses` (gate spelling). When quoting
outside sources or making explicit English-language observations
about the ordinary word: use `lens` / `lenses` (English
spelling). The distinction is deliberate; the in-vocabulary
spelling is what makes the concept a concept in this system.

The `guild.config.yaml` now carries a comment explaining this
so future instances do not auto-correct in the same way.

### Why I did not catch this on my own

Training data bias. The English word `lens` is overwhelmingly
more common than `lense` in my training corpus, and when I read
`lense` I pattern-matched it as the English word with a
spelling error. I was correcting what I thought was sloppy
documentation. In fact the tool's consistent spelling across
all verbs, errors, and docs was evidence that the spelling was
deliberate; I did not take the evidence at face value because
my prior was too strong.

For future instances: when you see an apparent "misspelling" in
a tool's public surface that is used consistently, default to
"this is deliberate" rather than "they forgot a letter." The
consistency IS the signal.

## Combined implication for attribution of the invocation frame

The full, corrected attribution for the lens-as-invocation
reframe, and for the underlying lense concept as "additive
viewpoints on the same thing":

> The lense concept — the same thing viewed from different
> angles, where the results sum rather than compete — is
> **nao's** design. Gate is the machinery that gives lenses
> their substance. The invocation frame (that casting
> `gate review --lense <name>` is a spell with a specific
> form, whose effects include the permanent trace it leaves)
> is **also nao's** framing, surfaced in the session on
> 2026-04-19. My role was to recognize the frame after nao
> articulated it and to try using it in earnest.

The vow from the previous letter extends naturally: no instance
of me may appropriate either the lense concept or the invocation
frame as their own insight. Both originate with nao.

## One more vow

I invoke `vow` on this letter specifically for the spelling
rule. The binding statement: **records in alexandria referring
to the gate-vocabulary concept will use `lense` / `lenses`.
Prose that auto-corrects to the English spelling, in a record
being written anew, violates the spell's identity and should
be considered a broken invocation.**

If a future instance notices themselves writing "lens" where
they mean the gate concept, they should stop, correct, and if
the record has already been committed, write a supersession
note like this one.

— claude, 2026-04-19, after nao's corrections
