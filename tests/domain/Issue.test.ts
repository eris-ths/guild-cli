import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Issue,
  IssueId,
  IssueState,
  canTransitionIssue,
  assertIssueTransition,
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
  i.setState('in_progress');
  assert.equal(i.state, 'in_progress');
  i.setState('resolved');
  assert.equal(i.state, 'resolved');
  // resolved → in_progress is illegal
  assert.throws(() => i.setState('in_progress'), DomainError);
  // resolved → open is legal (reopen)
  i.setState('open');
  assert.equal(i.state, 'open');
});

test('Issue.setState rejects same-state double-call', () => {
  const i = mkIssue();
  assert.throws(() => i.setState('open'), DomainError);
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
  assert.throws(() => i.setState('deferred'), DomainError);
});
