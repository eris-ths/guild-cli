#!/usr/bin/env node
import { main } from '../dist/src/passages/agora/interface/index.js';
main(process.argv.slice(2)).then((code) => process.exit(code));
