// OkfFrontmatter — (de)serialize the `---\n<yaml>\n---\n<body>` envelope.
//
// Infrastructure, not domain: this is where the external `yaml` dependency
// lives. Parsing routes through `parseYamlSafe` so an imported bundle —
// untrusted external input — gets the same prototype-pollution hardening
// and parse-failure tolerance as every other YAML read in the substrate
// (issue #154). Serialization emits a canonical field order so guild's own
// exports are byte-stable (the project's persistence invariant).

import YAML from 'yaml';
import { OkfDocument, OkfFrontmatter } from '../../domain/okf/OkfDocument.js';
import { parseYamlSafe } from '../persistence/parseYamlSafe.js';
import { OnMalformed } from '../../application/ports/OnMalformed.js';

// OKF's standard frontmatter fields, in the order we emit them. Any
// producer-defined extras (guild: `id`, `author`) follow, sorted, so the
// output is deterministic regardless of in-memory key order.
const STANDARD_FIELD_ORDER: readonly string[] = [
  'type',
  'title',
  'description',
  'resource',
  'tags',
  'timestamp',
];

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Serialize a document to OKF text. Frontmatter fields are emitted in
 * canonical order (standard fields first, extras sorted), then a blank
 * line, then the body with a single trailing newline.
 */
export function serializeOkfDocument(doc: OkfDocument): string {
  const fm = doc.frontmatter;
  const ordered: Record<string, unknown> = {};

  for (const key of STANDARD_FIELD_ORDER) {
    const v = fm[key];
    if (v !== undefined && v !== null) ordered[key] = v;
  }
  const extras = Object.keys(fm)
    .filter((k) => !STANDARD_FIELD_ORDER.includes(k))
    .sort();
  for (const key of extras) {
    const v = fm[key];
    if (v !== undefined && v !== null) ordered[key] = v;
  }

  const yamlText = YAML.stringify(ordered).trimEnd();
  const body = doc.body.trim();
  return `---\n${yamlText}\n---\n\n${body}\n`;
}

/**
 * Parse OKF text into a document. Tolerant on read:
 *   - missing frontmatter delimiters -> empty frontmatter, whole text as body
 *   - frontmatter that doesn't parse / isn't a mapping -> empty frontmatter
 *     (the malformed event is reported via `onMalformed`)
 *   - missing `type` -> coerced to `''` (the import mapper decides what to do)
 *
 * `source` labels the file in `onMalformed` diagnostics.
 */
export function parseOkfDocument(
  path: string,
  text: string,
  source: string,
  onMalformed: OnMalformed,
): OkfDocument {
  const m = FRONTMATTER_RE.exec(text);
  if (m === null) {
    return { path, frontmatter: { type: '' }, body: text.trim() };
  }

  const [, yamlText, body] = m;
  const parsed = parseYamlSafe(yamlText ?? '', source, onMalformed);

  let frontmatter: OkfFrontmatter = { type: '' };
  if (parsed !== undefined && parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    frontmatter = {
      ...obj,
      type: typeof obj.type === 'string' ? obj.type : '',
    };
  }

  return { path, frontmatter, body: (body ?? '').trim() };
}
