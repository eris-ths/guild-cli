// devil-review — bundled default lense catalog (11 lenses, v0).
//
// Source: issue #126 lense table. The 8 Claude Security categories
// (injection / injection-parser / path-network / auth-access /
// memory-safety / crypto / deserialization / protocol-encoding)
// plus 3 devil-review-specific lenses (composition / temporal /
// supply-chain). The supply-chain lense carries `delegate: scg` —
// hard-error-if-unavailable per issue #126's "妥協せず全力" intent.
//
// Inlined as a TypeScript const rather than YAML files to avoid a
// build-time copy step. When content_root override (per-project
// custom lenses) lands, the loader will share the same Lense.create
// path, keeping bundled and overridden lenses in one shape.

import { Lense } from './Lense.js';

const DEFAULTS_RAW: ReadonlyArray<Parameters<typeof Lense.create>[0]> = [
  {
    name: 'injection',
    title: 'Injection',
    description:
      'Untrusted input that changes query structure or executes. Covers SQL, command, code, and XSS injection — anywhere a string from outside the trust boundary is concatenated into a structured sink.',
    ingest_sources: ['claude-security', 'ultrareview'],
    examples: [
      'untrusted user input concatenated into SQL',
      'shell command built from request params',
      'HTML rendering without contextual escaping',
    ],
  },
  {
    name: 'injection-parser',
    title: 'Parser-driven Injection (XXE, ReDoS)',
    description:
      'Parsers or regular expressions weaponized by crafted input. XML external entities, regex catastrophic backtracking, deserializer pivots that look like injection but exploit the parser itself.',
    ingest_sources: ['claude-security', 'ultrareview'],
    examples: [
      'XML <!ENTITY> reading /etc/passwd',
      'regex with nested quantifiers on user input',
    ],
  },
  {
    name: 'path-network',
    title: 'Path & Network',
    description:
      'Inputs that control file paths, request destinations, or redirects. Path traversal, SSRF, open redirects, file-URL handling. The trust boundary sits between "user-supplied location" and "what the server fetches/serves".',
    ingest_sources: ['claude-security', 'ultrareview'],
    examples: [
      '../../etc/passwd via filename param',
      'fetching http://169.254.169.254/ from a user-supplied URL',
      'open redirect via unchecked Location header',
    ],
  },
  {
    name: 'auth-access',
    title: 'Authentication & Access Control',
    description:
      'Access checks missing, skippable, or racy. Auth bypass, privilege escalation, IDOR/BOLA, CSRF, time-of-check vs time-of-use races on access decisions. Often surfaces as "GET /orders/123 returns another user\'s order".',
    ingest_sources: ['claude-security', 'ultrareview'],
    examples: [
      'IDOR: GET /orders/<id> without ownership check',
      'role check skipped when an alternative endpoint reaches the same write',
      'CSRF on state-changing GET',
    ],
  },
  {
    name: 'memory-safety',
    title: 'Memory Safety',
    description:
      'Inputs writing past bounds, integers wrapping, or hits on freed memory. Primarily C / C++ / Rust unsafe, but applies anywhere manual memory management or interop with native code is in play.',
    ingest_sources: ['claude-security', 'ultrareview'],
    examples: [
      'buffer overflow from unchecked length-prefixed read',
      'integer overflow producing too-small allocation',
      'use-after-free via double-handle pattern',
    ],
  },
  {
    name: 'crypto',
    title: 'Cryptography',
    description:
      'Secret-dependent branches, algorithm confusion, weak primitives. Timing leaks, JWT alg=none, MD5/SHA-1/DES/ECB on security paths, predictable IVs, missing authenticated encryption.',
    ingest_sources: ['claude-security', 'ultrareview'],
    examples: [
      'JWT verification accepting alg=none',
      'MD5 used for password hashing',
      'AES-ECB on user data',
      'string equality on HMAC comparison',
    ],
  },
  {
    name: 'deserialization',
    title: 'Deserialization (arbitrary type instantiation)',
    description:
      'Untrusted bytes driving object construction. Python pickle, Java readObject, YAML load, .NET BinaryFormatter — frequently equivalent to RCE because the reconstructed types can carry side-effecting constructors.',
    ingest_sources: ['claude-security', 'ultrareview'],
    examples: [
      'pickle.loads on a request body',
      'YAML.load (vs safe_load) on config from a user',
      'Java ObjectInputStream over a network socket',
    ],
  },
  {
    name: 'protocol-encoding',
    title: 'Protocol & Encoding',
    description:
      'Layer mismatches or trust in declared sizes. Cache safety, encoding confusion (Unicode normalization, UTF-7), length-prefix trust, request smuggling between proxies and origins.',
    ingest_sources: ['claude-security', 'ultrareview'],
    examples: [
      'cache poisoning via Host header',
      'HTTP request smuggling between CDN and origin',
      'Unicode normalization changing the validated string',
    ],
  },
  {
    name: 'supply-chain',
    title: 'Supply Chain',
    description:
      'npm/yarn dependency compromise, known IOCs, lockfile drift, transitive dependency exposure. This lense delegates to supply-chain-guard (SCG) — devil-review fails closed if SCG is unavailable, per issue #126\'s "compromise-nothing" intent.',
    ingest_sources: ['scg'],
    delegate: 'scg',
    examples: [
      'npm package update bringing transitive malware payload',
      'lockfile out of sync with declared deps',
      'a dependency added in this PR that was not present in main',
    ],
  },
  {
    name: 'composition',
    title: 'Composition-level Vulnerabilities',
    description:
      'Each file is fine; the combination leaks data, escalates trust, or breaks an invariant. Diff-bounded review tends to miss this — devil-review keeps the lense available because composition is what surfaces last and matters most in security incidents.',
    ingest_sources: [],
    examples: [
      'two endpoints individually safe, but combined create an enumeration oracle',
      'logging that captures a value sanitized at one boundary but raw at another',
      'auth middleware order changing under a refactor',
    ],
  },
  {
    name: 'temporal',
    title: 'Temporal Reasoning',
    description:
      'Race conditions, TOCTOU, retry semantics, idempotency, time-window assumptions. Easy to miss in single-pass review because the model has no native sense of "two requests overlap" or "retry happens 30 seconds later".',
    ingest_sources: [],
    examples: [
      'check-then-write race on a shared resource',
      'retry handler that double-charges',
      'expiry comparison in different timezones',
    ],
  },
];

/**
 * Build the bundled default catalog. Called once at module init by
 * the catalog adapter; the resulting Map is read-only at runtime.
 *
 * Throws (via Lense.create) if any default is malformed — that is a
 * package-shipped bug, not a runtime input error, so we want the
 * test suite to surface it immediately rather than silently degrade.
 */
export function buildDefaultLenses(): ReadonlyMap<string, Lense> {
  const map = new Map<string, Lense>();
  for (const raw of DEFAULTS_RAW) {
    const lense = Lense.create(raw);
    if (map.has(lense.name)) {
      throw new Error(`duplicate default lense name: ${lense.name}`);
    }
    map.set(lense.name, lense);
  }
  return map;
}

/** Names of the bundled default lenses, for v0 discoverability. */
export const DEFAULT_LENSE_NAMES: readonly string[] = DEFAULTS_RAW.map((d) => d.name);
