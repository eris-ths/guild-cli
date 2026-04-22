import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Issue,
  IssueId,
  IssueState,
  canTransitionIssue,
  assertIssueTransition,
  parseIssueSeverity,
} from '../../src/domain/issue/Issue.js';
import { MemberName } from '../../src/domain/member/MemberName.js';
import { DomainError } from '../../src/domain/shared/DomainError.js';

const d = new Date('2026-04-14T00:00:00Z');

function mkIssue(): Issue {
  return Issue.create({
    id: IssueId.generate(d, 1),
    from: 'alice',
    severity: 'med',
    area: 'core',
    text: 'something is broken',
  });
}

test('Issue starts in open', () => {
  const i = mkIssue();
  assert.equal(i.state, 'open');
});

test('canTransitionIssue: open can go to in_progress/deferred/resolved', () => {
  assert.equal(canTransitionIssue('open', 'in_progress'), true);
  assert.equal(canTransitionIssue('open', 'deferred'), true);
  assert.equal(canTransitionIssue('open', 'resolved'), true);
});

test('canTransitionIssue: resolved only reopens to open', () => {
  assert.equal(canTransitionIssue('resolved', 'open'), true);
  assert.equal(canTransitionIssue('resolved', 'in_progress'), false);
  assert.equal(canTransitionIssue('resolved', 'deferred'), false);
});

test('canTransitionIssue: same-state is rejected', () => {
  const states: IssueState[] = ['open', 'in_progress', 'deferred', 'resolved'];
  for (const s of states) {
    assert.equal(canTransitionIssue(s, s), false, `${s}→${s} should be false`);
  }
});

test('canTransitionIssue: in_progress and deferred interconvert', () => {
  assert.equal(canTransitionIssue('in_progress', 'deferred'), true);
  assert.equal(canTransitionIssue('deferred', 'in_progress'), true);
  assert.equal(canTransitionIssue('in_progress', 'open'), true);
  assert.equal(canTransitionIssue('deferred', 'open'), true);
});

test('assertIssueTransition throws DomainError on invalid transition', () => {
  assert.throws(
    () => assertIssueTransition('resolved', 'deferred'),
    DomainError,
  );
  assert.throws(() => assertIssueTransition('open', 'open'), DomainError);
});

test('Issue.setState enforces transition rules', () => {
  const i = mkIssue();
  i.setState('in_progress', 'alice');
  assert.equal(i.state, 'in_progress');
  i.setState('resolved', 'alice');
  assert.equal(i.state, 'resolved');
  // resolved → in_progress is illegal
  assert.throws(() => i.setState('in_progress', 'alice'), DomainError);
  // resolved → open is legal (reopen)
  i.setState('open', 'alice');
  assert.equal(i.state, 'open');
});

test('Issue.setState rejects same-state double-call', () => {
  const i = mkIssue();
  assert.throws(() => i.setState('open', 'alice'), DomainError);
});

test('Issue.setState records a state_log entry per transition', () => {
  const i = mkIssue();
  assert.equal(i.stateLog.length, 0);
  i.setState('in_progress', 'alice');
  assert.equal(i.stateLog.length, 1);
  assert.equal(i.stateLog[0]!.state, 'in_progress');
  assert.equal(i.stateLog[0]!.by, 'alice');
  assert.ok(i.stateLog[0]!.at, 'at should be ISO timestamp');
  // invokedBy defaults to undefined when by === invokedBy
  assert.equal(i.stateLog[0]!.invokedBy, undefined);

  i.setState('resolved', 'bob', 'alice'); // ghost transition: bob acting on alice's behalf
  assert.equal(i.stateLog.length, 2);
  assert.equal(i.stateLog[1]!.by, 'bob');
  assert.equal(i.stateLog[1]!.invokedBy, 'alice');
});

test('Issue.restore bypasses transition validation (historical truth)', () => {
  // Simulating a YAML that has a terminal-but-weird state: we should
  // be able to restore it without a DomainError, even if the props
  // represent a state we would never normally accept.
  const i = Issue.restore({
    id: IssueId.generate(d, 1),
    from: MemberName.of('alice'),
    severity: 'low',
    area: 'core',
    text: 'legacy',
    state: 'resolved',
    createdAt: d.toISOString(),
  });
  assert.equal(i.state, 'resolved');
  // But *new* transitions from that state must still follow the rules.
  assert.throws(() => i.setState('deferred', 'alice'), DomainError);
});

// ── parseIssueSeverity — canonical + aliases + rejects ──

test('parseIssueSeverity accepts all 4 canonical values', () => {
  assert.equal(parseIssueSeverity('low'), 'low');
  assert.equal(parseIssueSeverity('med'), 'med');
  assert.equal(parseIssueSeverity('high'), 'high');
  assert.equal(parseIssueSeverity('critical'), 'critical');
});

test('parseIssueSeverity normalizes alias inputs from other tools', () => {
  // Jira/Linear/GitHub muscle memory
  assert.equal(parseIssueSeverity('medium'), 'med');
  assert.equal(parseIssueSeverity('mid'), 'med');
  assert.equal(parseIssueSeverity('crit'), 'critical');
  assert.equal(parseIssueSeverity('hi'), 'high');
  assert.equal(parseIssueSeverity('lo'), 'low');
  // single-letter shortcuts
  assert.equal(parseIssueSeverity('l'), 'low');
  assert.equal(parseIssueSeverity('m'), 'med');
  assert.equal(parseIssueSeverity('h'), 'high');
  assert.equal(parseIssueSeverity('c'), 'critical');
});

test('parseIssueSeverity is case-insensitive and trims whitespace', () => {
  assert.equal(parseIssueSeverity('MEDIUM'), 'med');
  assert.equal(parseIssueSeverity('Critical'), 'critical');
  assert.equal(parseIssueSeverity('  high  '), 'high');
});

test('parseIssueSeverity rejects truly unknown values', () => {
  assert.throws(() => parseIssueSeverity('watch'), DomainError);
  assert.throws(() => parseIssueSeverity('p0'), DomainError);
  assert.throws(() => parseIssueSeverity(''), DomainError);
});

// ── addNote — append-only annotations ──

test('Issue.addNote appends and does not mutate original text/severity', () => {
  const i = mkIssue();
  const note = i.addNote('eris', 'sev should probably be med, not low');
  assert.equal(i.notes.length, 1);
  assert.equal(note.by, 'eris');
  assert.equal(i.notes[0]!.text, 'sev should probably be med, not low');
  // Original fact-of-record stays untouched — the note is the
  // revision mechanism, not an edit.
  const j = i.toJSON();
  assert.equal(j['severity'], 'med');
  assert.equal(j['text'], 'something is broken');
  assert.ok(Array.isArray(j['notes']));
});

test('Issue.addNote rejects empty text (domain sanitization)', () => {
  const i = mkIssue();
  assert.throws(() => i.addNote('eris', '   '), DomainError);
});

test('Issue.addNote preserves order across multiple calls', () => {
  const i = mkIssue();
  i.addNote('eris', 'first');
  i.addNote('noir', 'second');
  i.addNote('eris', 'third');
  assert.deepEqual(
    i.notes.map((n) => n.text),
    ['first', 'second', 'third'],
  );
  assert.deepEqual(
    i.notes.map((n) => n.by),
    ['eris', 'noir', 'eris'],
  );
});

test('Issue.toJSON omits `notes` when empty (backward-compat)', () => {
  const i = mkIssue();
  const j = i.toJSON();
  assert.equal('notes' in j, false);
});

test('parseIssueSeverity error message lists canonical values + aliases', () => {
  // The error itself is the onboarding: a first-time user who typed
  // `medium` and got rejected should learn the canonical set and the
  // accepted aliases without having to read the source.
  try {
    parseIssueSeverity('p1');
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(err instanceof DomainError);
    assert.match(err.message, /low, med, high, critical/);
    // `s` flag so the dot matches across the newline-separated alias table
    assert.match(err.message, /medium.*med/s);
  }
});

// ── invoked_by on Issue.create + Issue.addNote ──

test('Issue.create stamps invoked_by when differs from from', () => {
  const i = Issue.create({
    id: IssueId.generate(d, 1),
    from: 'alice',
    severity: 'med',
    area: 'core',
    text: 'x',
    invokedBy: 'claude',
  });
  assert.equal(i.toJSON()['invoked_by'], 'claude');
});

test('Issue.create omits invoked_by when equals from', () => {
  const i = Issue.create({
    id: IssueId.generate(d, 1),
    from: 'alice',
    severity: 'med',
    area: 'core',
    text: 'x',
    invokedBy: 'alice',
  });
  assert.equal('invoked_by' in i.toJSON(), false);
});

test('Issue.addNote stamps invoked_by when differs from by', () => {
  const i = mkIssue();
  const note = i.addNote('eris', 'n', undefined, 'claude');
  assert.equal(note.invokedBy, 'claude');
  const j = i.toJSON();
  const notes = j['notes'] as Array<Record<string, unknown>>;
  assert.equal(notes[0]!['invoked_by'], 'claude');
});

test('Issue.addNote omits invoked_by when equals by', () => {
  const i = mkIssue();
  i.addNote('eris', 'n', undefined, 'eris');
  const notes = i.toJSON()['notes'] as Array<Record<string, unknown>>;
  assert.equal('invoked_by' in notes[0]!, false);
});
