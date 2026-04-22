// gate repair — intervention layer paired with `gate doctor`.
//
// Consumes a `gate doctor --format json` payload (from stdin or
// --from-doctor <file>) and either prints the proposed repair plan
// (default --dry-run) or executes it (--apply).
//
// The split between dry-run and apply is structural at the use-case
// level, not just a flag check inside the handler: planning is pure
// and never touches the filesystem, applying is the only path that
// invokes QuarantineStore.

import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { C, readStdin } from './internal.js';

// `gate repair` is a write verb (`--apply` can move files into
// quarantine). Strict-reject typos to prevent silent fall-through
// to dry-run when the caller intended to apply — `--aply` without
// rejection would look successful but do nothing.
const REPAIR_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'apply',
  'format',
  'from-doctor',
]);
import {
  DiagnosticFinding,
  DiagnosticArea,
  DiagnosticKind,
} from '../../../domain/diagnostic/DiagnosticReport.js';
import {
  RepairPlan,
  RepairAction,
} from '../../../domain/repair/RepairPlan.js';
import { RepairResult } from '../../../application/repair/RepairUseCases.js';

const VALID_AREAS: ReadonlySet<DiagnosticArea> = new Set([
  'members',
  'requests',
  'issues',
]);
const VALID_KINDS: ReadonlySet<DiagnosticKind> = new Set([
  'top_level_not_mapping',
  'hydration_error',
  'yaml_parse_error',
  'duplicate_id',
  'unknown',
]);

export async function repairCmd(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, REPAIR_KNOWN_FLAGS, 'repair');
  const apply = args.options['apply'] === true;
  const format = optionalOption(args, 'format') ?? 'text';
  const fromPath = optionalOption(args, 'from-doctor');

  // 1. Acquire raw doctor JSON (file > stdin)
  let rawJson: string;
  if (fromPath !== undefined) {
    try {
      rawJson = readFileSync(fromPath, 'utf8');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`error: failed to read --from-doctor file: ${msg}\n`);
      return 1;
    }
  } else if (process.stdin.isTTY) {
    process.stderr.write(
      'error: gate repair needs `gate doctor --format json` on stdin\n' +
        'usage: gate doctor --format json | gate repair [--apply]\n' +
        '       gate repair --from-doctor <path-to-doctor-json> [--apply]\n',
    );
    return 1;
  } else {
    rawJson = await readStdin();
  }

  // 2. Parse + validate findings (boundary)
  let findings: DiagnosticFinding[];
  try {
    findings = parseDoctorJson(rawJson);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`error: invalid doctor json: ${msg}\n`);
    return 1;
  }

  // 3. Plan (pure)
  const plan = c.repairUC.plan(findings);

  // 4. Either render plan (dry-run) or apply
  if (!apply) {
    if (format === 'json') {
      process.stdout.write(JSON.stringify(plan.toJSON(), null, 2) + '\n');
    } else {
      writePlanText(plan);
    }
    return plan.isEmpty ? 0 : 0; // dry-run never fails on findings
  }

  const result = await c.repairUC.apply(plan);
  if (format === 'json') {
    process.stdout.write(JSON.stringify(result.toJSON(), null, 2) + '\n');
  } else {
    writeResultText(result);
  }
  return result.hasErrors ? 1 : 0;
}

// Parses doctor's --format json output. Validates that each finding
// has the four required fields with valid enum values; rejects on
// anything unexpected so an operator can't accidentally feed in a
// hand-edited plan that smuggles in a path outside content_root.
// Exported for boundary tests (interface/parseDoctorJson.test.ts).
export function parseDoctorJson(raw: string): DiagnosticFinding[] {
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('top-level not an object');
  }
  const obj = parsed as Record<string, unknown>;
  const findingsRaw = obj['findings'];
  if (!Array.isArray(findingsRaw)) {
    throw new Error('missing or non-array `findings` field');
  }
  const out: DiagnosticFinding[] = [];
  for (let i = 0; i < findingsRaw.length; i++) {
    const f = findingsRaw[i];
    if (f === null || typeof f !== 'object') {
      throw new Error(`findings[${i}] is not an object`);
    }
    const fo = f as Record<string, unknown>;
    const area = fo['area'];
    const source = fo['source'];
    const kind = fo['kind'];
    const message = fo['message'];
    if (typeof area !== 'string' || !VALID_AREAS.has(area as DiagnosticArea)) {
      throw new Error(`findings[${i}].area invalid: ${String(area)}`);
    }
    if (typeof source !== 'string' || source.length === 0) {
      throw new Error(`findings[${i}].source missing`);
    }
    // D3 (noir devil review on req 2026-04-15-0012): the boundary must
    // refuse relative paths. doctor always emits absolutes; a
    // hand-crafted plan that smuggles in a relative path would let
    // SafeFsQuarantineStore resolve it against cwd, which could land
    // anywhere depending on where gate repair was invoked from.
    if (!isAbsolute(source)) {
      throw new Error(
        `findings[${i}].source must be an absolute path, got: ${source}`,
      );
    }
    if (typeof kind !== 'string' || !VALID_KINDS.has(kind as DiagnosticKind)) {
      throw new Error(`findings[${i}].kind invalid: ${String(kind)}`);
    }
    if (typeof message !== 'string') {
      throw new Error(`findings[${i}].message missing`);
    }
    out.push({
      area: area as DiagnosticArea,
      source,
      kind: kind as DiagnosticKind,
      message,
    });
  }
  return out;
}

function writePlanText(plan: RepairPlan): void {
  process.stdout.write('gate repair — proposed plan (dry-run)\n\n');
  if (plan.isEmpty) {
    process.stdout.write('✓ no findings, nothing to repair\n');
    return;
  }
  for (const a of plan.actions) {
    writeActionLine(a);
  }
  const s = plan.summary;
  process.stdout.write(
    `\n${s.total} action(s) — ${s.quarantine} quarantine, ${s.noOp} no-op\n` +
      'note: this is a dry-run. Re-run with --apply to execute.\n' +
      'destination scheme: <content_root>/quarantine/<ISO-timestamp>/<area>/<basename>\n' +
      '         each --apply invocation creates a fresh timestamp directory,\n' +
      '         so to undo:  mv <content_root>/quarantine/<stamp>/<area>/* <area>/\n',
  );
}

function writeActionLine(a: RepairAction): void {
  const glyph = a.kind === 'quarantine' ? '→' : '·';
  process.stdout.write(
    `  ${glyph} [${a.kind}] ${a.finding.area}/${a.finding.kind}\n` +
      `    source: ${a.finding.source}\n` +
      `    why:    ${a.rationale}\n`,
  );
}

function writeResultText(result: RepairResult): void {
  process.stdout.write('gate repair — outcomes\n\n');
  for (const o of result.outcomes) {
    let glyph = '·';
    if (o.status === 'quarantined') glyph = '✓';
    else if (o.status === 'error') glyph = '✗';
    else if (o.status === 'skipped') glyph = '○';
    process.stdout.write(
      `  ${glyph} [${o.status}] ${o.action.finding.source}\n`,
    );
    if (o.destination !== undefined) {
      process.stdout.write(`    → ${o.destination}\n`);
    }
    if (o.error !== undefined) {
      process.stdout.write(`    error: ${o.error}\n`);
    }
  }
  const s = result.summary;
  process.stdout.write(
    `\n${s.total} outcome(s) — ${s.quarantined} quarantined, ${s.skipped} skipped (already gone), ${s.noOp} no-op, ${s.error} error\n`,
  );
}
