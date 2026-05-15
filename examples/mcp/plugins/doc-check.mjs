/**
 * gate doctor plugin: doc-check
 *
 * Verifies that README.md and docs/verbs.md mention all verbs
 * that appear in `gate --help` output. Catches documentation
 * drift after adding new CLI commands.
 *
 * This is a THS-origin plugin — useful for any guild-cli fork
 * that maintains documentation alongside the CLI.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** @param {{ root: string, contentRoot: string }} ctx */
export default async function docCheck(ctx) {
  const findings = [];
  const root = ctx.root;

  // 1. Extract verbs from gate help string (built HELP constant)
  //    Parse the index.ts or the --help output pattern
  const readmePath = join(root, 'README.md');
  const verbsDocPath = join(root, 'docs', 'verbs.md');
  const helpPath = join(root, 'src', 'interface', 'gate', 'index.ts');

  if (!existsSync(helpPath)) {
    // Not a guild-cli source tree — skip silently
    return findings;
  }

  // Extract verb names from the switch cases in index.ts
  const indexSrc = readFileSync(helpPath, 'utf8');
  const verbMatches = indexSrc.matchAll(/case '([a-z-]+)':/g);
  const cliVerbs = new Set([...verbMatches].map((m) => m[1]));

  // 2. Check README mentions each verb
  if (existsSync(readmePath)) {
    const readme = readFileSync(readmePath, 'utf8');
    for (const verb of cliVerbs) {
      const pattern = `gate ${verb}`;
      if (!readme.includes(pattern)) {
        findings.push({
          area: 'plugin',
          source: readmePath,
          kind: 'hydration_error', // reuse existing kind
          message: `README.md does not mention 'gate ${verb}'`,
        });
      }
    }
  }

  // 3. Check docs/verbs.md mentions each non-trivial verb
  //    (skip simple state transitions that don't need deep-dive docs)
  const skipInVerbs = new Set([
    'approve', 'deny', 'execute', 'complete', 'fail',
    'request', 'list', 'pending', 'show',
  ]);
  if (existsSync(verbsDocPath)) {
    const verbsDoc = readFileSync(verbsDocPath, 'utf8');
    for (const verb of cliVerbs) {
      if (skipInVerbs.has(verb)) continue;
      const pattern = `gate ${verb}`;
      // Also check for section headers mentioning the verb
      const hasSection = verbsDoc.includes(pattern) ||
        verbsDoc.toLowerCase().includes(verb.replace('-', ''));
      if (!hasSection) {
        findings.push({
          area: 'plugin',
          source: verbsDocPath,
          kind: 'hydration_error',
          message: `docs/verbs.md does not document 'gate ${verb}'`,
        });
      }
    }
  }

  // 4. Check CHANGELOG mentions current unreleased changes
  //    (light check: just verify [Unreleased] section exists and is non-empty)
  const changelogPath = join(root, 'CHANGELOG.md');
  if (existsSync(changelogPath)) {
    const changelog = readFileSync(changelogPath, 'utf8');
    const unreleasedMatch = changelog.match(/## \[Unreleased\]\s*\n([\s\S]*?)(?=\n## \[|$)/);
    if (unreleasedMatch && unreleasedMatch[1].trim().length === 0) {
      findings.push({
        area: 'plugin',
        source: changelogPath,
        kind: 'unknown',
        message: 'CHANGELOG.md [Unreleased] section is empty — changes may be undocumented',
      });
    }
  }

  return findings;
}
