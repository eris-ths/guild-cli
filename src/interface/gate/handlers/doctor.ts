import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import {
  C,
  formatContentRootDisclosure,
  warnIfMisconfiguredCwd,
} from './internal.js';
import {
  DiagnosticReport,
  DiagnosticAreaSummary,
  DiagnosticFinding,
} from '../../../domain/diagnostic/DiagnosticReport.js';

// `gate doctor` is read-only but still benefits from strict-reject:
// `--summry` or `--formt json` typos would silently fall through to
// defaults, giving the caller an unfiltered report when they asked
// for the summary view. Consistent with tail's rationale.
const DOCTOR_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'format',
  'summary',
]);

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
  rejectUnknownFlags(args, DOCTOR_KNOWN_FLAGS, 'doctor');
  const report = await c.diagnosticUC.run();
  const format = optionalOption(args, 'format') ?? 'text';
  const summaryOnly =
    args.options['summary'] === true || args.positional[0] === 'summary';

  // "0 of everything" + no config = the user is in the wrong cwd, not
  // running an unusually thorough fresh-start audit. Same gate as
  // `gate boot`'s misconfigured_cwd hint, surfaced via stderr so the
  // `--format json | gate repair` pipeline still parses cleanly.
  const totals =
    report.summary.members.total +
    report.summary.requests.total +
    report.summary.issues.total;
  warnIfMisconfiguredCwd(c, totals === 0);

  if (format === 'json') {
    process.stdout.write(JSON.stringify(report.toJSON(), null, 2) + '\n');
    return report.isClean ? 0 : 1;
  }

  if (summaryOnly) {
    const disclosure = formatContentRootDisclosure(
      c.config,
      process.cwd(),
    );
    if (disclosure !== null && totals > 0) {
      process.stdout.write(`${disclosure}\n`);
    }
    writeSummaryLine('members', report.summary.members);
    writeSummaryLine('requests', report.summary.requests);
    writeSummaryLine('issues', report.summary.issues);
    writeOverall(report);
    return report.isClean ? 0 : 1;
  }

  // text (default)
  process.stdout.write('gate doctor — content root health\n\n');
  // Surface the resolved content_root + config when surprising —
  // same trigger and phrasing as PR #110's boot-text disclosure
  // and PR #108's register notice. The 99% normal run (cwd ===
  // content_root, config present) stays quiet. Suppressed when
  // totals === 0 because the bigger misconfigured-cwd warning
  // (warnIfMisconfiguredCwd above) already discloses verbosely
  // in that case — keeps disclosure to exactly one surface at a
  // time. See lore/principles/09-orientation-disclosure.md.
  const disclosure = formatContentRootDisclosure(
    c.config,
    process.cwd(),
  );
  if (disclosure !== null && totals > 0) {
    process.stdout.write(`${disclosure}\n\n`);
  }
  writeAreaSection('members', report.summary.members, report.findings);
  writeAreaSection('requests', report.summary.requests, report.findings);
  writeAreaSection('issues', report.summary.issues, report.findings);
  // Plugin findings (area = 'plugin')
  const pluginFindings = report.findings.filter((f) => f.area === 'plugin');
  if (pluginFindings.length > 0) {
    process.stdout.write(`\nplugins: ${pluginFindings.length} finding(s)\n`);
    for (const f of pluginFindings) {
      process.stdout.write(`    [${f.kind}] ${f.source}\n`);
      process.stdout.write(`      ${f.message}\n`);
    }
  }
  writeOverall(report);
  if (!report.isClean) {
    process.stdout.write(
      '\nnote: `gate doctor` is read-only (observation layer).\n' +
        'To act on findings, pipe to `gate repair` (intervention layer):\n' +
        '  gate doctor --format json | gate repair          # dry-run plan\n' +
        '  gate doctor --format json | gate repair --apply  # quarantine\n',
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
    process.stdout.write(`    [${f.kind}] ${f.source}\n`);
    process.stdout.write(`      ${f.message}\n`);
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
