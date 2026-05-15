#!/usr/bin/env node
// Two coupled facts to remember if you change anything here:
//   1. The dist-missing guard is duplicated across the 5 bin entries
//      intentionally — see gate.mjs for the rationale. The
//      partial-staleness check is shared via bin/_lib/.
//   2. The error message references `npm install` and the `prepare`
//      script. If package.json drops `prepare: tsc`, update the message.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkDistFreshness } from './_lib/checkDistFreshness.mjs';
import { handleMainError } from './_lib/handleMainError.mjs';
// Match the bin/gate.mjs setBlocking comment — same rationale.
process.stdout._handle?.setBlocking?.(true);
process.stderr._handle?.setBlocking?.(true);
const here = dirname(fileURLToPath(import.meta.url));
checkDistFreshness(join(here, '..', 'src'), join(here, '..', 'dist', 'src'));

const ENTRY_URL = new URL('../dist/src/interface/guild/index.js', import.meta.url).href;

let main;
try {
  ({ main } = await import(ENTRY_URL));
} catch (err) {
  if (err?.code === 'ERR_MODULE_NOT_FOUND') {
    const failedUrl = typeof err.url === 'string' ? err.url : '';
    const fromDist =
      failedUrl.includes('/dist/') || /\/dist\//.test(err.message ?? '');
    if (fromDist) {
      process.stderr.write(
        'guild-cli: dist/ not built (or out of date).\n' +
          '  Run: npm install   (auto-builds via the `prepare` script)\n' +
          '  Or:  npm run build (rebuild after pulling source changes)\n',
      );
      if (failedUrl && failedUrl !== ENTRY_URL) {
        process.stderr.write(`  (transitive miss: ${failedUrl})\n`);
      }
      process.exit(2);
    }
  }
  throw err;
}
main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch(handleMainError('guild'));
