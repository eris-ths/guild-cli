// DiagnosticReport — value object describing the health of a guild
// content root. Produced by DiagnosticUseCases.run, consumed by
// `gate doctor` (and, eventually, `gate repair` in a future PR).
//
// Design split (silent_fail_taxonomy 0414):
//   observation layer  = this report (read-only, side-effect-free)
//   intervention layer = `gate repair` (writes; not yet implemented)
//
// Keeping diagnostic and repair on separate verbs means an operator
// can always run `gate doctor` without fearing accidental data
// modification. The report shape is JSON-stable so a future repair
// verb can consume it from --json output.

export type DiagnosticArea = 'members' | 'requests' | 'issues';

export type DiagnosticKind =
  | 'top_level_not_mapping'
  | 'hydration_error'
  | 'duplicate_id'
  | 'unknown';

export interface DiagnosticFinding {
  readonly area: DiagnosticArea;
  readonly source: string; // absolute path of the offending file
  readonly kind: DiagnosticKind;
  readonly message: string;
}

export interface DiagnosticAreaSummary {
  readonly total: number;
  readonly malformed: number;
}

export interface DiagnosticSummary {
  readonly members: DiagnosticAreaSummary;
  readonly requests: DiagnosticAreaSummary;
  readonly issues: DiagnosticAreaSummary;
}

export class DiagnosticReport {
  constructor(
    readonly summary: DiagnosticSummary,
    readonly findings: readonly DiagnosticFinding[],
  ) {}

  get isClean(): boolean {
    return this.findings.length === 0;
  }

  toJSON(): unknown {
    return {
      summary: this.summary,
      findings: this.findings.map((f) => ({ ...f })),
    };
  }
}

// Heuristic message-to-kind classifier. The hydrate paths emit
// stable english prefixes, so we recognise them as a best effort
// to give operators a category. Unknown messages fall through to
// 'unknown' rather than throwing — diagnostic must never crash.
export function classifyMessage(message: string): DiagnosticKind {
  const m = message.toLowerCase();
  if (m.includes('top-level yaml is not a mapping')) {
    return 'top_level_not_mapping';
  }
  if (m.includes('duplicate') || m.includes('collision')) {
    return 'duplicate_id';
  }
  if (
    m.includes('skipping') ||
    m.includes('failed to hydrate') ||
    m.includes('domainerror') ||
    m.includes('invalid')
  ) {
    return 'hydration_error';
  }
  return 'unknown';
}
