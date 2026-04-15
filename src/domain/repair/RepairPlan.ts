// RepairPlan — value object describing the intended response to a
// DiagnosticReport. Pure: planning is a total function of findings.
//
// Design split (silent_fail_taxonomy 0414):
//   observation layer  = DiagnosticReport (read-only)
//   intervention layer = RepairPlan + applyRepair (writes)
//
// MVP scope (i-2026-04-15-0026 partial):
//   - quarantine: move the offending file to a timestamped quarantine
//     directory under the content root. Reversible via git or manual mv.
//   - no_op:      record the finding but do nothing. Used for kinds
//     where automatic repair would risk data loss (duplicate_id) or
//     where the kind is unrecognized (unknown).
//
// Field-level patch repairs are explicitly out of scope and tracked
// as a follow-up issue. Quarantine is the smallest action that lets
// the rest of the system proceed without the offending file blocking
// reads or polluting summaries.

import {
  DiagnosticFinding,
  DiagnosticKind,
} from '../diagnostic/DiagnosticReport.js';

export type RepairActionKind = 'quarantine' | 'no_op';

export interface RepairAction {
  readonly finding: DiagnosticFinding;
  readonly kind: RepairActionKind;
  readonly rationale: string;
}

export interface RepairPlanSummary {
  readonly total: number;
  readonly quarantine: number;
  readonly noOp: number;
}

export class RepairPlan {
  constructor(readonly actions: readonly RepairAction[]) {}

  get summary(): RepairPlanSummary {
    let quarantine = 0;
    let noOp = 0;
    for (const a of this.actions) {
      if (a.kind === 'quarantine') quarantine++;
      else noOp++;
    }
    return { total: this.actions.length, quarantine, noOp };
  }

  get isEmpty(): boolean {
    return this.actions.length === 0;
  }

  toJSON(): unknown {
    return {
      summary: this.summary,
      actions: this.actions.map((a) => ({
        kind: a.kind,
        rationale: a.rationale,
        finding: { ...a.finding },
      })),
    };
  }
}

// Pure mapping from finding kind to action. The mapping is total —
// every DiagnosticKind has an explicit branch — so adding a new kind
// to the diagnostic side will fail typecheck here, surfacing the
// scope decision instead of silently defaulting.
export function planRepair(
  findings: readonly DiagnosticFinding[],
): RepairPlan {
  const actions: RepairAction[] = [];
  for (const f of findings) {
    actions.push(actionForKind(f));
  }
  return new RepairPlan(actions);
}

function actionForKind(f: DiagnosticFinding): RepairAction {
  const kind: DiagnosticKind = f.kind;
  switch (kind) {
    case 'top_level_not_mapping':
      return {
        finding: f,
        kind: 'quarantine',
        rationale:
          'YAML root is not a mapping; structurally unrepairable, move out of hot path',
      };
    case 'hydration_error':
      return {
        finding: f,
        kind: 'quarantine',
        rationale:
          'domain hydrate failed; field-level patch out of MVP scope, move out of hot path',
      };
    case 'duplicate_id':
      return {
        finding: f,
        kind: 'no_op',
        rationale:
          'duplicate id — automatic resolution risks data loss; operator must compare and reconcile manually',
      };
    case 'unknown':
      return {
        finding: f,
        kind: 'no_op',
        rationale:
          'unrecognized failure kind; refusing to act without classification',
      };
  }
}
