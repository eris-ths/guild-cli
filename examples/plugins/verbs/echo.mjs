// Example verb plugin (issue #36 Phase 1 step 4).
//
// `gate echo --text "hello"` prints the text and exits 0. Demonstrates
// the minimum viable plugin shape:
//   - default export carries `name`, `category`, `summary`, `input`,
//     `output`, and `run`
//   - `run(c, args)` returns a Promise<number> exit code
//   - the plugin runs in-process — full Node capabilities — so it's
//     gated on `plugins.trusted: true` in `guild.config.yaml`
//
// To enable:
//
//   # guild.config.yaml
//   plugins:
//     trusted: true
//     verbs:
//       - examples/plugins/verbs/echo.mjs
//
// Then `gate echo --text "hello"` works alongside the built-in verbs.
// `gate schema --format json` reports it with `source: "plugin"`.

export default {
  name: 'echo',
  category: 'meta',
  summary: 'echo --text <s> back to stdout (example verb plugin from #36)',
  input: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'the string to echo' },
      format: {
        type: 'string',
        enum: ['json', 'text'],
        description: 'output format (default: text)',
      },
    },
    required: ['text'],
  },
  output: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      text: { type: 'string' },
    },
  },
  run: async (_c, args) => {
    const text = args.options['text'];
    if (typeof text !== 'string' || text.length === 0) {
      process.stderr.write('error: --text <s> required\n');
      return 1;
    }
    const format = args.options['format'] === 'json' ? 'json' : 'text';
    if (format === 'json') {
      process.stdout.write(JSON.stringify({ ok: true, text }) + '\n');
    } else {
      process.stdout.write(text + '\n');
    }
    return 0;
  },
};
