#!/usr/bin/env node
import { main } from '../dist/src/interface/gate/index.js';
main(process.argv.slice(2)).then((code) => process.exit(code));
