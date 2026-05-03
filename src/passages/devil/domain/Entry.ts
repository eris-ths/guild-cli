// devil-review — Entry (one annotation inside a review session).
//
// An entry is the unit of contribution. Each entry pins:
//   - who: actor (--by) + persona (the framing they committed to)
//   - what lense: which axis of the review they touched
//   - what kind: finding / assumption / resistance / skip / synthesis / gate
//
// Per issue #126, conditional fields apply per kind:
//   finding   — severity + severity_rationale + status (open|dismissed|resolved)
//             + dismissal_reason / dismissal_note when status='dismissed'
//             + resolved_by_commit when status='resolved'
//   gate      — stages[] (multi-step automated check output)
//   skip      — text must declare why the lense is irrelevant (no other constraint)
//   assumption / resistance / synthesis — base fields only
//
// addresses is the cross-reference: an entry that contests, refines,
// or resolves an earlier entry references it by id. Substrate-level
// thread, not a separate stream.
//
// AI-first per principle 11:
//   - factory methods per kind keep the type-shape obvious to a caller
//   - restore validates the same invariants — a tampered file fails closed
//   - toJSON omits absent optionals so re-readers don't see noise

import { DomainError } from '../../../domain/shared/DomainError.js';
import { parseLenseName } from './Lense.js';
import { parsePersonaName } from './Persona.js';

export type EntryKind =
  | 'finding'
  | 'assumption'
  | 'resistance'
  | 'skip'
  | 'synthesis'
  | 'gate';

const VALID_KINDS: ReadonlySet<EntryKind> = new Set([
  'finding',
  'assumption',
  'resistance',
  'skip',
  'synthesis',
  'gate',
]);

export function parseEntryKind(raw: unknown): EntryKind {
  if (typeof raw !== 'string' || !VALID_KINDS.has(raw as EntryKind)) {
    throw new DomainError(
      `entry kind must be one of ${[...VALID_KINDS].join(', ')}, got: ${String(raw)}`,
      'kind',
    );
  }
  return raw as EntryKind;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

const VALID_SEVERITIES: ReadonlySet<Severity> = new Set([
  'critical',
  'high',
  'medium',
  'low',
  'info',
]);

export function parseSeverity(raw: unknown): Severity {
  if (typeof raw !== 'string' || !VALID_SEVERITIES.has(raw as Severity)) {
    throw new DomainError(
      `severity must be one of ${[...VALID_SEVERITIES].join(', ')}, got: ${String(raw)}`,
      'severity',
    );
  }
  return raw as Severity;
}

export type EntryStatus = 'open' | 'dismissed' | 'resolved';

const VALID_STATUSES: ReadonlySet<EntryStatus> = new Set([
  'open',
  'dismissed',
  'resolved',
]);

export function parseEntryStatus(raw: unknown): EntryStatus {
  if (typeof raw !== 'string' || !VALID_STATUSES.has(raw as EntryStatus)) {
    throw new DomainError(
      `entry status must be one of ${[...VALID_STATUSES].join(', ')}, got: ${String(raw)}`,
      'status',
    );
  }
  return raw as EntryStatus;
}

/**
 * Initial dismissal_reason enum per issue #126's open question. May
 * grow as dogfood surfaces categories we missed; treat this as v0.
 */
export type DismissalReason =
  | 'not-applicable'
  | 'accepted-risk'
  | 'false-positive'
  | 'out-of-scope'
  | 'mitigated-elsewhere';

const VALID_DISMISSAL_REASONS: ReadonlySet<DismissalReason> = new Set([
  'not-applicable',
  'accepted-risk',
  'false-positive',
  'out-of-scope',
  'mitigated-elsewhere',
]);

export function parseDismissalReason(raw: unknown): DismissalReason {
  if (
    typeof raw !== 'string' ||
    !VALID_DISMISSAL_REASONS.has(raw as DismissalReason)
  ) {
    throw new DomainError(
      `dismissal_reason must be one of ${[...VALID_DISMISSAL_REASONS].join(', ')}, got: ${String(raw)}`,
      'dismissal_reason',
    );
  }
  return raw as DismissalReason;
}

/** Entry id format: e-NNN (3-digit sequence inside a review). */
const ENTRY_ID_PATTERN = /^e-\d{3,4}$/;

export function parseEntryId(raw: unknown): string {
  if (typeof raw !== 'string' || !ENTRY_ID_PATTERN.test(raw)) {
    throw new DomainError(
      `entry id must match e-NNN, got: ${String(raw)}`,
      'id',
    );
  }
  return raw;
}

/**
 * One stage of an automated multi-stage check (e.g., SCG's 8 gates).
 * Reasoning is required because the substrate is the audit trail —
 * a stage with `pass` and no reasoning teaches no one anything.
 */
export interface GateStage {
  readonly name: string;
  readonly verdict: string; // intentionally untyped: tools name their own verdicts
  readonly reasoning: string;
}

function parseGateStage(raw: unknown, idx: number): GateStage {
  if (raw === null || typeof raw !== 'object') {
    throw new DomainError(`stages[${idx}] must be an object`, 'stages');
  }
  const r = raw as Record<string, unknown>;
  const name = r['name'];
  const verdict = r['verdict'];
  const reasoning = r['reasoning'];
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new DomainError(`stages[${idx}].name required (non-empty string)`, 'stages');
  }
  if (typeof verdict !== 'string' || verdict.trim().length === 0) {
    throw new DomainError(`stages[${idx}].verdict required (non-empty string)`, 'stages');
  }
  if (typeof reasoning !== 'string' || reasoning.trim().length === 0) {
    throw new DomainError(
      `stages[${idx}].reasoning required (non-empty string) — substrate must explain each gate's verdict`,
      'stages',
    );
  }
  return { name: name.trim(), verdict: verdict.trim(), reasoning: reasoning.trim() };
}

export interface EntryProps {
  // base (always required)
  readonly id: string;
  readonly at: string;
  readonly by: string;
  readonly persona: string;
  readonly lense: string;
  readonly kind: EntryKind;
  readonly text: string;
  readonly addresses?: string; // optional cross-reference to earlier entry id

  // finding-only
  readonly severity?: Severity;
  readonly severity_rationale?: string;
  readonly status?: EntryStatus;

  // status-conditional (finding only)
  readonly dismissal_reason?: DismissalReason;
  readonly dismissal_note?: string;
  readonly resolved_by_commit?: string;

  // gate-only
  readonly stages?: readonly GateStage[];
}

export class Entry {
  readonly id: string;
  readonly at: string;
  readonly by: string;
  readonly persona: string;
  readonly lense: string;
  readonly kind: EntryKind;
  readonly text: string;
  readonly addresses?: string;
  readonly severity?: Severity;
  readonly severity_rationale?: string;
  readonly status?: EntryStatus;
  readonly dismissal_reason?: DismissalReason;
  readonly dismissal_note?: string;
  readonly resolved_by_commit?: string;
  readonly stages?: readonly GateStage[];

  private constructor(props: EntryProps) {
    this.id = props.id;
    this.at = props.at;
    this.by = props.by;
    this.persona = props.persona;
    this.lense = props.lense;
    this.kind = props.kind;
    this.text = props.text;
    if (props.addresses !== undefined) this.addresses = props.addresses;
    if (props.severity !== undefined) this.severity = props.severity;
    if (props.severity_rationale !== undefined)
      this.severity_rationale = props.severity_rationale;
    if (props.status !== undefined) this.status = props.status;
    if (props.dismissal_reason !== undefined)
      this.dismissal_reason = props.dismissal_reason;
    if (props.dismissal_note !== undefined)
      this.dismissal_note = props.dismissal_note;
    if (props.resolved_by_commit !== undefined)
      this.resolved_by_commit = props.resolved_by_commit;
    if (props.stages !== undefined) this.stages = props.stages;
  }

  /**
   * Strict construction. Validates kind-specific invariants:
   *   - finding: severity, severity_rationale, status all required
   *   - finding+dismissed: dismissal_reason required
   *   - finding+resolved: resolved_by_commit optional but typed when present
   *   - gate: stages required, non-empty
   *   - non-finding: must NOT carry severity/status/dismissal/resolved
   *   - non-gate: must NOT carry stages
   *
   * Caller passes the discriminated union as props; we re-check
   * because restore() goes through the same path.
   */
  static create(input: EntryProps): Entry {
    const id = parseEntryId(input.id);
    if (typeof input.at !== 'string' || input.at.length === 0) {
      throw new DomainError('at required (ISO timestamp)', 'at');
    }
    if (typeof input.by !== 'string' || input.by.trim().length === 0) {
      throw new DomainError('by required (non-empty string)', 'by');
    }
    const persona = parsePersonaName(input.persona);
    const lense = parseLenseName(input.lense);
    const kind = parseEntryKind(input.kind);
    if (typeof input.text !== 'string' || input.text.trim().length === 0) {
      throw new DomainError('text required (non-empty string)', 'text');
    }
    if (input.addresses !== undefined) {
      parseEntryId(input.addresses);
    }

    // Kind-specific invariants.
    if (kind === 'finding') {
      if (input.severity === undefined) {
        throw new DomainError(
          "kind='finding' requires severity (critical|high|medium|low|info)",
          'severity',
        );
      }
      if (
        input.severity_rationale === undefined ||
        input.severity_rationale.trim().length === 0
      ) {
        throw new DomainError(
          "kind='finding' requires severity_rationale (prose explaining why this severity in this codebase)",
          'severity_rationale',
        );
      }
      if (input.status === undefined) {
        throw new DomainError(
          "kind='finding' requires status (open|dismissed|resolved)",
          'status',
        );
      }
      parseSeverity(input.severity);
      parseEntryStatus(input.status);
      if (input.status === 'dismissed') {
        if (input.dismissal_reason === undefined) {
          throw new DomainError(
            "status='dismissed' requires dismissal_reason",
            'dismissal_reason',
          );
        }
        parseDismissalReason(input.dismissal_reason);
        if (
          input.dismissal_note !== undefined &&
          (typeof input.dismissal_note !== 'string' ||
            input.dismissal_note.trim().length === 0)
        ) {
          throw new DomainError(
            'dismissal_note must be a non-empty string when set',
            'dismissal_note',
          );
        }
      } else {
        if (input.dismissal_reason !== undefined) {
          throw new DomainError(
            `dismissal_reason only valid when status='dismissed' (got status='${input.status}')`,
            'dismissal_reason',
          );
        }
        if (input.dismissal_note !== undefined) {
          throw new DomainError(
            `dismissal_note only valid when status='dismissed' (got status='${input.status}')`,
            'dismissal_note',
          );
        }
      }
      if (input.status === 'resolved') {
        if (
          input.resolved_by_commit !== undefined &&
          (typeof input.resolved_by_commit !== 'string' ||
            input.resolved_by_commit.trim().length === 0)
        ) {
          throw new DomainError(
            'resolved_by_commit must be a non-empty string when set',
            'resolved_by_commit',
          );
        }
      } else if (input.resolved_by_commit !== undefined) {
        throw new DomainError(
          `resolved_by_commit only valid when status='resolved' (got status='${input.status}')`,
          'resolved_by_commit',
        );
      }
    } else {
      if (input.severity !== undefined) {
        throw new DomainError(`severity only valid for kind='finding'`, 'severity');
      }
      if (input.severity_rationale !== undefined) {
        throw new DomainError(
          `severity_rationale only valid for kind='finding'`,
          'severity_rationale',
        );
      }
      if (input.status !== undefined) {
        throw new DomainError(`status only valid for kind='finding'`, 'status');
      }
      if (input.dismissal_reason !== undefined) {
        throw new DomainError(
          `dismissal_reason only valid for kind='finding'`,
          'dismissal_reason',
        );
      }
      if (input.dismissal_note !== undefined) {
        throw new DomainError(
          `dismissal_note only valid for kind='finding'`,
          'dismissal_note',
        );
      }
      if (input.resolved_by_commit !== undefined) {
        throw new DomainError(
          `resolved_by_commit only valid for kind='finding'`,
          'resolved_by_commit',
        );
      }
    }

    if (kind === 'gate') {
      if (!Array.isArray(input.stages) || input.stages.length === 0) {
        throw new DomainError(
          "kind='gate' requires non-empty stages[] (multi-stage check output)",
          'stages',
        );
      }
      const stages = input.stages.map((s, i) => parseGateStage(s, i));
      return new Entry({
        ...input,
        id,
        persona,
        lense,
        kind,
        text: input.text.trim(),
        stages,
        ...(input.severity_rationale !== undefined
          ? { severity_rationale: input.severity_rationale.trim() }
          : {}),
        ...(input.dismissal_note !== undefined
          ? { dismissal_note: input.dismissal_note.trim() }
          : {}),
      });
    } else {
      if (input.stages !== undefined) {
        throw new DomainError(`stages only valid for kind='gate'`, 'stages');
      }
    }

    return new Entry({
      ...input,
      id,
      persona,
      lense,
      kind,
      text: input.text.trim(),
      ...(input.severity_rationale !== undefined
        ? { severity_rationale: input.severity_rationale.trim() }
        : {}),
      ...(input.dismissal_note !== undefined
        ? { dismissal_note: input.dismissal_note.trim() }
        : {}),
    });
  }

  /**
   * Restore from on-disk YAML — same validation as create. A tampered
   * entry fails closed at the domain boundary; the substrate either
   * loads cleanly or surfaces a structured error.
   */
  static restore(raw: unknown): Entry {
    if (raw === null || typeof raw !== 'object') {
      throw new DomainError('entry must be an object', 'entry');
    }
    const r = raw as Record<string, unknown>;
    return Entry.create({
      id: r['id'] as string,
      at: r['at'] as string,
      by: r['by'] as string,
      persona: r['persona'] as string,
      lense: r['lense'] as string,
      kind: r['kind'] as EntryKind,
      text: r['text'] as string,
      ...(r['addresses'] !== undefined ? { addresses: r['addresses'] as string } : {}),
      ...(r['severity'] !== undefined ? { severity: r['severity'] as Severity } : {}),
      ...(r['severity_rationale'] !== undefined
        ? { severity_rationale: r['severity_rationale'] as string }
        : {}),
      ...(r['status'] !== undefined ? { status: r['status'] as EntryStatus } : {}),
      ...(r['dismissal_reason'] !== undefined
        ? { dismissal_reason: r['dismissal_reason'] as DismissalReason }
        : {}),
      ...(r['dismissal_note'] !== undefined
        ? { dismissal_note: r['dismissal_note'] as string }
        : {}),
      ...(r['resolved_by_commit'] !== undefined
        ? { resolved_by_commit: r['resolved_by_commit'] as string }
        : {}),
      ...(r['stages'] !== undefined
        ? { stages: r['stages'] as readonly GateStage[] }
        : {}),
    });
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      id: this.id,
      at: this.at,
      by: this.by,
      persona: this.persona,
      lense: this.lense,
      kind: this.kind,
      text: this.text,
    };
    if (this.addresses !== undefined) out['addresses'] = this.addresses;
    if (this.severity !== undefined) out['severity'] = this.severity;
    if (this.severity_rationale !== undefined)
      out['severity_rationale'] = this.severity_rationale;
    if (this.status !== undefined) out['status'] = this.status;
    if (this.dismissal_reason !== undefined)
      out['dismissal_reason'] = this.dismissal_reason;
    if (this.dismissal_note !== undefined)
      out['dismissal_note'] = this.dismissal_note;
    if (this.resolved_by_commit !== undefined)
      out['resolved_by_commit'] = this.resolved_by_commit;
    if (this.stages !== undefined) out['stages'] = this.stages.map((s) => ({ ...s }));
    return out;
  }
}
