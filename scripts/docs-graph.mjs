#!/usr/bin/env node
// docs-graph — repository markdown link graph (in/out/orphan/broken).
//
// Walks the repo's curated markdown set (lore/, docs/, examples/, top-level
// *.md, src/passages/*/README.md) and reports:
//   - out-edges per file (what each doc links to)
//   - in-edges per file (backlinks)
//   - orphans (in-degree 0)
//   - broken (link target does not exist)
//
// Usage:
//   node scripts/docs-graph.mjs [--format text|json] [--root <path>]
//
// Principle 03 (legibility costs) acknowledges the gravity of records.
// This tool makes the gravity visible so reorganization becomes a
// numerically-grounded decision rather than a leap.

import { readFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, relative, dirname, join } from 'node:path';

const args = process.argv.slice(2);
const FORMAT = (args.find((a, i) => args[i - 1] === '--format') ?? 'text');
const ROOT = resolve(args.find((a, i) => args[i - 1] === '--root') ?? process.cwd());

const INCLUDE_DIRS = ['lore', 'docs', 'examples'];
const ROOT_FILES = ['README.md', 'README.ja.md', 'AGENT.md', 'CLAUDE.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md'];
const PASSAGE_README = ['src/passages/gate/README.md', 'src/passages/agora/README.md', 'src/passages/devil/README.md', 'src/passages/ctx/README.md'];
const EXCLUDE_DIR_PATTERNS = [/node_modules/, /\/dist(\/|$)/, /\/\.git(\/|$)/, /\.claude\/worktrees/];

function listMarkdown() {
  const files = new Set();
  for (const f of ROOT_FILES) {
    const p = join(ROOT, f);
    if (exists(p)) files.add(p);
  }
  for (const d of INCLUDE_DIRS) walk(join(ROOT, d), files);
  for (const f of PASSAGE_README) {
    const p = join(ROOT, f);
    if (exists(p)) files.add(p);
  }
  return [...files].sort();
}

function walk(dir, acc) {
  if (!exists(dir)) return;
  if (EXCLUDE_DIR_PATTERNS.some((re) => re.test(dir))) return;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (EXCLUDE_DIR_PATTERNS.some((re) => re.test(p))) continue;
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.isFile() && p.endsWith('.md')) acc.add(p);
  }
}

function exists(p) {
  try { statSync(p); return true; } catch { return false; }
}

// (?<![!]) excludes image alts ![alt](src). Capture text + url.
const LINK_RE = /(?<![!])\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function isExternal(url) {
  return /^(https?:|mailto:|tel:)/i.test(url) || url.startsWith('//');
}

function parseLinks(file, body) {
  const out = [];
  for (const m of body.matchAll(LINK_RE)) {
    const url = m[2];
    if (!url || isExternal(url)) continue;
    if (url.startsWith('#')) continue; // intra-doc anchor only
    const [pathPart, anchor] = url.split('#');
    if (!pathPart.endsWith('.md') && !pathPart.endsWith('/')) continue;
    const target = resolve(dirname(file), pathPart);
    out.push({ url, target, anchor: anchor ?? null, label: m[1] });
  }
  return out;
}

function build() {
  const files = listMarkdown();
  const fileSet = new Set(files);
  const out = new Map(files.map((f) => [f, []]));
  const inn = new Map(files.map((f) => [f, []]));
  const broken = [];

  for (const f of files) {
    const body = readFileSync(f, 'utf8');
    const links = parseLinks(f, body);
    for (const l of links) {
      let target = l.target;
      // Allow trailing slash → directory README.md
      if (target.endsWith('/')) target = join(target, 'README.md');
      const ok = exists(target);
      const tracked = fileSet.has(target);
      if (!ok) {
        broken.push({ from: f, url: l.url, target, reason: 'missing' });
        continue;
      }
      if (tracked) {
        out.get(f).push({ to: target, anchor: l.anchor, label: l.label });
        inn.get(target).push({ from: f, anchor: l.anchor, label: l.label });
      } else {
        // exists but outside curated set — track as informational only
        out.get(f).push({ to: target, anchor: l.anchor, label: l.label, untracked: true });
      }
    }
  }

  return { files, out, inn, broken };
}

function rel(p) { return relative(ROOT, p) || '.'; }

function reportText(g) {
  const { files, out, inn, broken } = g;
  const lines = [];
  lines.push(`docs-graph — root: ${ROOT}`);
  lines.push(`tracked files: ${files.length}`);
  lines.push('');

  // Top in-degree
  const ranked = files
    .map((f) => ({ f, inDeg: inn.get(f).length, outDeg: out.get(f).filter((e) => !e.untracked).length }))
    .sort((a, b) => b.inDeg - a.inDeg);

  lines.push('## Top in-degree (most-referenced — touch with care)');
  for (const r of ranked.slice(0, 10)) {
    if (r.inDeg === 0) break;
    lines.push(`  ${String(r.inDeg).padStart(3)} ← ${rel(r.f)}`);
  }
  lines.push('');

  // Orphans (no in-edges, excluding the root entrypoints which are expected to be roots)
  const ROOTS = new Set(ROOT_FILES.map((f) => join(ROOT, f)));
  const orphans = ranked.filter((r) => r.inDeg === 0 && !ROOTS.has(r.f));
  lines.push(`## Orphans (in-degree 0, ${orphans.length})  — candidates for delete or link-in`);
  for (const r of orphans) lines.push(`  ${rel(r.f)}  (out=${r.outDeg})`);
  lines.push('');

  // Broken
  lines.push(`## Broken links (${broken.length})`);
  for (const b of broken) lines.push(`  ${rel(b.from)} → ${b.url}  [${b.reason}]`);
  lines.push('');

  // Out-degree leaders
  lines.push('## Top out-degree (hubs — high split impact)');
  const byOut = [...ranked].sort((a, b) => b.outDeg - a.outDeg).slice(0, 10);
  for (const r of byOut) {
    if (r.outDeg === 0) break;
    lines.push(`  ${String(r.outDeg).padStart(3)} → ${rel(r.f)}`);
  }
  return lines.join('\n');
}

function reportJson(g) {
  const nodes = g.files.map((f) => ({
    file: rel(f),
    in_degree: g.inn.get(f).length,
    out_degree: g.out.get(f).filter((e) => !e.untracked).length,
  }));
  const edges = [];
  for (const [from, list] of g.out) {
    for (const e of list) {
      if (e.untracked) continue;
      edges.push({ from: rel(from), to: rel(e.to), anchor: e.anchor, label: e.label });
    }
  }
  return JSON.stringify({
    root: ROOT,
    nodes,
    edges,
    broken: g.broken.map((b) => ({ from: rel(b.from), url: b.url, target: rel(b.target), reason: b.reason })),
  }, null, 2);
}

const graph = build();
console.log(FORMAT === 'json' ? reportJson(graph) : reportText(graph));
