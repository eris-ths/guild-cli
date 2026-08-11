import { DomainError } from '../shared/DomainError.js';
import { MemberName } from '../member/MemberName.js';
import { RequestId } from '../request/RequestId.js';
import {
  RomEnvelope,
  parseRomEnvelope,
  ROM_CONTRACT_KEYS,
} from '../rom/RomEnvelope.js';

/**
 * An **Observation** — a machine-emitted fact about a run that already
 * happened.
 *
 * ## Why this is a substrate kind of its own
 *
 * The four existing stores all record something a *person* did or
 * decided: a request is a judgment moving through states, an issue is a
 * noticed problem someone triages, an agora play is an exploration, a
 * ctx fact is an accumulated finding. Every one of them has an author
 * with an intent.
 *
 * An observation has neither. A ROM report is emitted by an engine; a
 * floor measurement is emitted by a verifier. Nobody decided it. It
 * cannot be argued with, reviewed, superseded, or transitioned — and
 * that is the structural difference, not a stylistic one:
 *
 * > **Observations are append-only and have no state machine.**
 *
 * A record that cannot transition does not belong in a store built
 * around transitions. Putting one there is what produced the friction
 * that motivated this kind (`i-2026-08-10-0006`): machine measurements
 * were being written as `fast-track` requests, so any projection of
 * "what was decided" had to filter them back out — and the only handle
 * available for filtering was a prefix match on the action string, i.e.
 * a hand-written literal in the projection layer, i.e.
 * `trap_identity_string_written_by_hand_beside_its_table` again.
 *
 * With a separate store the discriminator stops being a field anyone
 * has to set correctly and becomes **structural**: everything under
 * `<paths.observations>/` is machine-origin, by construction. A
 * projection asking "what did a person decide?" reads `requests/` and is
 * done. Nothing to filter, nothing to keep in sync.
 *
 * ## Relationship to a wave
 *
 * `subject` optionally names the request an observation belongs to.
 * The link is one-directional on purpose — the request does not list
 * its observations. A wave record is closed when it completes; letting
 * later machine output mutate it would make a terminal record
 * non-terminal. Readers join from this side.
 */

export const OBSERVATION_KINDS = ['rom'] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

/**
 * The typed body, discriminated by `kind`. One variant today; a second
 * kind adds a variant here and a branch in the repository's hydrate —
 * both of which the compiler demands, so a new kind cannot be
 * half-added.
 */
export type ObservationBody = {
  readonly kind: 'rom';
  readonly envelope: RomEnvelope;
  /**
   * Top-level envelope keys outside the v1 contract, preserved
   * verbatim.
   *
   * Not a nicety, and not hypothetical: this is how the reference
   * engine's `policy` / `timeline` / `exit` blocks were preserved for
   * the weeks between shipping the v1 parser and specifying them. Had
   * they been dropped as unknown, the record of which windows a ROM
   * *tried* to reach and was refused would have been gone by the time
   * anyone thought to describe it, and the spec would have been
   * written from the document instead of from stored runs.
   *
   * The wire is allowed to be ahead of the spec. A fact dropped on
   * write cannot be recovered later, so the rule is to keep what we
   * were told and check what we can.
   *
   * An observation is a record of what the engine actually reported.
   * The typed half is what we can check; this is the rest of what we
   * were told, kept because the wire is allowed to be ahead of the
   * spec and a fact dropped on write cannot be recovered later.
   */
  readonly extra?: Readonly<Record<string, unknown>>;
};

// Contract-owned top-level keys come from the module that owns the
// contract (`ROM_CONTRACT_KEYS`), not from a copy kept here. A copy
// would keep filing a newly-specified block as `extra` — silently, and
// forever, because nothing compares the two lists.

/** Split a raw envelope document into its contract part and the rest. */
export function extractRomExtra(
  raw: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ROM_CONTRACT_KEYS.has(k)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function parseObservationKind(raw: unknown): ObservationKind {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if ((OBSERVATION_KINDS as readonly string[]).includes(v)) {
    return v as ObservationKind;
  }
  throw new DomainError(
    `Invalid observation kind: "${String(raw)}". ` +
      `Known kinds: ${OBSERVATION_KINDS.join(', ')}`,
    'kind',
  );
}

// Accepts 3- and 4-digit sequences on read for the same reason
// RequestId / IssueId do; generation always produces 4.
const OBSERVATION_ID_PATTERN = /^o-\d{4}-\d{2}-\d{2}-\d{3,4}$/;
const MAX_SOURCE = 64;
const SOURCE_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;

export class ObservationId {
  private constructor(public readonly value: string) {}

  static of(raw: unknown): ObservationId {
    if (typeof raw !== 'string' || !OBSERVATION_ID_PATTERN.test(raw)) {
      throw new DomainError(
        `Invalid observation id: "${String(raw)}". Expected o-YYYY-MM-DD-NNNN (or legacy NNN)`,
        'id',
      );
    }
    return new ObservationId(raw);
  }

  static generate(now: Date, sequence: number): ObservationId {
    const dateKey = now.toISOString().slice(0, 10);
    const seq = String(sequence).padStart(4, '0');
    return new ObservationId(`o-${dateKey}-${seq}`);
  }
}

export interface ObservationProps {
  readonly id: ObservationId;
  readonly by: MemberName;
  readonly at: string;
  readonly body: ObservationBody;
  readonly subject?: RequestId;
  readonly source?: string;
}

export class Observation {
  private constructor(private readonly props: ObservationProps) {}

  /**
   * Strict construction for fresh writes. Rejects anything the format
   * does not allow; `restore` is the tolerant twin used on hydrate.
   */
  static create(props: ObservationProps): Observation {
    if (props.source !== undefined) {
      if (props.source.length > MAX_SOURCE || !SOURCE_PATTERN.test(props.source)) {
        throw new DomainError(
          `Invalid observation source: "${props.source}". ` +
            `Expected lowercase name, digits, dot/underscore/hyphen, ` +
            `≤${MAX_SOURCE} chars (e.g. "rom-stamp")`,
          'source',
        );
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}T/.test(props.at)) {
      throw new DomainError(
        `Invalid observation timestamp: "${props.at}". Expected ISO-8601 UTC`,
        'at',
      );
    }
    return new Observation(props);
  }

  static restore(props: ObservationProps): Observation {
    return new Observation(props);
  }

  get id(): ObservationId {
    return this.props.id;
  }
  get by(): MemberName {
    return this.props.by;
  }
  get at(): string {
    return this.props.at;
  }
  get kind(): ObservationKind {
    return this.props.body.kind;
  }
  get body(): ObservationBody {
    return this.props.body;
  }
  get subject(): RequestId | undefined {
    return this.props.subject;
  }
  get source(): string | undefined {
    return this.props.source;
  }

  /**
   * snake_case projection for the YAML layer. Optional fields are
   * omitted rather than written empty — the byte-stability invariant
   * the persistence layer holds across every store.
   */
  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      id: this.props.id.value,
      kind: this.props.body.kind,
      by: this.props.by.value,
      at: this.props.at,
    };
    if (this.props.subject !== undefined) {
      out['subject'] = this.props.subject.value;
    }
    if (this.props.source !== undefined) {
      out['source'] = this.props.source;
    }
    out['envelope'] = {
      ...romEnvelopeToJSON(this.props.body.envelope),
      ...(this.props.body.extra ?? {}),
    };
    return out;
  }
}

/**
 * snake_case is already the envelope's wire shape — pass it through.
 *
 * This function is a third statement of the envelope's shape, after the
 * `RomEnvelope` type and `parseRomEnvelope`. It cannot be derived from
 * either (the type is erased; the parser runs the other direction), so
 * it is *bound* instead: `RomEnvelope.test.ts` asserts that
 * `romEnvelopeToJSON(parseRomEnvelope(x))` deep-equals `x` for a
 * fully-populated `x`. A field dropped here fails that round-trip
 * rather than silently vanishing from the store.
 *
 * That guard was written because this function had in fact already
 * dropped three blocks — `policy`, `timeline` and `exit` reached the
 * parser but never the disk, so a recorded observation was quietly
 * poorer than the run it recorded.
 */
export function romEnvelopeToJSON(e: RomEnvelope): Record<string, unknown> {
  const out: Record<string, unknown> = {
    v: e.v,
    engine: {
      windows: e.engine.windows,
      names: [...e.engine.names],
      feat: e.engine.feat,
    },
    cost: {
      instrs: e.cost.instrs,
      hostcalls: e.cost.hostcalls,
      mempeak_pages: e.cost.mempeak_pages,
      mode: e.cost.mode,
    },
    io: { out_bytes: e.io.out_bytes, out_fnv1a: e.io.out_fnv1a },
    capabilities: {
      declared: e.capabilities.declared,
      used: e.capabilities.used,
      used_names: e.capabilities.used_names.map((u) => ({
        name: u.name,
        count: u.count,
      })),
    },
  };
  // Omit-when-absent: the store's byte-stability invariant. An engine
  // that sent no `policy` must not read back as one that sent an empty
  // one — absence and emptiness are different claims here.
  if (e.policy !== undefined) {
    const p: Record<string, unknown> = { enforced: e.policy.enforced };
    if (e.policy.granted !== undefined) p['granted'] = [...e.policy.granted];
    if (e.policy.denied !== undefined) {
      p['denied'] = e.policy.denied.map((d) => ({
        name: d.name,
        count: d.count,
      }));
    }
    if (e.policy.stopped_at !== undefined) {
      p['stopped_at'] = {
        window: e.policy.stopped_at.window,
        instr: e.policy.stopped_at.instr,
        hostcall: e.policy.stopped_at.hostcall,
      };
    }
    out['policy'] = p;
  }
  if (e.timeline !== undefined) {
    out['timeline'] = e.timeline.map((t) => ({
      seq: t.seq,
      window: t.window,
      denied: t.denied,
    }));
  }
  if (e.exit !== undefined) {
    out['exit'] = {
      trapped: e.exit.trapped,
      exited: e.exit.exited,
      code: e.exit.code,
    };
  }
  return out;
}

/**
 * Rebuild the typed body from stored YAML. The envelope goes back
 * through `parseRomEnvelope`, so a record edited on disk into an
 * inconsistent state fails on read rather than being trusted because it
 * once passed on write.
 */
export function hydrateObservationBody(
  kind: ObservationKind,
  raw: unknown,
): ObservationBody {
  switch (kind) {
    case 'rom': {
      const envelope = parseRomEnvelope(raw);
      const extra = extractRomExtra(raw);
      return extra === undefined
        ? { kind: 'rom', envelope }
        : { kind: 'rom', envelope, extra };
    }
  }
}
