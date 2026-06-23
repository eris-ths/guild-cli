// ctx — Fact (a recorded observation, not a judgment).
//
// ctx is the fourth passage under guild (after gate / agora / devil),
// reserved for "facts the substrate has accumulated across sessions".
// Distinct from gate (judgment), agora (exploration), devil (defense).
//
// Phase 1 ships the minimum: id, attribution, the fact prose, and
// optional prefix-tagged labels (e.g. `tech:typescript`, `status:active`).
// Phase 2 begins with `supersedes` — a forward-only link to the older
// fact this one corrects. The old record is never mutated (immutable on
// save); the correction is a *new* fact pointing back, so the ledger keeps
// both and the supersession is reconstructable from the link alone.
// `evidence`, `sub_of`, `chain_after`, `branch_ref` remain phase-2 work —
// see issue tracker.
//
// AI-first per principle 11:
//   - immutable on save (re-reading agents must see what was written)
//   - explicit fields, snake_case keys
//   - validation at construction; tampered YAML fails closed at restore

import { DomainError } from '../../../domain/shared/DomainError.js';

/**
 * Ctx id — `ctx-YYYY-MM-DD-NNN`.
 *
 * Mirrors the request-id shape (`YYYY-MM-DD-NNN`) with a `ctx-` prefix
 * so the ledger can be greped by passage. Three-digit suffix supports
 * up to 999 ctx records per day per content_root, which is well above
 * any realistic write rate.
 */
const CTX_ID_PATTERN = /^ctx-\d{4}-\d{2}-\d{2}-\d{3}$/;

export function parseCtxId(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new DomainError(`ctx id must be a string, got: ${typeof raw}`, 'id');
  }
  if (!CTX_ID_PATTERN.test(raw)) {
    throw new DomainError(
      `ctx id must match ${CTX_ID_PATTERN.source}, got: ${raw}`,
      'id',
    );
  }
  return raw;
}

/**
 * Tag — `prefix:value` shape borrowed from THS ctx convention.
 * Examples: `tech:typescript`, `status:active`, `topic:ctx-design`.
 *
 * Both halves are lowercase ASCII letters / digits / hyphens; prefix
 * must be 1–16 chars, value 1–48 chars. The prefix is what makes
 * tags semantically queryable (filter by `tech:*`, by `status:*`, ...).
 */
const TAG_PATTERN = /^[a-z][a-z0-9-]{0,15}:[a-z0-9][a-z0-9-]{0,47}$/;

export function parseCtxTag(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new DomainError(`ctx tag must be a string, got: ${typeof raw}`, 'tag');
  }
  if (!TAG_PATTERN.test(raw)) {
    throw new DomainError(
      `ctx tag must match ${TAG_PATTERN.source} (e.g. tech:typescript), got: ${raw}`,
      'tag',
    );
  }
  return raw;
}

export interface CtxProps {
  readonly id: string;
  readonly created_at: string; // ISO timestamp
  readonly created_by: string; // member or host name
  readonly fact: string;       // non-empty prose
  readonly tags: readonly string[]; // possibly empty; each `prefix:value`
  // phase-2: forward link to the older fact this corrects. `string | undefined`
  // (not `?:`) so callers can pass an explicit undefined under
  // exactOptionalPropertyTypes; toJSON omits it when undefined for byte stability.
  readonly supersedes: string | undefined;
}

export class Ctx {
  readonly id: string;
  readonly created_at: string;
  readonly created_by: string;
  readonly fact: string;
  readonly tags: readonly string[];
  /**
   * The id of an older fact this one corrects, or undefined for an
   * ordinary fact. Forward-only: the *new* (correcting) fact carries the
   * link; the superseded fact is never mutated. A reader reconstructs the
   * "superseded_by" direction by scanning for facts whose `supersedes`
   * names a given id.
   */
  readonly supersedes: string | undefined;

  private constructor(props: CtxProps) {
    this.id = props.id;
    this.created_at = props.created_at;
    this.created_by = props.created_by;
    this.fact = props.fact;
    this.tags = props.tags;
    this.supersedes = props.supersedes;
  }

  static create(input: {
    id: string;
    fact: string;
    created_by: string;
    tags?: readonly string[];
    supersedes?: string;
    now?: () => Date;
  }): Ctx {
    const id = parseCtxId(input.id);
    if (typeof input.fact !== 'string' || input.fact.trim().length === 0) {
      throw new DomainError('fact required (non-empty string)', 'fact');
    }
    if (typeof input.created_by !== 'string' || input.created_by.trim().length === 0) {
      throw new DomainError('created_by required (non-empty string)', 'created_by');
    }
    const tags = (input.tags ?? []).map((t) => parseCtxTag(t));
    const supersedes = parseSupersedes(input.supersedes, id);
    const created_at = (input.now ?? (() => new Date()))().toISOString();
    return new Ctx({
      id,
      created_at,
      created_by: input.created_by.trim(),
      fact: input.fact.trim(),
      tags: Object.freeze([...tags]),
      supersedes,
    });
  }

  /**
   * Restore from on-disk YAML. Same validation as create — a tampered
   * file fails closed at the boundary.
   */
  static restore(input: CtxProps): Ctx {
    const tags = (input.tags ?? []).map((t) => parseCtxTag(t));
    const id = parseCtxId(input.id);
    return new Ctx({
      id,
      created_at: input.created_at,
      created_by: input.created_by,
      fact: input.fact,
      tags: Object.freeze([...tags]),
      supersedes: parseSupersedes(input.supersedes, id),
    });
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      id: this.id,
      created_at: this.created_at,
      created_by: this.created_by,
      fact: this.fact,
      tags: [...this.tags],
    };
    // byte-stable YAML: omit the link entirely on an ordinary fact, so a
    // phase-1 record round-trips unchanged and diffs stay minimal.
    if (this.supersedes !== undefined) out['supersedes'] = this.supersedes;
    return out;
  }
}

/**
 * Validate an optional `supersedes` link: must be a well-formed ctx id and
 * must not point at the fact's own id (a self-supersession is incoherent —
 * a fact cannot correct itself). Existence of the target is an application
 * concern (the domain has no repository); this guards shape + self-loop.
 */
function parseSupersedes(raw: unknown, ownId: string): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const target = parseCtxId(raw);
  if (target === ownId) {
    throw new DomainError('a fact cannot supersede itself', 'supersedes');
  }
  return target;
}

export class CtxIdCollision extends Error {
  constructor(id: string) {
    super(`Ctx id already exists: ${id}`);
    this.name = 'CtxIdCollision';
  }
}

/**
 * Allocate a fresh `ctx-YYYY-MM-DD-NNN` id, scanning the current
 * day's existing ids and choosing the next free 3-digit slot.
 *
 * Pure function — caller hands in the existing-ids list and `now`,
 * we deterministically pick the next id. Repository owns the listing.
 */
export function nextCtxId(existing: readonly string[], now: Date): string {
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const prefix = `ctx-${date}-`;
  const used = new Set<number>();
  for (const id of existing) {
    if (id.startsWith(prefix)) {
      const n = Number.parseInt(id.slice(prefix.length), 10);
      if (Number.isInteger(n)) used.add(n);
    }
  }
  for (let n = 1; n <= 999; n++) {
    if (!used.has(n)) return `${prefix}${String(n).padStart(3, '0')}`;
  }
  throw new DomainError(
    `ctx id exhausted for ${date} (>999 records). Bump in phase 2 if real.`,
    'id',
  );
}
