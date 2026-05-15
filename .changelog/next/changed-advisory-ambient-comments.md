- **Advisory fields classified ambient-by-design now name that status at
  the declaration site (#344 audit close-out).** Touched 4 fields per
  the 2026-05-15 audit: `Issue.severity`, `Issue.area`,
  `Request.sourceAgoraPlay`, `Request.template` (representing the
  template / templateVersion / gateRequiredAcknowledged trio).
  Each gets a one-paragraph comment naming the audit, its consumer
  (display-only or cold-reader audit), and why no further consumer
  is needed. `schema.ts` description for `from-agora` softened — it
  previously promised `gate chain`-style navigation that did not ship.
