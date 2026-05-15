// Shared `.catch` handler for the five `bin/*.mjs` entry-points
// (gate / guild / agora / devil / ctx).
//
// Why this exists: each `main()` from the dist/ entry has its own
// try/catch around verb dispatch, but `GuildConfig.load()` and other
// pre-dispatch setup throw BEFORE that try block. Without a catch
// at the bin level, those throws surface as raw Node "Unhandled
// promise rejection" stack traces — unprofessional for what is
// usually user error (bad env var, missing config).
//
// Lives in `bin/_lib/` as plain .mjs (not in dist/) so it doesn't
// participate in the dist-missing failure mode. This is the same
// pattern the partial-staleness check uses; see the lead comment
// on each `bin/<passage>.mjs` for the duplication-vs-share
// trade-off.

/**
 * Promise rejection handler for `main(...)`. Detects DomainError-
 * shaped errors (clean user-error message) and renders the rest
 * with a stack trace as suspected internal bugs.
 *
 * @param {string} prefix - one of 'gate' / 'guild' / 'agora' /
 *                          'devil' / 'ctx', used in the
 *                          internal-error preamble.
 * @returns {(err: unknown) => never} - rejection handler
 */
export function handleMainError(prefix) {
  return (err) => {
    // DomainError is identified structurally rather than via
    // `instanceof` so we don't have to import from dist/ at the bin
    // layer (which would re-introduce the dist-missing trap this
    // file was carefully placed outside of). DomainError ships with
    // a `field` property and a string `message`; nothing else
    // in the codebase shares that exact shape.
    const isDomainError =
      err !== null &&
      typeof err === 'object' &&
      'field' in err &&
      typeof err.message === 'string';
    if (isDomainError) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exit(1);
    }
    process.stderr.write(
      `${prefix}: internal error (please file an issue with the stack below)\n` +
        `${err?.stack ?? err}\n`,
    );
    process.exit(1);
  };
}
