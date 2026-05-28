// Dist-load failure classifier + reporter for the 5 bin entries.
//
// Lives in bin/_lib/ (plain .mjs, never transpiled) for the same reason
// as checkDistFreshness: a helper that itself lived in dist/ would be
// absent precisely when a dist load fails (circular trap). bin/_lib/ ships
// alongside bin/ and is loaded directly, so all 5 entries share it.
//
// It distinguishes three shapes of an `await import(ENTRY_URL)` failure so
// the operator is pointed at the actual fix instead of being misdirected:
//
//   1. Missing third-party dependency (a bare specifier such as `yaml`
//      can't be resolved). node_modules is absent or incomplete — the
//      build is fine. This is the fresh-clone symptom: `tsc` ran, dist/
//      exists, but `npm install` was never run. Node phrases it as
//      `Cannot find package '<name>' imported from <importer>`, and the
//      importer sits under dist/, so a naive `/dist/` test misreads it as
//      a build problem. We therefore check the package miss FIRST and
//      tell the operator to install deps, not rebuild.
//
//   2. Missing/stale compiled tree (a `/dist/` module failed to resolve).
//      dist/ was never built or is partial. `npm install` (which runs the
//      `prepare: tsc` script) or `npm run build` fixes it.
//
//   3. Anything else — not ours. The caller re-throws for the default
//      handler.
//
// If package.json drops `prepare: tsc`, update the build remedy text.

/**
 * Classify an import() failure. Pure — no I/O, no exit — so it can be
 * unit-tested directly. Returns null when the error is not a dist/dep
 * load failure we recognize (caller should re-throw).
 *
 * @param {unknown} err
 * @returns {{ kind: 'dependency', pkg: string }
 *          | { kind: 'dist', transitiveUrl: string }
 *          | null}
 */
export function classifyDistLoadError(err) {
  if (!err || err.code !== 'ERR_MODULE_NOT_FOUND') return null;
  const message = typeof err.message === 'string' ? err.message : '';
  const failedUrl = typeof err.url === 'string' ? err.url : '';

  // Case 1 — bare-specifier package miss. Checked before the /dist/ test
  // because the "imported from" clause names a dist/ importer and would
  // otherwise be misclassified as a stale build.
  const pkg = /Cannot find package '([^']+)'/.exec(message);
  if (pkg) return { kind: 'dependency', pkg: pkg[1] };

  // Case 2 — a /dist/ module couldn't be resolved.
  const fromDist = failedUrl.includes('/dist/') || /\/dist\//.test(message);
  if (fromDist) return { kind: 'dist', transitiveUrl: failedUrl };

  return null;
}

/**
 * Classify, print the matching remedy to stderr, and exit(2). Returns
 * (without exiting) when the error is not ours so the caller can re-throw.
 * write/exit are injectable for testing.
 *
 * @param {unknown} err      error thrown by `await import(entryUrl)`
 * @param {string}  entryUrl the bin entry's ENTRY_URL (flags transitive misses)
 * @param {{ write?: (s: string) => void, exit?: (code: number) => void }} [io]
 * @returns {void}
 */
export function handleDistLoadError(err, entryUrl, io = {}) {
  const write = io.write ?? ((s) => process.stderr.write(s));
  const exit = io.exit ?? ((code) => process.exit(code));

  const cls = classifyDistLoadError(err);
  if (cls === null) return;

  if (cls.kind === 'dependency') {
    write(
      `guild-cli: dependency '${cls.pkg}' is not installed ` +
        `(node_modules missing or incomplete — dist/ looks built).\n` +
        '  Run: npm install   (installs deps; also builds via the `prepare` script)\n',
    );
    exit(2);
    return;
  }

  // cls.kind === 'dist'
  write(
    'guild-cli: dist/ not built (or out of date).\n' +
      '  Run: npm install   (auto-builds via the `prepare` script)\n' +
      '  Or:  npm run build (rebuild after pulling source changes)\n',
  );
  // Transitive failure (entry loaded, but a deeper dist module is
  // missing) suggests an incomplete or stale build rather than a
  // never-built tree. Surface the missing path so the operator can
  // tell the difference instead of being told to "install" twice.
  if (cls.transitiveUrl && cls.transitiveUrl !== entryUrl) {
    write(`  (transitive miss: ${cls.transitiveUrl})\n`);
  }
  exit(2);
}
