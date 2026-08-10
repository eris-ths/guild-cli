- A voice plugin may now omit `verbs`. The loader had required it, contradicting
  the documented contract that all four sections are optional, so a voice that
  only curated `essentials` was rejected. `gate --help --essentials` also
  swallowed that rejection and rendered the plain profile help, leaving no way
  to see the reason short of importing the loader by hand — loader rejections
  are now reported on stderr, naming the file and the cause. Help still renders
  either way: a broken voice degrades the surface, it never blocks it.
