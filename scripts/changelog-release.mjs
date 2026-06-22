#!/usr/bin/env node
// scripts/changelog-release.mjs <version>
//
// Collect fragments under `.changelog/next/`, group by category,
// and rewrite `CHANGELOG.md`'s `## [Unreleased]` block as
// `## [<version>] - <YYYY-MM-DD>` with the collected entries.
//
// Why this exists: per-PR fragments make concurrent PRs textual-
// conflict-free (each PR drops a unique filename). At release time
// the prose form is reconstructed mechanically — no humans have to
// remember which sub-section a bullet belongs to.
//
// Usage:
//   node scripts/changelog-release.mjs 0.6.0
//   node scripts/changelog-release.mjs 0.6.0 --dry-run     # preview only
//
// Zero deps. Run from repo root.

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  statSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const FRAG_DIR = join(ROOT, '.changelog', 'next');
const CHANGELOG = join(ROOT, 'CHANGELOG.md');
const PKG = join(ROOT, 'package.json');
const LOCK = join(ROOT, 'package-lock.json');

const CATEGORY_ORDER = [
  'breaking',
  'security',
  'removed',
  'deprecated',
  'changed',
  'added',
  'fixed',
];

const CATEGORY_HEADING = {
  breaking: '### ⚠ BREAKING',
  security: '### Security',
  removed: '### Removed',
  deprecated: '### Deprecated',
  changed: '### Changed',
  added: '### Added',
  fixed: '### Fixed',
};

function parseFragmentFilename(name) {
  // <category>-<slug>.md
  const m = name.match(/^([a-z]+)-(.+)\.md$/);
  if (!m) return null;
  const cat = m[1];
  if (!CATEGORY_ORDER.includes(cat)) return null;
  return { category: cat, slug: m[2] };
}

function collectFragments() {
  const out = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, []]));
  let entries;
  try {
    entries = readdirSync(FRAG_DIR, { withFileTypes: true });
  } catch (e) {
    if (e?.code === 'ENOENT') return { byCategory: out, files: [], orphans: [] };
    throw e;
  }
  const files = [];
  // Files that look like they want to be fragments but carry an
  // unrecognized category. We do NOT silently skip these: a stray
  // `docs-foo.md` would otherwise sit in next/ forever, never collected,
  // while the release still exits 0 ("silence reads as success"). main()
  // refuses to proceed when orphans exist (see #441).
  const orphans = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (ent.name === '.gitkeep' || ent.name === 'README.md') continue;
    if (ent.name.startsWith('.')) continue;
    const meta = parseFragmentFilename(ent.name);
    if (!meta) {
      orphans.push(ent.name);
      continue;
    }
    const full = join(FRAG_DIR, ent.name);
    const body = readFileSync(full, 'utf8').trimEnd();
    if (body.length === 0) continue;
    out[meta.category].push(body);
    files.push(full);
  }
  return { byCategory: out, files, orphans };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function buildNewBlock(version, byCategory) {
  const lines = [`## [${version}] - ${todayIso()}`, ''];
  let wroteAny = false;
  for (const cat of CATEGORY_ORDER) {
    const items = byCategory[cat];
    if (items.length === 0) continue;
    wroteAny = true;
    lines.push(CATEGORY_HEADING[cat]);
    lines.push('');
    for (const body of items) {
      lines.push(body);
      lines.push('');
    }
  }
  if (!wroteAny) {
    lines.push('_(no behavior changes)_');
    lines.push('');
  }
  return lines.join('\n');
}

function rewriteChangelog(text, newBlock) {
  // Replace the `## [Unreleased]` heading (and its leading HTML
  // comment, if present) with: a fresh empty [Unreleased] placeholder
  // followed by the new versioned block. The HTML comment is preserved
  // above the new placeholder because future PRs still benefit from
  // the explanation of where entries go.
  const unreleasedRe = /^## \[Unreleased\]/m;
  const match = text.match(unreleasedRe);
  if (!match) {
    throw new Error(
      'CHANGELOG.md is missing the `## [Unreleased]` heading — refusing to rewrite.',
    );
  }
  const idx = match.index;
  // Find the start of the next `## [` heading after Unreleased.
  const after = text.slice(idx + match[0].length);
  const nextRe = /\n## \[/;
  const nextMatch = after.match(nextRe);
  const sliceEnd =
    nextMatch !== null && nextMatch.index !== undefined
      ? idx + match[0].length + nextMatch.index + 1
      : text.length;
  const before = text.slice(0, idx);
  const oldUnreleasedBlock = text.slice(idx, sliceEnd);
  const rest = text.slice(sliceEnd);
  // If the old Unreleased block had real content, fold it into the
  // versioned block (collected first so curators don't lose anything
  // that bypassed the fragment dir).
  const oldContent = oldUnreleasedBlock
    .replace(/^## \[Unreleased\]\s*\n?/, '')
    .trimEnd();
  const placeholder =
    `## [Unreleased]\n\n` +
    `_Add entries by dropping a file under \`.changelog/next/\` ` +
    `(see \`.changelog/README.md\`). The release script collects them ` +
    `into a versioned block at \`npm run changelog:release -- <ver>\`._\n\n`;
  const folded =
    oldContent.length > 0
      ? newBlock.replace(/\n$/, '') +
        '\n\n<!-- carried over from pre-fragment [Unreleased] -->\n\n' +
        oldContent +
        '\n\n'
      : newBlock + '\n';
  return before + placeholder + folded + rest;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Sync the `version` field(s) in package.json / package-lock.json to the
// release version. Targeted text replacement (not JSON re-serialize) keeps
// the byte layout stable — only the version line(s) move. Without this the
// manifests drift from CHANGELOG and CI's version-drift guard fails the
// release (the trap that surfaced in the 0.7.0 dogfood, #441/#442).
function bumpManifestVersion(path, version, { isLock = false } = {}) {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw);
  const rootOld = parsed.version;
  const lockOld = isLock ? (parsed.packages?.['']?.version ?? rootOld) : rootOld;
  let next = raw;
  // Top-level "version" — 2-space indent in npm manifests; the only
  // 2-space `"version"` key in either file, so first-match is the root.
  next = next.replace(
    new RegExp(`(\\n  "version": ")${escapeRe(rootOld)}(",)`),
    `$1${version}$2`,
  );
  if (isLock) {
    // packages[""].version — 6-space indent; "" is the first packages
    // entry, so the first 6-space match is the self-version.
    next = next.replace(
      new RegExp(`(\\n      "version": ")${escapeRe(lockOld)}(",)`),
      `$1${version}$2`,
    );
  }
  if (next === raw) {
    if (rootOld === version) return false; // already at target
    throw new Error(`could not locate version field to bump in ${path}`);
  }
  writeFileSync(path, next);
  return true;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const version = args.find((a) => !a.startsWith('--'));
  if (!version) {
    process.stderr.write(
      'usage: node scripts/changelog-release.mjs <version> [--dry-run]\n',
    );
    process.exit(2);
  }
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
    process.stderr.write(
      `error: '${version}' does not look like a semver version ` +
        `(e.g. 0.6.0, 1.0.0-rc.1).\n`,
    );
    process.exit(2);
  }
  const { byCategory, files, orphans } = collectFragments();
  const fragmentCount = Object.values(byCategory).reduce(
    (n, arr) => n + arr.length,
    0,
  );
  process.stderr.write(
    `Collected ${fragmentCount} fragment${fragmentCount === 1 ? '' : 's'} ` +
      `from .changelog/next/.\n`,
  );
  // Refuse to release (or preview) while unrecognized files linger in
  // next/ — collecting them silently would drop the entry on the floor.
  if (orphans.length > 0) {
    process.stderr.write(
      `\nerror: ${orphans.length} file(s) in .changelog/next/ are not valid ` +
        `fragments and would be left behind:\n` +
        orphans.map((n) => `  - ${n}\n`).join('') +
        `\nA fragment is <category>-<slug>.md where category is one of: ` +
        `${CATEGORY_ORDER.join(', ')}.\n` +
        `docs-only changes do not get a fragment (the PR / git history is ` +
        `their record) — delete the file. Otherwise rename it to a valid ` +
        `category. See .changelog/README.md.\n`,
    );
    process.exit(1);
  }
  const newBlock = buildNewBlock(version, byCategory);
  if (dryRun) {
    process.stdout.write(newBlock);
    process.stderr.write(
      `\n(dry-run: would set package.json + package-lock.json version to ` +
        `${version})\n`,
    );
    return;
  }
  const original = readFileSync(CHANGELOG, 'utf8');
  const next = rewriteChangelog(original, newBlock);
  writeFileSync(CHANGELOG, next);
  // Keep the manifests in lockstep with the release so CI's version-drift
  // guard stays green (see bumpManifestVersion).
  bumpManifestVersion(PKG, version);
  bumpManifestVersion(LOCK, version, { isLock: true });
  process.stderr.write(
    `Set package.json + package-lock.json version to ${version}.\n`,
  );
  for (const f of files) {
    try {
      unlinkSync(f);
    } catch (e) {
      process.stderr.write(`warn: could not unlink ${f}: ${e?.message}\n`);
    }
  }
  process.stderr.write(
    `Wrote ${CHANGELOG} with [${version}] block. ` +
      `Removed ${files.length} fragment file${files.length === 1 ? '' : 's'}.\n`,
  );
}

main();
