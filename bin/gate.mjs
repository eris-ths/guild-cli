#!/usr/bin/env node
// Two coupled facts to remember if you change anything here:
//   1. The try/catch around `await import(ENTRY_URL)` is duplicated across
//      the 5 bin entries (gate / guild / agora / devil / ctx) because each
//      has its own ENTRY_URL. The classification + remedy text it delegates
//      to lives in bin/_lib/handleDistLoadError.mjs — plain .mjs, not
//      transpiled, so a load failure can't take the helper down with it
//      (same circular-trap reasoning as checkDistFreshness).
//   2. The error message references `npm install` and the `prepare`
//      script. If package.json drops `prepare: tsc`, update the message
//      in handleDistLoadError.mjs.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkDistFreshness } from './_lib/checkDistFreshness.mjs';
import { handleDistLoadError } from './_lib/handleDistLoadError.mjs';
import { handleMainError } from './_lib/handleMainError.mjs';
// Make stdout/stderr blocking so large payloads (e.g. `gate schema --format
// json`, `gate boot` on busy substrates) drain before the trailing
// `process.exit` truncates them. Pipe writes are async by default; on
// `--format json` outputs above ~8 KB the tail of the JSON envelope was
// being cut at exit, surfacing as `Unexpected end of JSON input` in CI.
// tty writes are already synchronous, so the guard is a no-op there.
process.stdout._handle?.setBlocking?.(true);
process.stderr._handle?.setBlocking?.(true);
const here = dirname(fileURLToPath(import.meta.url));
checkDistFreshness(join(here, '..', 'src'), join(here, '..', 'dist', 'src'));

const ENTRY_URL = new URL('../dist/src/interface/gate/index.js', import.meta.url).href;

let main;
try {
  ({ main } = await import(ENTRY_URL));
} catch (err) {
  handleDistLoadError(err, ENTRY_URL); // exits on a recognized dist/dep miss
  throw err;
}
main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch(handleMainError('gate'));
