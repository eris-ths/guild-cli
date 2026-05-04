#!/usr/bin/env node
let main;
try {
  ({ main } = await import('../dist/src/passages/devil/interface/index.js'));
} catch (err) {
  if (err && err.code === 'ERR_MODULE_NOT_FOUND' && /\/dist\//.test(err.message ?? '')) {
    process.stderr.write(
      'guild-cli: dist/ not built (or out of date).\n' +
      '  Run: npm install   (auto-builds via the `prepare` script)\n' +
      '  Or:  npm run build (rebuild after pulling source changes)\n',
    );
    process.exit(2);
  }
  throw err;
}
main(process.argv.slice(2)).then((code) => process.exit(code));
