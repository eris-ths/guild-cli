- **Docs and `gate --help` examples now consistently use
  `--executors a[,b,c]` rather than the deprecated `--executor <m>`.**
  The singular flag is still accepted as a back-compat alias (removed
  at v0.7 per #239). Filter-side `gate list --executor <name>` keeps
  its semantically-singular spelling — only the create-side examples
  (request / fast-track / issues promote) have been swept.
