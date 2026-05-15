/**
 * gate doctor plugin: self-loop-check
 *
 * Flags requests whose entire lifecycle was performed by a single
 * actor — "self-loop" decisions where pending → approved → executing
 * → completed (and, if applicable, a self-review) all bear the same
 * `by` field.
 *
 * Why this matters (the abyss in the 6-lense framing):
 *   gate lets any registered member approve any request, including
 *   their own. Policy-allowed, emits a stderr notice, and for a
 *   single casual self-flow `gate fast-track` is the expected form.
 *   But as agents take on more of the transitions autonomously, the
 *   pattern "agent files, agent approves, agent executes, agent
 *   reviews with own lense" quietly hollows the Two-Persona Devil
 *   frame: the record exists, but the cross-actor signal that makes
 *   it trustworthy is absent.
 *
 * The check is a DETECTOR, not an enforcer. Findings surface so
 * a human (or another agent) can ask whether the pattern is
 * intentional — they do not block any call.
 *
 * Threshold: 3+ self-loop completions in the most recent 25
 * completed-or-failed records (a window, not a time cutoff, so
 * the signal is robust to bursty sessions and quiet weeks).
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const WINDOW = 25;
const THRESHOLD = 3;

/** @param {{ root: string, contentRoot: string, paths: { requests: string } }} ctx */
export default async function selfLoopCheck(ctx) {
  const findings = [];
  const requestsRoot = ctx.paths?.requests ?? join(ctx.contentRoot, 'requests');
  if (!existsSync(requestsRoot)) return findings;

  // Terminal-state dirs: these are the only ones where a full self-
  // loop exists (the request traversed every stage). `pending` /
  // `approved` / `executing` are still in flight — flagging them
  // would race with normal workflow.
  const terminals = ['completed', 'failed'];
  const records = [];
  for (const state of terminals) {
    const dir = join(requestsRoot, state);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.yaml')) continue;
      const raw = readFileSync(join(dir, name), 'utf8');
      const parsed = parseYamlLite(raw);
      if (parsed) records.push({ parsed, source: join(dir, name) });
    }
  }

  // Newest-first so the window captures the recent surface. Sort by
  // id (YYYY-MM-DD-NNNN) — lexicographic on the composite is stable.
  records.sort((a, b) => (b.parsed.id ?? '').localeCompare(a.parsed.id ?? ''));
  const window = records.slice(0, WINDOW);

  const selfLoops = [];
  for (const r of window) {
    if (isSelfLoop(r.parsed)) selfLoops.push(r);
  }

  if (selfLoops.length >= THRESHOLD) {
    const ids = selfLoops.map((r) => r.parsed.id).slice(0, 5);
    findings.push({
      area: 'plugin',
      source: requestsRoot,
      kind: 'unknown',
      message:
        `self-loop pattern: ${selfLoops.length} of the last ${window.length} ` +
        `terminal requests were filed, approved, and executed by the same actor ` +
        `(sample ids: ${ids.join(', ')}). The Two-Persona Devil frame expects ` +
        `cross-actor signal; consider inviting another reviewer or using ` +
        `'gate fast-track' explicitly for the cases that are genuinely single-actor.`,
    });
  }

  return findings;
}

/**
 * "Self-loop" definition: every status_log `by` AND every review `by`
 * names the same single actor. A request with 0 reviews still counts
 * if the status_log is mono-actor (the reviews absence is itself a
 * signal — no second pair of eyes was ever invoked).
 *
 * Fast-tracked-and-auto-reviewed-by-author sessions will read as
 * self-loops; that's the point — they're the legitimate form of the
 * pattern we're counting. Whether 3+ such sessions in a row deserves
 * attention is the question the finding raises, not answers.
 */
function isSelfLoop(req) {
  const log = Array.isArray(req.status_log) ? req.status_log : [];
  if (log.length === 0) return false;
  const actors = new Set();
  for (const entry of log) {
    if (entry && typeof entry.by === 'string') actors.add(entry.by);
  }
  const reviews = Array.isArray(req.reviews) ? req.reviews : [];
  for (const rv of reviews) {
    if (rv && typeof rv.by === 'string') actors.add(rv.by);
  }
  return actors.size === 1;
}

/**
 * Minimal YAML extractor — enough for our fields (id, status_log[].by,
 * reviews[].by). We only need string scalars and nested-object `by`
 * fields; full YAML parsing would add a dep for a plugin that should
 * stay hermetic. Returns null on anything it can't read.
 */
function parseYamlLite(raw) {
  // The repository writes YAML via the `yaml` package in a stable
  // shape; reaching for the full parser would couple the plugin to
  // the CLI's dep tree. Instead, do a targeted scan for the fields
  // we care about. If that turns out fragile in practice, promoting
  // this to `import YAML from 'yaml'` is a one-line change.
  const idMatch = raw.match(/^id:\s*(\S+)/m);
  if (!idMatch) return null;
  const id = idMatch[1];

  const status_log = [];
  const logMatch = raw.match(/^status_log:\s*\n([\s\S]*?)(?=\n[a-z_]+:)/m);
  if (logMatch) {
    const block = logMatch[1];
    // Each entry starts with `  - state:`. Capture `by:` within the
    // entry (before the next `  - ` or end).
    const entries = block.split(/^\s*-\s*state:/m).slice(1);
    for (const entry of entries) {
      const byM = entry.match(/^\s*by:\s*(\S+)/m);
      if (byM) status_log.push({ by: byM[1] });
    }
  }

  const reviews = [];
  const revMatch = raw.match(/^reviews:\s*\n([\s\S]*?)(?=\n[a-z_]+:)/m);
  if (revMatch) {
    const block = revMatch[1];
    const entries = block.split(/^\s*-\s*by:/m).slice(1);
    for (const entry of entries) {
      // The `by` value is the first token on the split line.
      const byM = entry.match(/^\s*(\S+)/);
      if (byM) reviews.push({ by: byM[1] });
    }
  }

  return { id, status_log, reviews };
}
