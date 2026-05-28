#!/usr/bin/env node
// Two coupled facts to remember if you change anything here:
//   1. The try/catch around `await import(ENTRY_URL)` is duplicated across
//      the 5 bin entries — see gate.mjs for the rationale. Classification
//      + remedy text is shared via bin/_lib/handleDistLoadError.mjs.
//   2. The error message references `npm install` and the `prepare`
//      script. If package.json drops `prepare: tsc`, update the message
//      in handleDistLoadError.mjs.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkDistFreshness } from './_lib/checkDistFreshness.mjs';
import { handleDistLoadError } from './_lib/handleDistLoadError.mjs';
import { handleMainError } from './_lib/handleMainError.mjs';
// Match the bin/gate.mjs setBlocking comment — same rationale.
process.stdout._handle?.setBlocking?.(true);
process.stderr._handle?.setBlocking?.(true);
const here = dirname(fileURLToPath(import.meta.url));
checkDistFreshness(join(here, '..', 'src'), join(here, '..', 'dist', 'src'));

const ENTRY_URL = new URL('../dist/src/passages/agora/interface/index.js', import.meta.url).href;

let main;
try {
  ({ main } = await import(ENTRY_URL));
} catch (err) {
  handleDistLoadError(err, ENTRY_URL); // exits on a recognized dist/dep miss
  throw err;
}
main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch(handleMainError('agora'));
