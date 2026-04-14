#!/usr/bin/env node
import { main } from '../dist/src/interface/guild/index.js';
main(process.argv.slice(2)).then((code) => process.exit(code));
