import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EDITOR_SCISSORS,
  stripEditorComments,
  pickEditor,
} from '../../src/interface/gate/handlers/internal.js';

// --- stripEditorComments -----------------------------------------------

test('stripEditorComments: returns empty on empty input', () => {
  assert.equal(stripEditorComments(''), '');
});

test('stripEditorComments: returns trimmed body when no scissors line', () => {
  assert.equal(stripEditorComments('   hello\nworld   '), 'hello\nworld');
});

test('stripEditorComments: strips everything at and below the scissors line', () => {
  const raw = [
    'This is my real review.',
    'It has multiple paragraphs.',
    '',
    EDITOR_SCISSORS,
    '# Write your review comment above...',
    '# context:',
    '#   id: 2026-04-15-0001',
    '',
  ].join('\n');
  assert.equal(
    stripEditorComments(raw),
    'This is my real review.\nIt has multiple paragraphs.',
  );
});

test('stripEditorComments: preserves leading blank lines above scissors', () => {
  // If the user leaves the first two template blank lines alone and
  // writes starting from line 3, the blanks above should still be
  // trimmed (only outer whitespace, not internal).
  const raw = [
    '',
    '',
    'Actual content.',
    '',
    EDITOR_SCISSORS,
    '# instructions...',
  ].join('\n');
  assert.equal(stripEditorComments(raw), 'Actual content.');
});

test('stripEditorComments: preserves # characters INSIDE the body', () => {
  // Legitimate markdown or citation: a line starting with `#` above
  // the scissors line is part of the review, not an instruction.
  // The scissors convention sidesteps the problem of "strip any `#`
  // line" which would corrupt numbered lists like `# 1.`.
  const raw = [
    '# A heading in markdown',
    'Paragraph below the heading.',
    '',
    EDITOR_SCISSORS,
    '# instructions...',
  ].join('\n');
  assert.equal(
    stripEditorComments(raw),
    '# A heading in markdown\nParagraph below the heading.',
  );
});

test('stripEditorComments: scissors-only input yields empty body', () => {
  const raw = [EDITOR_SCISSORS, '# all instructions'].join('\n');
  assert.equal(stripEditorComments(raw), '');
});

test('stripEditorComments: trims trailing whitespace in body', () => {
  const raw = ['body line', '', '   ', EDITOR_SCISSORS, '# x'].join('\n');
  assert.equal(stripEditorComments(raw), 'body line');
});

test('stripEditorComments: scissors line is matched exactly as git convention', () => {
  // Pin the literal so a future refactor can't quietly change the
  // sentinel and break the strip contract.
  assert.equal(
    EDITOR_SCISSORS,
    '# ------------------------ >8 ------------------------',
  );
});

// --- pickEditor --------------------------------------------------------
//
// pickEditor reads process.env, so tests mutate and restore env vars.
// Run serially (the node:test runner serializes tests by default
// within a file) and restore via finally so a failure doesn't leak.

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

test('pickEditor: GIT_EDITOR wins over VISUAL and EDITOR', () => {
  withEnv(
    { GIT_EDITOR: 'git-editor', VISUAL: 'visual', EDITOR: 'editor' },
    () => {
      assert.equal(pickEditor(), 'git-editor');
    },
  );
});

test('pickEditor: VISUAL wins over EDITOR when GIT_EDITOR unset', () => {
  withEnv(
    { GIT_EDITOR: undefined, VISUAL: 'visual', EDITOR: 'editor' },
    () => {
      assert.equal(pickEditor(), 'visual');
    },
  );
});

test('pickEditor: EDITOR wins when GIT_EDITOR and VISUAL unset', () => {
  withEnv(
    { GIT_EDITOR: undefined, VISUAL: undefined, EDITOR: 'my-editor' },
    () => {
      assert.equal(pickEditor(), 'my-editor');
    },
  );
});

test('pickEditor: platform fallback when all env vars unset', () => {
  withEnv(
    { GIT_EDITOR: undefined, VISUAL: undefined, EDITOR: undefined },
    () => {
      const result = pickEditor();
      // On Windows the fallback is 'notepad'; elsewhere 'vi'.
      // We assert against process.platform so the test is correct
      // on both CI runners (ubuntu-latest and windows-latest).
      const expected = process.platform === 'win32' ? 'notepad' : 'vi';
      assert.equal(result, expected);
    },
  );
});
