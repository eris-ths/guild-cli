// RepairUseCases — application tests for plan + apply.
//
// Verifies:
//   1. planRepair maps every DiagnosticKind to the right RepairAction
//   2. apply quarantines hydration_error and top_level_not_mapping
//   3. apply leaves duplicate_id and unknown as no_op (data safety)
//   4. apply is idempotent: a missing source becomes 'skipped', not error
//   5. apply records errors per-action without aborting the rest
//   6. RepairResult.summary reflects mixed outcomes correctly

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RepairUseCases,
  RepairResult,
} from '../../src/application/repair/RepairUseCases.js';
import { planRepair } from '../../src/domain/repair/RepairPlan.js';
import {
  DiagnosticFinding,
} from '../../src/domain/diagnostic/DiagnosticReport.js';
import {
  QuarantineStore,
  QuarantineResult,
} from '../../src/application/ports/QuarantineStore.js';

class FakeQuarantineStore implements QuarantineStore {
  movedSources: string[] = [];
  errorOnSource: string | null = null;
  constructor(private existingSources: Set<string>) {}
  sourceExists(absSource: string): boolean {
    return this.existingSources.has(absSource);
  }
  async move(absSource: string): Promise<QuarantineResult> {
    if (this.errorOnSource === absSource) {
      throw new Error(`mock failure for ${absSource}`);
    }
    this.movedSources.push(absSource);
    this.existingSources.delete(absSource); // make idempotent
    return {
      source: absSource,
      destination: `/quarantine/${absSource.split('/').pop()}`,
    };
  }
}

function f(
  area: 'members' | 'requests' | 'issues',
  source: string,
  kind: DiagnosticFinding['kind'],
  message = '...',
): DiagnosticFinding {
  return { area, source, kind, message };
}

test('planRepair: top_level_not_mapping → quarantine', () => {
  const plan = planRepair([f('issues', '/r/i/x.yaml', 'top_level_not_mapping')]);
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0]?.kind, 'quarantine');
});

test('planRepair: hydration_error → quarantine', () => {
  const plan = planRepair([f('members', '/r/m/x.yaml', 'hydration_error')]);
  assert.equal(plan.actions[0]?.kind, 'quarantine');
});

test('planRepair: duplicate_id → no_op (data safety)', () => {
  const plan = planRepair([f('issues', '/r/i/x.yaml', 'duplicate_id')]);
  assert.equal(plan.actions[0]?.kind, 'no_op');
  assert.match(plan.actions[0]!.rationale, /data loss|reconcile|manually/);
});

test('planRepair: unknown → no_op (refusal to act)', () => {
  const plan = planRepair([f('requests', '/r/r/x.yaml', 'unknown')]);
  assert.equal(plan.actions[0]?.kind, 'no_op');
});

test('planRepair: empty findings → empty plan', () => {
  const plan = planRepair([]);
  assert.equal(plan.isEmpty, true);
  assert.deepEqual(plan.summary, { total: 0, quarantine: 0, noOp: 0 });
});

test('planRepair: summary counts each kind correctly', () => {
  const plan = planRepair([
    f('members', '/a.yaml', 'top_level_not_mapping'),
    f('members', '/b.yaml', 'hydration_error'),
    f('issues', '/c.yaml', 'duplicate_id'),
    f('requests', '/d.yaml', 'unknown'),
  ]);
  assert.deepEqual(plan.summary, { total: 4, quarantine: 2, noOp: 2 });
});

test('apply: quarantines existing sources', async () => {
  const store = new FakeQuarantineStore(new Set(['/a.yaml', '/b.yaml']));
  const uc = new RepairUseCases(store);
  const plan = uc.plan([
    f('members', '/a.yaml', 'top_level_not_mapping'),
    f('issues', '/b.yaml', 'hydration_error'),
  ]);
  const result = await uc.apply(plan);
  assert.equal(result.summary.quarantined, 2);
  assert.equal(result.summary.error, 0);
  assert.equal(store.movedSources.length, 2);
});

test('apply: missing source becomes skipped (idempotency)', async () => {
  const store = new FakeQuarantineStore(new Set()); // nothing exists
  const uc = new RepairUseCases(store);
  const plan = uc.plan([f('members', '/gone.yaml', 'hydration_error')]);
  const result = await uc.apply(plan);
  assert.equal(result.summary.skipped, 1);
  assert.equal(result.summary.quarantined, 0);
  assert.equal(result.summary.error, 0);
  assert.equal(store.movedSources.length, 0);
});

test('apply: duplicate_id is no_op even when source exists', async () => {
  const store = new FakeQuarantineStore(new Set(['/dup.yaml']));
  const uc = new RepairUseCases(store);
  const plan = uc.plan([f('issues', '/dup.yaml', 'duplicate_id')]);
  const result = await uc.apply(plan);
  assert.equal(result.summary.noOp, 1);
  assert.equal(store.movedSources.length, 0); // file untouched
});

test('apply: per-action errors do not abort siblings', async () => {
  const store = new FakeQuarantineStore(new Set(['/a.yaml', '/b.yaml']));
  store.errorOnSource = '/a.yaml';
  const uc = new RepairUseCases(store);
  const plan = uc.plan([
    f('members', '/a.yaml', 'top_level_not_mapping'),
    f('issues', '/b.yaml', 'hydration_error'),
  ]);
  const result = await uc.apply(plan);
  assert.equal(result.summary.error, 1);
  assert.equal(result.summary.quarantined, 1);
  assert.equal(result.hasErrors, true);
  // The other action still ran
  assert.equal(store.movedSources.includes('/b.yaml'), true);
});

test('RepairResult.toJSON: stable shape', async () => {
  const store = new FakeQuarantineStore(new Set(['/a.yaml']));
  const uc = new RepairUseCases(store);
  const plan = uc.plan([f('members', '/a.yaml', 'hydration_error')]);
  const result = await uc.apply(plan);
  const json = result.toJSON() as {
    summary: { quarantined: number };
    outcomes: { status: string; destination: string }[];
  };
  assert.equal(json.summary.quarantined, 1);
  assert.equal(json.outcomes[0]?.status, 'quarantined');
  assert.match(json.outcomes[0]!.destination!, /^\/quarantine\//);
});
