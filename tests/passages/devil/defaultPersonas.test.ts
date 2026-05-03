// devil-review — default persona catalog tests.
//
// Pin the v0 hand-rolled personas: red-team / author-defender /
// mirror, exactly per issue #126. Automated personas
// (ultrareview-fleet etc.) are intentionally NOT in this default
// set — they land with their matching ingest verbs in subsequent
// commits — and this test pins their absence so a future commit
// cannot accidentally surface an ingest-only persona in the
// hand-rolled pick-list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Persona } from '../../../src/passages/devil/domain/Persona.js';
import {
  buildDefaultPersonas,
  DEFAULT_PERSONA_NAMES,
  HAND_ROLLED_PERSONA_NAMES,
  INGEST_ONLY_PERSONA_NAMES,
} from '../../../src/passages/devil/domain/defaultPersonas.js';

const EXPECTED_HAND_ROLLED: readonly string[] = [
  'red-team',
  'author-defender',
  'mirror',
];

const EXPECTED_INGEST_ONLY: readonly string[] = [
  'ultrareview-fleet',
  'claude-security',
  'scg-supply-chain-gate',
];

test('default persona catalog has 3 hand-rolled + 3 ingest-only = 6 personas', () => {
  const map = buildDefaultPersonas();
  assert.equal(
    map.size,
    6,
    'expected 3 hand-rolled + 3 ingest-only personas (issue #126)',
  );
  assert.deepEqual(
    [...map.keys()].sort(),
    [...EXPECTED_HAND_ROLLED, ...EXPECTED_INGEST_ONLY].sort(),
    'persona names must match issue #126 exactly',
  );
  assert.deepEqual(
    [...DEFAULT_PERSONA_NAMES].sort(),
    [...EXPECTED_HAND_ROLLED, ...EXPECTED_INGEST_ONLY].sort(),
  );
});

test('hand-rolled subset is exactly the 3 expected', () => {
  assert.deepEqual(
    [...HAND_ROLLED_PERSONA_NAMES].sort(),
    [...EXPECTED_HAND_ROLLED].sort(),
  );
});

test('ingest-only subset is exactly the 3 expected', () => {
  assert.deepEqual(
    [...INGEST_ONLY_PERSONA_NAMES].sort(),
    [...EXPECTED_INGEST_ONLY].sort(),
  );
});

test('every default persona has non-empty title, description, and guidance', () => {
  const map = buildDefaultPersonas();
  for (const persona of map.values()) {
    assert.ok(persona.title.length > 0, `${persona.name}: title must be non-empty`);
    assert.ok(
      persona.description.length > 0,
      `${persona.name}: description must be non-empty`,
    );
    assert.ok(
      persona.guidance.length > 0,
      `${persona.name}: guidance must be non-empty (persona must declare commitment)`,
    );
  }
});

test('hand-rolled personas have ingest_only=false; ingest-only personas have ingest_only=true', () => {
  const map = buildDefaultPersonas();
  for (const name of HAND_ROLLED_PERSONA_NAMES) {
    const p = map.get(name);
    assert.ok(p);
    assert.equal(p.ingest_only, false, `${name}: hand-rolled must be ingest_only=false`);
  }
  for (const name of INGEST_ONLY_PERSONA_NAMES) {
    const p = map.get(name);
    assert.ok(p);
    assert.equal(p.ingest_only, true, `${name}: ingest-only must be ingest_only=true`);
  }
});

test('every default persona round-trips through toJSON without losing fields', () => {
  const map = buildDefaultPersonas();
  for (const persona of map.values()) {
    const json = persona.toJSON();
    assert.equal(json['name'], persona.name);
    assert.equal(json['title'], persona.title);
    assert.equal(json['description'], persona.description);
    assert.equal(json['guidance'], persona.guidance);
    assert.equal(json['ingest_only'], persona.ingest_only);
  }
});

test('Persona.create defaults ingest_only to false', () => {
  const p = Persona.create({
    name: 'x',
    title: 't',
    description: 'd',
    guidance: 'g',
  });
  assert.equal(p.ingest_only, false);
});

test('Persona.create accepts ingest_only=true', () => {
  const p = Persona.create({
    name: 'x',
    title: 't',
    description: 'd',
    guidance: 'g',
    ingest_only: true,
  });
  assert.equal(p.ingest_only, true);
});

test('Persona.create rejects empty guidance (commitment is required)', () => {
  assert.throws(
    () =>
      Persona.create({
        name: 'x',
        title: 't',
        description: 'd',
        guidance: '',
      }),
    /guidance required/,
  );
});

test('Persona.create rejects empty title and description', () => {
  assert.throws(
    () => Persona.create({ name: 'x', title: '', description: 'd', guidance: 'g' }),
    /title required/,
  );
  assert.throws(
    () => Persona.create({ name: 'x', title: 't', description: '', guidance: 'g' }),
    /description required/,
  );
});

test('Persona.create rejects malformed name (uppercase, leading digit, too long)', () => {
  assert.throws(
    () => Persona.create({ name: 'Bad', title: 't', description: 'd', guidance: 'g' }),
    /persona name/,
  );
  assert.throws(
    () => Persona.create({ name: '1bad', title: 't', description: 'd', guidance: 'g' }),
    /persona name/,
  );
  assert.throws(
    () =>
      Persona.create({
        name: 'a'.repeat(49),
        title: 't',
        description: 'd',
        guidance: 'g',
      }),
    /persona name/,
  );
});
