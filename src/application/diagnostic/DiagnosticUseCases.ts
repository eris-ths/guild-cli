// DiagnosticUseCases — observation layer for `gate doctor`.
//
// The application layer assembles a fresh set of repositories with a
// *collecting* onMalformed callback, drives every listAll, and
// returns a DiagnosticReport. We deliberately do NOT use the shared
// container's repos: those are wired with stderr-emitting callbacks
// for normal CLI flows, and we want diagnostic to capture findings
// without spamming stderr a second time.
//
// The injector is a closure that builds three repos for a given
// onMalformed. Tests inject fakes; the production wiring uses
// GuildConfig.load(cwd, collector). This keeps the application layer
// pure (no infra import) and the production wiring a one-liner.

import { MemberRepository } from '../ports/MemberRepository.js';
import { RequestRepository } from '../ports/RequestRepository.js';
import { IssueRepository } from '../ports/IssueRepository.js';
import { OnMalformed } from '../ports/OnMalformed.js';
import { pathToFileURL } from 'node:url';
import {
  DiagnosticArea,
  DiagnosticFinding,
  DiagnosticReport,
  PluginLoadInfo,
  classifyMessage,
} from '../../domain/diagnostic/DiagnosticReport.js';

export interface DiagnosticRepoBundle {
  readonly members: MemberRepository;
  readonly requests: RequestRepository;
  readonly issues: IssueRepository;
}

export type DiagnosticRepoFactory = (
  onMalformed: OnMalformed,
) => DiagnosticRepoBundle;

/**
 * Doctor plugin interface. A plugin is an ES module that default-exports
 * a function returning additional findings. Plugins run after the
 * built-in checks and their findings are merged into the report.
 *
 * The plugin receives the config root and content root so it can
 * locate files (README, docs, etc.) relative to the project.
 */
export interface DoctorPluginContext {
  readonly root: string;
  readonly contentRoot: string;
}

export type DoctorPluginFn = (
  ctx: DoctorPluginContext,
) => Promise<DiagnosticFinding[]>;

/**
 * Verb-plugin load info, mirrored from the gate-side loader so
 * doctor can fold a verb plugin's per-path outcome into the same
 * `pluginsLoaded` + `findings (area: 'plugin')` channels doctor
 * plugins already use. Kept structural here (no import from the
 * gate side) so the application layer doesn't depend on the
 * interface layer.
 */
export interface VerbPluginDiagnostics {
  readonly pluginsLoaded: ReadonlyArray<{
    path: string;
    status: 'loaded' | 'error';
  }>;
  readonly errors: ReadonlyArray<{ path: string; reason: string }>;
}

export class DiagnosticUseCases {
  constructor(
    private readonly buildRepos: DiagnosticRepoFactory,
    private readonly pluginPaths: readonly string[] = [],
    private readonly pluginContext?: DoctorPluginContext,
    /**
     * Verb plugin load outcome (issue #36 Phase 1 step 4). Gate's
     * `main()` runs the verb-plugin loader at startup and feeds the
     * result into the container; doctor reads the result here so
     * verb plugin failures surface alongside doctor plugin failures
     * in the same report. Empty default keeps tests / non-gate
     * containers (agora / devil / ctx) unaffected.
     */
    private readonly verbPlugins: VerbPluginDiagnostics = { pluginsLoaded: [], errors: [] },
  ) {}

  async run(): Promise<DiagnosticReport> {
    // Findings accumulate across all three areas. Two invariants
    // (D1/D2 from noir devil review on req 2026-04-15-0009):
    //   - area tagging is owned by the area-bound collector closure,
    //     not by post-hoc filtering. The repo never sees an area —
    //     the collector bakes it in at construction time.
    //   - per-area count is a local delta over `findings.length`,
    //     not a filter pass. This keeps the count correct even if
    //     classifyMessage or area tagging ever drift.
    const findings: DiagnosticFinding[] = [];

    const areaCollector = (area: DiagnosticArea): OnMalformed =>
      (source: string, msg: string) =>
        findings.push({
          area,
          source,
          kind: classifyMessage(msg),
          message: msg,
        });

    // Three areas, one shape: each gets its hydration pass via
    // listAll (any malformed file → onMalformed → finding) AND a
    // directory-walk pass via listUnrecognizedFiles (anything the
    // listAll regex silently drops → finding). The unrecognized
    // walk is what closed the requests-area "bad.yaml stayed
    // invisible" gap (CHANGELOG #106); extending the same pattern
    // to issues + members closes the same class of gap there
    // (e.g. an Alice.yaml uppercase typo silently dropping the
    // member from gate list).
    const beforeMembers = findings.length;
    const memberBundle = this.buildRepos(areaCollector('members'));
    const members = await memberBundle.members.listAll();
    const memberCollector = areaCollector('members');
    for (const u of await memberBundle.members.listUnrecognizedFiles()) {
      memberCollector(u.path, `unrecognized ${u.kind}: ${u.reason}`);
    }
    const memberMalformed = findings.length - beforeMembers;

    const beforeRequests = findings.length;
    const requestBundle = this.buildRepos(areaCollector('requests'));
    const requests = await requestBundle.requests.listAll();
    const requestCollector = areaCollector('requests');
    for (const u of await requestBundle.requests.listUnrecognizedFiles()) {
      requestCollector(u.path, `unrecognized ${u.kind}: ${u.reason}`);
    }
    const requestMalformed = findings.length - beforeRequests;

    const beforeIssues = findings.length;
    const issueBundle = this.buildRepos(areaCollector('issues'));
    const issues = await issueBundle.issues.listAll();
    const issueCollector = areaCollector('issues');
    for (const u of await issueBundle.issues.listUnrecognizedFiles()) {
      issueCollector(u.path, `unrecognized ${u.kind}: ${u.reason}`);
    }
    const issueMalformed = findings.length - beforeIssues;

    // Run doctor plugins (if any). Track each path's outcome so the
    // doctor report can surface "what ran" at runtime — operators
    // shouldn't have to read SECURITY.md to know a plugin executed.
    //
    // Convert filesystem paths to file:// URLs before dynamic import.
    // Linux/Mac tolerate `await import('/abs/path.mjs')`, but Node's
    // ESM loader on Windows rejects bare absolute paths (treats `C:`
    // as an unknown scheme). pathToFileURL handles both platforms;
    // the cost on Linux is one extra wrap per plugin per doctor run.
    const pluginsLoaded: PluginLoadInfo[] = [];
    if (this.pluginPaths.length > 0 && this.pluginContext) {
      for (const pluginPath of this.pluginPaths) {
        try {
          const mod = await import(pathToFileURL(pluginPath).href);
          const fn: DoctorPluginFn = mod.default ?? mod;
          if (typeof fn === 'function') {
            const pluginFindings = await fn(this.pluginContext);
            findings.push(...pluginFindings);
            pluginsLoaded.push({ path: pluginPath, status: 'loaded' });
          } else {
            // default export wasn't callable — surface as both a
            // finding (with the diagnostic detail) and a plugins_loaded
            // entry (so the path is visible in the runtime list).
            findings.push({
              area: 'plugin',
              source: pluginPath,
              kind: 'unknown',
              message: `plugin error: default export is not a function`,
            });
            pluginsLoaded.push({ path: pluginPath, status: 'error' });
          }
        } catch (e) {
          // Plugin errors become findings, never crash doctor
          findings.push({
            area: 'plugin',
            source: pluginPath,
            kind: 'unknown',
            message: `plugin error: ${e instanceof Error ? e.message : String(e)}`,
          });
          pluginsLoaded.push({ path: pluginPath, status: 'error' });
        }
      }
    }

    // Verb plugin diagnostics (#36 Phase 1 step 4). Loader-supplied
    // errors become findings under area='plugin' (same kind as
    // doctor plugin errors); per-path outcomes are appended to the
    // pluginsLoaded list so a single plugins-loaded section in the
    // doctor renderer covers both kinds. The path differentiator is
    // sufficient — doctor plugins are filesystem paths under root,
    // verb plugins are too, and any path-shaped string is a path
    // for display purposes.
    // Caller (`buildContainer` for the gate entry) prefixes the
    // reason with the plugin kind ("verb plugin: ..." / "hook
    // plugin: ...") before passing in, so this layer doesn't need
    // to discriminate. Keeping the formatting at the wiring layer
    // means future plugin kinds (transforms, etc.) only need to
    // rename their own prefix without revisiting the diagnostic
    // domain.
    for (const e of this.verbPlugins.errors) {
      findings.push({
        area: 'plugin',
        source: e.path,
        kind: 'unknown',
        message: e.reason,
      });
    }
    const allPluginsLoaded: PluginLoadInfo[] = [
      ...pluginsLoaded,
      ...this.verbPlugins.pluginsLoaded,
    ];
    return new DiagnosticReport(
      {
        members: { total: members.length, malformed: memberMalformed },
        requests: { total: requests.length, malformed: requestMalformed },
        issues: { total: issues.length, malformed: issueMalformed },
      },
      findings,
      allPluginsLoaded,
    );
  }
}
