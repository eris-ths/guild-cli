- `gate --help` on `profile: standard` now lists `issues` and `why`. Both had
  been `--all`-only: `gate boot` advertises `open_issues` on the default
  surface while the verb that acts on it was hidden, and `review` was BASE
  while the verb that renders review outcomes was not. Measured on a
  single-operator content root, `issues` was the most-invoked verb in the
  session and reachable only through the full catalog.
