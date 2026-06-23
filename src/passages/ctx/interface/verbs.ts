// ctx verbs — read/write/exempt classification for entry middleware.
//
// See gate's verbs.ts header for the rule-of-thumb classification.
// Surface: `record` / `supersede` (write — both append a new fact); the
// OKF interop pair `export` (read — writes a bundle outside content_root,
// no substrate mutation) and `import` (write — records facts into
// content_root); and the read-side `list` / `show`. Phase 2 will still add
// fork / chain / status.

export const READ_VERBS: ReadonlySet<string> = new Set(['export', 'list', 'show']);

export const WRITE_VERBS: ReadonlySet<string> = new Set(['record', 'supersede', 'import']);

export const LOCK_EXEMPT_VERBS: ReadonlySet<string> = new Set();
