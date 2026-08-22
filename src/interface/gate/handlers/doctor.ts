import { promises as fs } from 'node:fs';
import { join, basename } from 'node:path';
import { parseFormat } from '../../shared/parseFormat.js';
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
import {
  TrapDescriptor,
  TrapPlanEntry,
  extractFrontmatterField,
  parseRelevantUntil,
  planTrapSweep,
} from '../../../application/trapSweep/TrapSweepUseCases.js';

// `gate doctor` is read-only but still benefits from strict-reject:
// `--summry` or `--formt json` typos would silently fall through to
// defaults, giving the caller an unfiltered report when they asked
// for the summary view. Consistent with tail's rationale.
const DOCTOR_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'format',
  'summary',
]);

// `gate doctor sweep-traps` is the trap-memory retirement verb (#327).
// Strict-reject typos for the same reason as the parent: `--aply`
// would silently fall through to dry-run. `--apply` is boolean (no
// value); `--revive` takes a trap filename. `--format` lets json
// consumers (orchestrators, CI pipelines) read the plan/result envelope.
const SWEEP_TRAPS_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'apply',
  'revive',
  'format',
]);
const SWEEP_TRAPS_BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['apply']);

// Trap memory lives at <content_root>/lore/traps/. Quarantine and the
// audit log live at content_root root (`trap-quarantine/` and
// `trap-retirement-log.yaml`) so the operator sees both surfaces in a
// single `ls` of the substrate root.
const TRAP_DIR_REL = join('lore', 'traps');
const QUARANTINE_DIR_REL = 'trap-quarantine';
const RETIREMENT_LOG_REL = 'trap-retirement-log.yaml';

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
//
// Sub-verb (#327):
//   gate doctor sweep-traps [--apply] [--revive <name>] [--format json]
//     Trap-memory retirement. Without --apply: dry-run lists what
//     would be swept. With --apply: moves expired traps to
//     <content_root>/trap-quarantine/ and appends an audit entry to
//     <content_root>/trap-retirement-log.yaml. With --revive <name>:
//     restores a quarantined trap to its original location and
//     records a revive entry in the same log.

export async function doctorCmd(c: C, args: ParsedArgs): Promise<number> {
  // Sub-verb dispatch. The sub-verb takes ownership of flag rejection
  // so its private flag set doesn't leak into the read-only doctor
  // strict check.
  if (args.positional[0] === 'sweep-traps') {
    return await sweepTrapsCmd(c, args);
  }
  rejectUnknownFlags(args, DOCTOR_KNOWN_FLAGS, 'doctor');
  const format = parseFormat(args);
  const report = await c.diagnosticUC.run();
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
    // The text/summary surfaces disclose the resolved content root
    // conditionally (only when surprising — see
    // formatContentRootDisclosure below). JSON consumers have no such
    // notion of "surprising": an orchestrator reading the envelope
    // needs to know WHICH root produced these numbers every time, so
    // both fields are unconditional here. `config_file` is null when
    // no guild.config.yaml was found and cwd was used as the fallback
    // root. Additive — `gate repair` and other consumers ignore
    // unknown keys (POLICY.md json compatibility).
    process.stdout.write(
      JSON.stringify(
        {
          ...(report.toJSON() as object),
          content_root: c.config.contentRoot,
          config_file: c.config.configFile,
        },
        null,
        2,
      ) + '\n',
    );
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
  // plugins_loaded: surfaces "what ran" at runtime so an operator can
  // see that a doctor.trusted plugin executed, even if SECURITY.md is
  // unread. Stays quiet when no plugins were configured (the 99%
  // normal case) — see lore/principles/09-orientation-disclosure.md.
  if (report.pluginsLoaded.length > 0) {
    process.stdout.write(
      `\nplugins loaded: ${report.pluginsLoaded.length}\n`,
    );
    for (const p of report.pluginsLoaded) {
      const glyph = p.status === 'loaded' ? '✓' : '✗';
      process.stdout.write(`    ${glyph} [${p.status}] ${p.path}\n`);
    }
  }
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

// --- sweep-traps sub-verb (#327) --------------------------------------

/**
 * `gate doctor sweep-traps` handler. Three modes:
 *
 *   --revive <filename>       restore a quarantined trap and log it
 *   --apply                   move expired traps to quarantine + log
 *   (neither)                 dry-run plan (default; safe to script)
 *
 * `--apply` and `--revive` are mutually exclusive: one is a sweep
 * direction, the other its inverse, and combining them would have no
 * coherent meaning.
 *
 * Mutability is intentionally narrow: only `<content_root>/lore/traps/`,
 * `<content_root>/trap-quarantine/`, and `<content_root>/trap-retirement-log.yaml`
 * are touched. Everything else under content_root is read-only from
 * this verb.
 */
async function sweepTrapsCmd(c: C, args: ParsedArgs): Promise<number> {
  // Re-parse args so the sweep-only boolean flag (`--apply`) is
  // recognised — the top-level parseArgs already ran with the gate-
  // global boolean set, but `apply` is in KNOWN_BOOLEAN_FLAGS so it
  // already lands as `true`. We only need rejectUnknownFlags here to
  // gate against typos. The first positional (`sweep-traps`) is
  // expected and not flagged as unknown.
  rejectUnknownFlags(args, SWEEP_TRAPS_KNOWN_FLAGS, 'doctor sweep-traps');
  // Belt-and-braces against future parser changes: SWEEP_TRAPS_BOOLEAN_FLAGS
  // documents which flags are boolean even though the global
  // KNOWN_BOOLEAN_FLAGS already covers `apply`. Reading it keeps the
  // documentation honest without changing behaviour.
  void SWEEP_TRAPS_BOOLEAN_FLAGS;

  const apply = args.options['apply'] === true;
  const revive = optionalOption(args, 'revive');
  const format = parseFormat(args);
  if (apply && revive !== undefined) {
    process.stderr.write(
      'error: --apply and --revive are mutually exclusive.\n' +
        '  next: drop --apply (revive is its own write path) or pick one mode.\n',
    );
    return 1;
  }

  const trapDir = join(c.config.contentRoot, TRAP_DIR_REL);
  const quarantineDir = join(c.config.contentRoot, QUARANTINE_DIR_REL);
  const logPath = join(c.config.contentRoot, RETIREMENT_LOG_REL);

  if (revive !== undefined) {
    return await reviveTrap({
      revive,
      trapDir,
      quarantineDir,
      logPath,
      format,
    });
  }

  // Plan path: scan trap dir, parse frontmatter, build descriptors.
  let descriptors: TrapDescriptor[];
  try {
    descriptors = await loadTrapDescriptors(trapDir);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`error: failed to scan ${trapDir}: ${msg}\n`);
    return 1;
  }
  const plan = planTrapSweep(new Date(), descriptors);

  if (!apply) {
    if (format === 'json') {
      process.stdout.write(JSON.stringify(planToJson(plan.entries), null, 2) + '\n');
    } else {
      writeSweepPlanText(plan.entries, trapDir);
    }
    return 0;
  }

  // Apply path: walk the sweep set, move each file, append one log
  // entry per move. Errors on individual entries do not abort the
  // run — each outcome carries its own status, mirroring `gate repair`.
  const sweeps = plan.entries.filter((e) => e.action === 'sweep');
  if (sweeps.length === 0) {
    if (format === 'json') {
      process.stdout.write(
        JSON.stringify({ applied: [], skipped: planToJson(plan.entries) }, null, 2) + '\n',
      );
    } else {
      process.stdout.write('gate doctor sweep-traps — apply\n\n');
      process.stdout.write('✓ no expired traps; nothing to sweep.\n');
    }
    return 0;
  }
  await fs.mkdir(quarantineDir, { recursive: true });
  const applied: Array<{ trap: string; destination: string; reason: string }> = [];
  const errors: Array<{ trap: string; error: string }> = [];
  for (const entry of sweeps) {
    const dest = join(quarantineDir, entry.trap.filename);
    try {
      await fs.rename(entry.trap.absolutePath, dest);
      await appendLogEntry(logPath, {
        action: 'quarantine',
        trap: entry.trap.filename,
        at: nowIsoZ(),
        by: resolveActorForLog(),
        reason: entry.rationale,
      });
      applied.push({
        trap: entry.trap.filename,
        destination: dest,
        reason: entry.rationale,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ trap: entry.trap.filename, error: msg });
    }
  }

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify({ applied, errors }, null, 2) + '\n',
    );
  } else {
    process.stdout.write('gate doctor sweep-traps — apply\n\n');
    for (const a of applied) {
      process.stdout.write(`  → quarantined ${a.trap}\n    reason: ${a.reason}\n`);
    }
    for (const e of errors) {
      process.stdout.write(`  ✗ ${e.trap}: ${e.error}\n`);
    }
    process.stdout.write(
      `\n${applied.length} trap(s) quarantined under ${quarantineDir}\n` +
        `audit log: ${logPath}\n` +
        (errors.length > 0
          ? `${errors.length} error(s) — exit 1\n`
          : ''),
    );
  }
  return errors.length > 0 ? 1 : 0;
}

async function reviveTrap(p: {
  revive: string;
  trapDir: string;
  quarantineDir: string;
  logPath: string;
  format: string;
}): Promise<number> {
  // Restrict --revive to a bare filename (no path components). Lets
  // the operator type the same string they saw in the dry-run output
  // without shell-completing into a relative path that could escape
  // the quarantine dir.
  if (p.revive.includes('/') || p.revive.includes('\\') || p.revive === '..' || p.revive === '.') {
    process.stderr.write(
      `error: --revive expects a bare filename, got: ${p.revive}\n` +
        '  next: pass just the basename (e.g. trap_silent_fallback_loses_signal.md).\n',
    );
    return 1;
  }
  const src = join(p.quarantineDir, p.revive);
  const dest = join(p.trapDir, p.revive);
  try {
    const stat = await fs.stat(src);
    if (!stat.isFile()) {
      process.stderr.write(
        `error: ${src} is not a file (expected a quarantined trap).\n`,
      );
      return 1;
    }
  } catch {
    process.stderr.write(
      `error: no quarantined trap named ${p.revive} under ${p.quarantineDir}.\n` +
        '  next: ls the directory to see what is available for revive.\n',
    );
    return 1;
  }
  await fs.mkdir(p.trapDir, { recursive: true });
  // Refuse to overwrite a same-named live trap — revive is a restore,
  // not a force-replace. The operator should resolve the conflict
  // explicitly (rename one, choose which to keep).
  try {
    await fs.access(dest);
    process.stderr.write(
      `error: a live trap named ${p.revive} already exists at ${dest}.\n` +
        '  next: rename or remove the conflicting file before reviving.\n',
    );
    return 1;
  } catch {
    // good — destination is free
  }
  try {
    await fs.rename(src, dest);
    await appendLogEntry(p.logPath, {
      action: 'revive',
      trap: p.revive,
      at: nowIsoZ(),
      by: resolveActorForLog(),
      reason: 'manual revive via gate doctor sweep-traps --revive',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`error: revive failed: ${msg}\n`);
    return 1;
  }
  if (p.format === 'json') {
    process.stdout.write(
      JSON.stringify({ revived: p.revive, destination: dest, log: p.logPath }, null, 2) + '\n',
    );
  } else {
    process.stdout.write(
      `gate doctor sweep-traps — revive\n\n` +
        `  ← restored ${p.revive}\n` +
        `    to: ${dest}\n` +
        `audit log: ${p.logPath}\n`,
    );
  }
  return 0;
}

async function loadTrapDescriptors(trapDir: string): Promise<TrapDescriptor[]> {
  let names: string[];
  try {
    names = await fs.readdir(trapDir);
  } catch (e) {
    if (
      e !== null &&
      typeof e === 'object' &&
      'code' in e &&
      (e as { code: string }).code === 'ENOENT'
    ) {
      // No trap directory: treat as zero traps. Sweep is a no-op,
      // not an error — fresh content_roots haven't pinned anything yet.
      return [];
    }
    throw e;
  }
  const out: TrapDescriptor[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.md')) continue;
    if (!name.startsWith('trap_')) continue;
    const abs = join(trapDir, name);
    let raw: string;
    try {
      raw = await fs.readFile(abs, 'utf8');
    } catch {
      continue;
    }
    const rawValue = extractFrontmatterField(raw, 'relevant_until');
    const relevantUntil = parseRelevantUntil(rawValue);
    out.push({
      filename: name,
      absolutePath: abs,
      relevantUntil,
      rawValue,
    });
  }
  return out;
}

function planToJson(entries: readonly TrapPlanEntry[]): unknown {
  return entries.map((e) => ({
    trap: e.trap.filename,
    action: e.action,
    rationale: e.rationale,
    relevant_until: e.trap.rawValue,
  }));
}

function writeSweepPlanText(
  entries: readonly TrapPlanEntry[],
  trapDir: string,
): void {
  process.stdout.write('gate doctor sweep-traps — proposed plan (dry-run)\n\n');
  if (entries.length === 0) {
    process.stdout.write(`✓ no traps under ${trapDir}\n`);
    return;
  }
  let sweepCount = 0;
  let keptInvalid = 0;
  for (const e of entries) {
    let glyph = '·';
    if (e.action === 'sweep') {
      glyph = '→';
      sweepCount++;
    } else if (e.action === 'keep-invalid') {
      glyph = '?';
      keptInvalid++;
    }
    process.stdout.write(
      `  ${glyph} [${e.action}] ${e.trap.filename}\n` +
        `    why: ${e.rationale}\n`,
    );
  }
  process.stdout.write(
    `\n${entries.length} trap(s) — ${sweepCount} would be swept, ${keptInvalid} kept (invalid value)\n` +
      'note: this is a dry-run. Re-run with --apply to quarantine.\n' +
      '      revive a trap later with --revive <filename>.\n',
  );
}

/**
 * Append one event entry to the trap-retirement audit log. The file is
 * a single YAML document with a top-level `events:` list; we append a
 * line per event without ever rewriting earlier entries (principle 04 —
 * records outlive writers, and the log is one of the records).
 *
 * Byte-stable shape: each entry is a fixed five-key block in the same
 * order, two-space indent, single quoted reason. Keeps the file diff-
 * friendly across runs by different tools.
 */
async function appendLogEntry(
  logPath: string,
  entry: {
    action: 'quarantine' | 'revive';
    trap: string;
    at: string;
    by: string;
    reason: string;
  },
): Promise<void> {
  let header = '';
  try {
    await fs.access(logPath);
  } catch {
    header = 'events:\n';
  }
  const lines = [
    `  - action: ${entry.action}`,
    `    trap: ${entry.trap}`,
    `    at: ${entry.at}`,
    `    by: ${entry.by}`,
    // YAML double-quoted scalar with backslash escapes for embedded
    // quotes / backslashes — keeps the value round-trip-safe even
    // when a reason carries a relevant_until string with a colon.
    `    reason: ${yamlDoubleQuoted(entry.reason)}`,
  ].join('\n');
  await fs.appendFile(logPath, `${header}${lines}\n`, 'utf8');
}

function yamlDoubleQuoted(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function nowIsoZ(): string {
  // Trim ms for compactness — the audit log is human-read first.
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function resolveActorForLog(): string {
  const env = process.env['GUILD_ACTOR'];
  if (env && env.length > 0) return env;
  return 'unknown';
}

// Re-export for tests
export {
  TRAP_DIR_REL,
  QUARANTINE_DIR_REL,
  RETIREMENT_LOG_REL,
  loadTrapDescriptors,
  appendLogEntry,
  basename as _basename,
};
