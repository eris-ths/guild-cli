// RepairUseCases — application layer for `gate repair`.
//
// Two responsibilities, kept as separate methods so the dry-run /
// apply split is structural rather than a flag check:
//
//   plan(report)           — pure, returns a RepairPlan
//   apply(plan)            — executes quarantine actions via the
//                            QuarantineStore port
//
// The port keeps the use case ignorant of filesystem details so unit
// tests can inject a fake. Idempotency: actions whose source file no
// longer exists are skipped silently with status='skipped' rather
// than throwing — repair is safe to re-run.
//
// Errors during a single action do NOT abort the whole apply: each
// action records its own outcome so the operator gets a complete
// picture of what worked and what didn't. This is the inverse of
// the cleanup-of-cleanup anti-pattern: failures surface as data,
// not as silently swallowed exceptions.

import { DiagnosticFinding } from '../../domain/diagnostic/DiagnosticReport.js';
import {
  RepairPlan,
  RepairAction,
  planRepair,
} from '../../domain/repair/RepairPlan.js';
import { QuarantineStore } from '../ports/QuarantineStore.js';

export type RepairOutcomeStatus = 'quarantined' | 'skipped' | 'no_op' | 'error';

export interface RepairOutcome {
  readonly action: RepairAction;
  readonly status: RepairOutcomeStatus;
  readonly destination?: string;
  readonly error?: string;
}

export interface RepairOutcomeSummary {
  readonly total: number;
  readonly quarantined: number;
  readonly skipped: number;
  readonly noOp: number;
  readonly error: number;
}

export class RepairResult {
  constructor(readonly outcomes: readonly RepairOutcome[]) {}

  get summary(): RepairOutcomeSummary {
    let quarantined = 0;
    let skipped = 0;
    let noOp = 0;
    let error = 0;
    for (const o of this.outcomes) {
      if (o.status === 'quarantined') quarantined++;
      else if (o.status === 'skipped') skipped++;
      else if (o.status === 'no_op') noOp++;
      else if (o.status === 'error') error++;
    }
    return {
      total: this.outcomes.length,
      quarantined,
      skipped,
      noOp,
      error,
    };
  }

  get hasErrors(): boolean {
    return this.outcomes.some((o) => o.status === 'error');
  }

  toJSON(): unknown {
    return {
      summary: this.summary,
      outcomes: this.outcomes.map((o) => ({
        status: o.status,
        destination: o.destination,
        error: o.error,
        action: {
          kind: o.action.kind,
          rationale: o.action.rationale,
          finding: { ...o.action.finding },
        },
      })),
    };
  }
}

export class RepairUseCases {
  constructor(private readonly quarantine: QuarantineStore) {}

  // Pure: planning is a function of findings and never touches
  // the filesystem. Used by --dry-run. Accepting findings directly
  // (rather than a full DiagnosticReport) keeps the handler boundary
  // simple — repair only ever needs the array.
  plan(findings: readonly DiagnosticFinding[]): RepairPlan {
    return planRepair(findings);
  }

  // Drives quarantine actions through the port. Each outcome is
  // captured independently — one failure does not abort siblings.
  async apply(plan: RepairPlan): Promise<RepairResult> {
    const outcomes: RepairOutcome[] = [];
    for (const action of plan.actions) {
      if (action.kind === 'no_op') {
        outcomes.push({ action, status: 'no_op' });
        continue;
      }
      // quarantine
      const source = action.finding.source;
      if (!this.quarantine.sourceExists(source)) {
        outcomes.push({ action, status: 'skipped' });
        continue;
      }
      try {
        const result = await this.quarantine.move(source);
        outcomes.push({
          action,
          status: 'quarantined',
          destination: result.destination,
        });
      } catch (e) {
        outcomes.push({
          action,
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return new RepairResult(outcomes);
  }
}
