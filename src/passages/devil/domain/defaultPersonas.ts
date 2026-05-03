// devil-review — bundled default persona catalog (v0).
//
// Three hand-rolled personas (red-team / author-defender / mirror)
// per issue #126. Automated personas (ultrareview-fleet,
// claude-security, scg-supply-chain-gate) land alongside their
// matching ingest verbs in subsequent commits — they are not in
// this default set so the reviewer's pick-list stays human-shaped.
//
// guidance is prose because the persona's role is a framing
// commitment, not a checklist. The reviewer reads it before
// authoring an entry; the runtime does not enforce its content.

import { Persona } from './Persona.js';

const DEFAULTS_RAW: ReadonlyArray<Parameters<typeof Persona.create>[0]> = [
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

/** Names of the bundled hand-rolled personas, for v0 discoverability. */
export const DEFAULT_PERSONA_NAMES: readonly string[] = DEFAULTS_RAW.map((d) => d.name);
