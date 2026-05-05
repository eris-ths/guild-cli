import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeError } from '../../src/interface/shared/sanitizeError.js';

test('sanitizeError: replaces contentRoot prefix with <content_root>', () => {
  assert.equal(
    sanitizeError(
      'failed to write /Users/alice/proj/substrate/requests/pending/x.yaml',
      '/Users/alice/proj/substrate',
    ),
    'failed to write <content_root>/requests/pending/x.yaml',
  );
});

test('sanitizeError: handles trailing slash on contentRoot', () => {
  assert.equal(
    sanitizeError(
      'cannot read /Users/alice/proj/substrate/members/foo.yaml',
      '/Users/alice/proj/substrate/',
    ),
    'cannot read <content_root>/members/foo.yaml',
  );
});

test('sanitizeError: replaces multiple occurrences in one message', () => {
  assert.equal(
    sanitizeError(
      'cannot move /home/u/r/issues/a.yaml to /home/u/r/issues/closed/a.yaml',
      '/home/u/r',
    ),
    'cannot move <content_root>/issues/a.yaml to <content_root>/issues/closed/a.yaml',
  );
});

test('sanitizeError: leaves messages with no contentRoot prefix untouched', () => {
  assert.equal(
    sanitizeError('member not found: alice', '/Users/alice/proj/substrate'),
    'member not found: alice',
  );
});

test('sanitizeError: leaves paths outside contentRoot untouched', () => {
  // A leaked /tmp or /etc path is not in scope for this issue —
  // boundary sanitize only knows about contentRoot.
  assert.equal(
    sanitizeError(
      'cannot read /etc/passwd while in /Users/alice/proj/substrate/foo',
      '/Users/alice/proj/substrate',
    ),
    'cannot read /etc/passwd while in <content_root>/foo',
  );
});

test('sanitizeError: no-op when contentRoot is empty', () => {
  assert.equal(
    sanitizeError('failed to write /tmp/foo', ''),
    'failed to write /tmp/foo',
  );
});

test('sanitizeError: no-op when contentRoot is just "/"', () => {
  // Replacing "/" everywhere would mangle every path.
  assert.equal(
    sanitizeError('failed at /usr/local/bin', '/'),
    'failed at /usr/local/bin',
  );
});

test('sanitizeError: contentRoot appearing as substring inside a longer path is also replaced', () => {
  // Documents current behavior: simple string replace, no
  // path-segment awareness. Acceptable because contentRoot is
  // always a deep absolute path in practice (GuildConfig
  // resolves it before storing) and structural tail is preserved.
  assert.equal(
    sanitizeError(
      '/Users/alice/proj/substrate-backup/foo',
      '/Users/alice/proj/substrate',
    ),
    '<content_root>-backup/foo',
  );
});
