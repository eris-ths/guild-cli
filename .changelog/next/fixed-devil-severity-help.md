**`devil entry --severity` no longer advertises values it rejects.**

The usage line read `<c|h|m|l|info>`: four initials and one full word,
which reads as a literal list and is not one. The parser accepts
`critical|high|medium|low|info`. Found by being rejected while
recording a devil review with `--severity med`.

Fixed by derivation rather than by rewriting the string —
`VALID_SEVERITIES` is exported and the help joins it, so the two cannot
disagree again. The passage's "11 verbs" headline is now derived from
the verb sets for the same reason; that one happened to be correct,
which is exactly why it was worth binding before it stopped being.
