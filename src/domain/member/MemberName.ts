import { DomainError } from '../shared/DomainError.js';

const MEMBER_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

const RESERVED_NAMES = new Set([
  'system',
  'root',
  'admin',
  'sudo',
  'null',
  'undefined',
  'constructor',
  'prototype',
  '__proto__',
]);

/**
 * MemberName — Value Object
 *
 * Security invariants:
 * - Lowercase alphanumerics + `_-` only (no path traversal, no shell metachars)
 * - Must start with letter
 * - Max 32 chars
 * - Reserved names blacklisted
 */
export class MemberName {
  private constructor(public readonly value: string) {}

  static of(raw: unknown): MemberName {
    if (typeof raw !== 'string') {
      throw new DomainError('Member name must be a string', 'name');
    }
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) {
      throw new DomainError('Member name required', 'name');
    }
    if (!MEMBER_NAME_PATTERN.test(trimmed)) {
      throw new DomainError(
        `Invalid member name: "${raw}". Must match /^[a-z][a-z0-9_-]{0,31}$/`,
        'name',
      );
    }
    if (RESERVED_NAMES.has(trimmed)) {
      throw new DomainError(`Reserved member name: "${trimmed}"`, 'name');
    }
    return new MemberName(trimmed);
  }

  equals(other: MemberName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
