**`gate rom list` no longer reports unreadable records as absence.**

A record that fails hydrate is skipped by design — one corrupt file
must not take down a read — but the skip warned on stderr while stdout
said "no rom observations recorded yet." A reader piping stdout was
told the opposite of the truth.

`rom list` now reports how many files on disk could not be read, and
withholds the emptiness claim when any were. `--format json` carries an
`unreadable` count, so machine readers get the same distinction rather
than a softer one.

This became reachable when `policy` moved from `extra` into the
contract: hydrate re-validates on every read, so a record written while
a block was unspecified can stop being readable the day it is
specified. No such records exist yet — the next block promoted will not
have that luxury.
