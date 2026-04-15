import { DomainError } from '../shared/DomainError.js';

// Accepts both 3- and 4-digit sequences for backward compatibility with
// pre-0.2.0 content roots. New ids are generated as 4 digits (see generate
// below) — ceiling is 9999/UTC day. Files written under the old 3-digit
// scheme keep loading without migration.
const PATTERN = /^\d{4}-\d{2}-\d{2}-\d{3,4}$/;

export class RequestId {
  private constructor(public readonly value: string) {}

  static of(raw: unknown): RequestId {
    if (typeof raw !== 'string' || !PATTERN.test(raw)) {
      throw new DomainError(
        `Invalid request id: "${String(raw)}". Expected YYYY-MM-DD-NNNN (or legacy NNN)`,
        'id',
      );
    }
    return new RequestId(raw);
  }

  static generate(today: Date, sequence: number): RequestId {
    if (!Number.isInteger(sequence) || sequence < 0 || sequence > 9999) {
      throw new DomainError(`Invalid sequence: ${sequence}`, 'sequence');
    }
    const yyyy = today.getUTCFullYear().toString().padStart(4, '0');
    const mm = (today.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = today.getUTCDate().toString().padStart(2, '0');
    const seq = sequence.toString().padStart(4, '0');
    return new RequestId(`${yyyy}-${mm}-${dd}-${seq}`);
  }

  toString(): string {
    return this.value;
  }
}
