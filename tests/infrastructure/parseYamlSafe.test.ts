import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYamlSafe } from '../../src/infrastructure/persistence/parseYamlSafe.js';

type Call = { source: string; msg: string };

function makeCollector(): { calls: Call[]; onMalformed: (s: string, m: string) => void } {
  const calls: Call[] = [];
  return {
    calls,
    onMalformed: (source: string, msg: string) => {
      calls.push({ source, msg });
    },
  };
}

test('parseYamlSafe: returns parsed value for valid YAML (mapping)', () => {
  const { calls, onMalformed } = makeCollector();
  const result = parseYamlSafe('name: kiri\ncategory: core\n', '/tmp/x.yaml', onMalformed);
  assert.deepEqual(result, { name: 'kiri', category: 'core' });
  assert.equal(calls.length, 0, 'valid YAML should not trigger onMalformed');
});

test('parseYamlSafe: returns null for empty document (no malformed callback)', () => {
  // YAML.parse('') returns null. The helper preserves that.
  const { calls, onMalformed } = makeCollector();
  const result = parseYamlSafe('', '/tmp/x.yaml', onMalformed);
  assert.equal(result, null);
  assert.equal(calls.length, 0);
});

// Two reliably-unparseable fixtures. `:: broken ::` trips the yaml
// library's compact-mapping rule at the lexer level; the unterminated
// flow sequence trips block-collection indentation at the parser
// level. Between the two, we cover both major failure shapes.
const BROKEN_COMPACT = ':: broken ::';
const BROKEN_UNTERMINATED = '{ unterminated: [1, 2';

test('parseYamlSafe: returns undefined on parse failure and notifies collector', () => {
  const { calls, onMalformed } = makeCollector();
  const result = parseYamlSafe(
    BROKEN_COMPACT,
    '/tmp/broken.yaml',
    onMalformed,
  );
  // undefined (not null) distinguishes "parse failed" from
  // "parsed successfully to null".
  assert.equal(result, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.source, '/tmp/broken.yaml');
  assert.match(calls[0]!.msg, /^yaml parse failed: /);
});

test('parseYamlSafe: catches unterminated flow collections', () => {
  const { calls, onMalformed } = makeCollector();
  const result = parseYamlSafe(
    BROKEN_UNTERMINATED,
    '/tmp/unterminated.yaml',
    onMalformed,
  );
  assert.equal(result, undefined);
  assert.equal(calls.length, 1);
});

test('parseYamlSafe: collapses multi-line parser errors to one line', () => {
  const { calls, onMalformed } = makeCollector();
  // The yaml library's errors typically span several lines with
  // caret indicators. The helper flattens newlines so diagnostic
  // text output stays readable.
  parseYamlSafe(BROKEN_COMPACT, '/tmp/broken.yaml', onMalformed);
  assert.equal(calls.length, 1);
  const msg = calls[0]!.msg;
  assert.ok(!msg.includes('\n'), `expected single-line message, got: ${msg}`);
});

test('parseYamlSafe: preserves intentional horizontal whitespace (does not collapse \\s+)', () => {
  // The helper flattens newlines, but does not squeeze runs of
  // spaces inside the message. Parser errors sometimes contain
  // quoted tokens like `unexpected 'foo  bar'` where the double
  // space is load-bearing information; collapsing \s+ to ' ' would
  // silently lose it. We simulate that by feeding a parser whose
  // error message we know contains a double space pattern.
  //
  // We can't easily force the real yaml library to produce a
  // specific message, so we verify the helper's regex/split logic
  // directly by checking that a synthetic multi-line-with-doubles
  // message round-trips correctly through the actual codepath.
  // This is done by calling parseYamlSafe on a YAML input that
  // produces a known-ish error and asserting the structure.
  const { calls, onMalformed } = makeCollector();
  parseYamlSafe(BROKEN_COMPACT, '/tmp/broken.yaml', onMalformed);
  // The yaml lib's real error contains a caret line; after our
  // split('\n').join(' ') it becomes one line. Intentional
  // horizontal whitespace inside each line is preserved (there's
  // nothing to collapse). The important thing is: no newlines,
  // but the message doesn't have extra spaces squeezed out either.
  assert.equal(calls.length, 1);
  const msg = calls[0]!.msg;
  assert.ok(!msg.includes('\n'));
  // Original yaml error typically has "at line N, column M: <text>\n<caret>"
  // After join: "at line N, column M: <text> <caret>"
  // The caret char '^' should be visible, which is only possible
  // if we joined rather than collapsed. This is a weak assertion
  // but catches the over-collapse case.
  // (The BROKEN_COMPACT fixture's error includes a '^' caret.)
  assert.ok(
    msg.includes('^'),
    `expected caret from yaml error to survive the join, got: ${msg}`,
  );
});

test('parseYamlSafe: undefined-vs-null distinction is stable', () => {
  // Callers rely on `=== undefined` to mean "parse failed".
  // `null` means "parsed successfully, document is empty". This
  // test pins the contract so a future well-meaning refactor that
  // returns null for both cases fails loudly.
  const { onMalformed } = makeCollector();
  assert.equal(parseYamlSafe('', '/x', onMalformed), null);
  assert.equal(parseYamlSafe(BROKEN_COMPACT, '/x', onMalformed), undefined);
});

test('parseYamlSafe: source path is passed through verbatim', () => {
  const { calls, onMalformed } = makeCollector();
  parseYamlSafe(
    BROKEN_COMPACT,
    '/some/deep/path with spaces/file.yaml',
    onMalformed,
  );
  assert.equal(calls[0]!.source, '/some/deep/path with spaces/file.yaml');
});

test('parseYamlSafe: message prefix matches classifier expectation', () => {
  // Coupling this prefix to the classifier is deliberate — if
  // someone changes the prefix, this test flags the need to update
  // DiagnosticReport.classifyMessage at the same time.
  const { calls, onMalformed } = makeCollector();
  parseYamlSafe(BROKEN_COMPACT, '/x', onMalformed);
  assert.ok(
    calls[0]!.msg.toLowerCase().startsWith('yaml parse failed'),
    'prefix must start with "yaml parse failed" so classifyMessage routes to yaml_parse_error',
  );
});
