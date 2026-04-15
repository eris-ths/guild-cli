import { ParsedArgs, optionalOption } from '../../shared/parseArgs.js';
import { C } from './internal.js';
import {
  DiagnosticReport,
  DiagnosticAreaSummary,
  DiagnosticFinding,
} from '../../../domain/diagnostic/DiagnosticReport.js';

// gate doctor — read-only diagnostic over the guild content root.
//
// Returns 0 if the report is clean, 1 if any finding is present.
// Three formats:
//   text     (default) — human-readable per-area summary + findings list
//   summary  (--summary) — one-line per area, no per-finding detail
//   json     (--format json) — DiagnosticReport.toJSON for machine
//                              consumption (future `gate repair` input)
//
// Repair is intentionally a separate verb (not yet implemented).
// See i-2026-04-15-0015 narrative and the silent_fail_taxonomy
// principle of separating observation from intervention.

export async function doctorCmd(c: C, args: ParsedArgs): Promise<number> {
  const report = await c.diagnosticUC.run();
  const format = optionalOption(args, 'format') ?? 'text';
  const summaryOnly =
    args.options['summary'] === true || args.positional[0] === 'summary';

  if (format === 'json') {
    process.stdout.write(JSON.stringify(report.toJSON(), null, 2) + '\n');
    return report.isClean ? 0 : 1;
  }

  if (summaryOnly) {
    writeSummaryLine('members', report.summary.members);
    writeSummaryLine('requests', report.summary.requests);
    writeSummaryLine('issues', report.summary.issues);
    writeOverall(report);
    return report.isClean ? 0 : 1;
  }

  // text (default)
  process.stdout.write('gate doctor — content root health\n\n');
  writeAreaSection('members', report.summary.members, report.findings);
  writeAreaSection('requests', report.summary.requests, report.findings);
  writeAreaSection('issues', report.summary.issues, report.findings);
  writeOverall(report);
  if (!report.isClean) {
    process.stdout.write(
      '\nnote: `gate doctor` is read-only. A future `gate repair`\n' +
        'verb will consume `gate doctor --format json` to drive fixes.\n' +
        'For now, inspect the offending YAML files manually.\n',
    );
  }
  return report.isClean ? 0 : 1;
}

function writeSummaryLine(
  area: string,
  s: DiagnosticAreaSummary,
): void {
  const glyph = s.malformed === 0 ? '✓' : '✗';
  process.stdout.write(
    `${glyph} ${area.padEnd(9)} ${s.total} total, ${s.malformed} malformed\n`,
  );
}

function writeAreaSection(
  area: 'members' | 'requests' | 'issues',
  s: DiagnosticAreaSummary,
  findings: readonly DiagnosticFinding[],
): void {
  writeSummaryLine(area, s);
  const local = findings.filter((f) => f.area === area);
  for (const f of local) {
    process.stdout.write(`    [${f.kind}] ${f.message}\n`);
  }
}

function writeOverall(report: DiagnosticReport): void {
  process.stdout.write('\n');
  if (report.isClean) {
    process.stdout.write('✓ clean — no malformed records detected\n');
  } else {
    process.stdout.write(
      `✗ ${report.findings.length} finding(s) — exit 1\n`,
    );
  }
}
