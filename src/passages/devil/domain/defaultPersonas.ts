// devil-review — bundled default persona catalog (v0).
//
// Six personas total: three hand-rolled (red-team / author-defender
// / mirror) + three ingest-only (ultrareview-fleet / claude-security
// / scg-supply-chain-gate). Hand-rolled personas can attribute
// `devil entry` writes; ingest-only personas can ONLY attribute via
// the matching `devil ingest --from <source>` verb (PersonaIsIngestOnly
// raised by `devil entry` if a caller tries to use them by hand).
//
// guidance is prose because the persona's role is a framing
// commitment, not a checklist. For ingest-only personas the
// guidance describes what their automated source committed to —
// substrate-readers re-encountering an ingested entry can read the
// persona to know what kind of source produced the finding.

import { Persona } from './Persona.js';

const HAND_ROLLED_RAW: ReadonlyArray<Parameters<typeof Persona.create>[0]> = [
  {
    name: 'red-team',
    title: 'Red Team',
    description:
      'Adversarial framing. Reads the diff as an attacker probing for the cheapest way to harm an end user — not the developer, not the company, the end user.',
    guidance:
      'Inhabit an actor whose only goal is to harm someone downstream. ' +
      'Ask: "what is the one input I would send to break the trust boundary?" ' +
      'Do not be fair to the author. Do not give the change the benefit of the doubt. ' +
      'If you cannot find a concrete attack, name the trust assumption you would need to break — that becomes a `kind: assumption` entry the author must defend.',
  },
  {
    name: 'author-defender',
    title: 'Author Defender',
    description:
      "Articulates the author's intent and the assumptions the change rests on. Surfaces what the author meant — so the red-team has something specific to attack and the mirror has something specific to compare.",
    guidance:
      'Inhabit the author. Read the change as if you wrote it on a tight deadline. ' +
      'Make the trust assumptions *explicit* — the things you would have said "obviously..." about. ' +
      'List them as `kind: assumption` entries. Each one is a target the red-team can contest. ' +
      'You are not defending the author from criticism; you are defending the change from being misunderstood.',
  },
  {
    name: 'mirror',
    title: 'Mirror',
    description:
      'Reads both the red-team entries and the author-defender entries together. Surfaces contradictions, things both sides missed, and load-bearing assumptions that neither named.',
    guidance:
      'Inhabit a third reader who has seen the other two write. ' +
      'Where do red-team and author-defender talk past each other? ' +
      'What did both of them assume without arguing for? ' +
      'What is the load-bearing thing that neither side touched because both took it for granted? ' +
      'Mirror entries are usually `kind: resistance` (verdict-less) or `kind: synthesis` (toward conclusion).',
  },
];

const INGEST_ONLY_RAW: ReadonlyArray<Parameters<typeof Persona.create>[0]> = [
  {
    name: 'ultrareview-fleet',
    title: 'Ultrareview Fleet (ingested)',
    description:
      "Anthropic's /ultrareview multi-agent fleet. Each finding has been independently reproduced and verified by the upstream tool before reaching this substrate.",
    guidance:
      'Findings under this persona were produced by /ultrareview running in remote sandbox. ' +
      'They focus on bugs broadly (not security-specific), and the fleet has already filtered out style issues. ' +
      'A devil reviewer reading these should still apply the lense framing: ' +
      "this persona's findings are inputs to the deliberation, not the deliberation itself.",
    ingest_only: true,
  },
  {
    name: 'claude-security',
    title: 'Claude Security (ingested)',
    description:
      "Anthropic's Claude Security agentic scanner. Findings have passed multi-stage validation (Claude challenged its own results before reporting); severity is exploitability-context-aware in the source repo.",
    guidance:
      'Findings under this persona were produced by Claude Security. They map to one of the eight ' +
      'security categories (injection / injection-parser / path-network / auth-access / memory-safety / ' +
      'crypto / deserialization / protocol-encoding) which align 1:1 with devil-review lenses of the same name. ' +
      'Severity is exploitability-context-aware in the source repo, not category-default.',
    ingest_only: true,
  },
  {
    name: 'scg-supply-chain-gate',
    title: 'SCG Supply-chain Gate (ingested)',
    description:
      "supply-chain-guard's 8-stage Devil Gate framework verdict, ingested as a single kind=gate entry on the supply-chain lense. Stages carry per-step verdict + reasoning; entry-level verdict aggregates to CLEAR / HIGH / CRITICAL.",
    guidance:
      'Findings under this persona are SCG (eris-ths/supply-chain-guard) Devil Gate verdicts on the ' +
      'supply-chain lense. The eight stages run dependency / runtime / integrity / environment checks ' +
      'against known IOCs; the aggregate VERDICT (CLEAR | HIGH | CRITICAL) is the authoritative status. ' +
      'devil-review treats this as the load-bearing signal for the supply-chain lense (mandatory delegate per #126 decision C).',
    ingest_only: true,
  },
];

const DEFAULTS_RAW: ReadonlyArray<Parameters<typeof Persona.create>[0]> = [
  ...HAND_ROLLED_RAW,
  ...INGEST_ONLY_RAW,
];

export function buildDefaultPersonas(): ReadonlyMap<string, Persona> {
  const map = new Map<string, Persona>();
  for (const raw of DEFAULTS_RAW) {
    const persona = Persona.create(raw);
    if (map.has(persona.name)) {
      throw new Error(`duplicate default persona name: ${persona.name}`);
    }
    map.set(persona.name, persona);
  }
  return map;
}

/**
 * Names of every bundled persona, in canonical order: three
 * hand-rolled first (the typical reviewer pick-list), then three
 * ingest-only (attributable only via `devil ingest`).
 */
export const DEFAULT_PERSONA_NAMES: readonly string[] = DEFAULTS_RAW.map((d) => d.name);

/** Subset: hand-rolled personas only. */
export const HAND_ROLLED_PERSONA_NAMES: readonly string[] = HAND_ROLLED_RAW.map((d) => d.name);

/** Subset: ingest-only personas (attributable only via `devil ingest`). */
export const INGEST_ONLY_PERSONA_NAMES: readonly string[] = INGEST_ONLY_RAW.map((d) => d.name);
