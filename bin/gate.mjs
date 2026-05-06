#!/usr/bin/env node
// Two coupled facts to remember if you change anything here:
//   1. The dist-missing guard is duplicated across the 5 bin entries
//      (gate / guild / agora / devil / ctx) intentionally — a shared
//      helper that itself lived in dist/ would hit the same load
//      failure (circular trap). The partial-staleness check, by
//      contrast, lives in bin/_lib/ as plain .mjs and is shared.
//   2. The error message references `npm install` and the `prepare`
//      script. If package.json drops `prepare: tsc`, update the message.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkDistFreshness } from './_lib/checkDistFreshness.mjs';
const here = dirname(fileURLToPath(import.meta.url));
checkDistFreshness(join(here, '..', 'src'), join(here, '..', 'dist', 'src'));

const ENTRY_URL = new URL('../dist/src/interface/gate/index.js', import.meta.url).href;

let main;
try {
  ({ main } = await import(ENTRY_URL));
} catch (err) {
  if (err?.code === 'ERR_MODULE_NOT_FOUND') {
    // Prefer err.url (stable across Node ESM-loader message tweaks);
    // fall back to message scan for older runtimes that don't set it.
    const failedUrl = typeof err.url === 'string' ? err.url : '';
    const fromDist =
      failedUrl.includes('/dist/') || /\/dist\//.test(err.message ?? '');
    if (fromDist) {
      process.stderr.write(
        'guild-cli: dist/ not built (or out of date).\n' +
          '  Run: npm install   (auto-builds via the `prepare` script)\n' +
          '  Or:  npm run build (rebuild after pulling source changes)\n',
      );
      // Transitive failure (entry loaded, but a deeper dist module is
      // missing) suggests an incomplete or stale build rather than a
      // never-built tree. Surface the missing path so the operator can
      // tell the difference instead of being told to "install" twice.
      if (failedUrl && failedUrl !== ENTRY_URL) {
        process.stderr.write(`  (transitive miss: ${failedUrl})\n`);
      }
      process.exit(2);
    }
  }
  throw err;
}
main(process.argv.slice(2)).then((code) => process.exit(code));
