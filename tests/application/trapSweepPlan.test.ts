// Unit tests for the pure trap-sweep planner (#327). The interface-
// layer test (sweepTraps.test.ts) covers the end-to-end CLI surface;
// this file pins the day-granularity comparison and the parser
// boundaries so a future refactor of the I/O layer can't regress
// the policy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TrapDescriptor,
  extractFrontmatterField,
  parseRelevantUntil,
  planTrapSweep,
} from '../../src/application/trapSweep/TrapSweepUseCases.js';

function trap(name: string, raw: string | null): TrapDescriptor {
  return {
    filename: name,
    absolutePath: `/tmp/${name}`,
    relevantUntil: parseRelevantUntil(raw),
    rawValue: raw,
  };
}

test('planner: expired ISO date → sweep', () => {
  const now = new Date('2026-05-11T12:00:00Z');
  const plan = planTrapSweep(now, [trap('trap_a.md', '2026-04-01')]);
  assert.equal(plan.entries[0]?.action, 'sweep');
  assert.match(plan.entries[0]?.rationale ?? '', /relevant_until: 2026-04-01/);
});

test('planner: future-dated ISO → keep-future', () => {
  const now = new Date('2026-05-11T00:00:00Z');
  const plan = planTrapSweep(now, [trap('trap_a.md', '2026-12-31')]);
  assert.equal(plan.entries[0]?.action, 'keep-future');
});

test('planner: same-day ISO is NOT yet expired (relevant *until* the date)', () => {
  // A trap due 2026-05-11 is still relevant on 2026-05-11.
  const now = new Date('2026-05-11T23:59:59Z');
  const plan = planTrapSweep(now, [trap('trap_a.md', '2026-05-11')]);
  assert.equal(plan.entries[0]?.action, 'keep-future');
});

test('planner: day-after the date IS expired', () => {
  const now = new Date('2026-05-12T00:00:01Z');
  const plan = planTrapSweep(now, [trap('trap_a.md', '2026-05-11')]);
  assert.equal(plan.entries[0]?.action, 'sweep');
});

test('planner: indefinite is never swept', () => {
  const now = new Date('2099-12-31T00:00:00Z');
  const plan = planTrapSweep(now, [trap('trap_a.md', 'indefinite')]);
  assert.equal(plan.entries[0]?.action, 'keep-indefinite');
});

test('planner: indefinite is case-insensitive', () => {
  const plan = planTrapSweep(new Date(), [trap('trap_a.md', 'INDEFINITE')]);
  assert.equal(plan.entries[0]?.action, 'keep-indefinite');
});

test('planner: null rawValue (no frontmatter) → keep-indefinite (safe default)', () => {
  const plan = planTrapSweep(new Date(), [trap('trap_a.md', null)]);
  assert.equal(plan.entries[0]?.action, 'keep-indefinite');
  assert.match(plan.entries[0]?.rationale ?? '', /principle 04/);
});

test('planner: invalid value → keep-invalid (surfaced to operator)', () => {
  const plan = planTrapSweep(new Date(), [trap('trap_a.md', '2026-13-99')]);
  assert.equal(plan.entries[0]?.action, 'keep-invalid');
});

test('planner: random non-date string → keep-invalid', () => {
  const plan = planTrapSweep(new Date(), [trap('trap_a.md', 'next-quarter')]);
  assert.equal(plan.entries[0]?.action, 'keep-invalid');
});

test('parser: strips surrounding quotes on frontmatter values', () => {
  const fm = '---\nrelevant_until: "2026-04-01"\n---\n';
  const v = extractFrontmatterField(fm, 'relevant_until');
  assert.equal(v, '2026-04-01');
});

test('parser: returns null when the key is absent', () => {
  const fm = '---\nother_field: value\n---\n';
  assert.equal(extractFrontmatterField(fm, 'relevant_until'), null);
});

test('parser: returns null when no frontmatter block exists', () => {
  assert.equal(extractFrontmatterField('# heading\n\nbody', 'relevant_until'), null);
});

test('parser: tolerates CRLF line endings', () => {
  const fm = '---\r\nrelevant_until: 2026-04-01\r\n---\r\nbody\r\n';
  assert.equal(extractFrontmatterField(fm, 'relevant_until'), '2026-04-01');
});

test('parser: skips YAML comments inside frontmatter', () => {
  const fm = '---\n# a comment\nrelevant_until: 2026-04-01\n---\n';
  assert.equal(extractFrontmatterField(fm, 'relevant_until'), '2026-04-01');
});

test('parseRelevantUntil: rejects 2026-02-31 (round-trip mismatch)', () => {
  assert.equal(parseRelevantUntil('2026-02-31'), 'invalid');
});

test('parseRelevantUntil: rejects bare year', () => {
  assert.equal(parseRelevantUntil('2026'), 'invalid');
});

test('parseRelevantUntil: trims whitespace', () => {
  const v = parseRelevantUntil('  2026-04-01  ');
  assert.ok(v instanceof Date);
});
