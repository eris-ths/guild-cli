import { DomainError } from '../shared/DomainError.js';

const PATTERN = /^\d{4}-\d{2}-\d{2}-\d{3}$/;

export class RequestId {
  private constructor(public readonly value: string) {}

  static of(raw: unknown): RequestId {
    if (typeof raw !== 'string' || !PATTERN.test(raw)) {
      throw new DomainError(
        `Invalid request id: "${String(raw)}". Expected YYYY-MM-DD-NNN`,
        'id',
      );
    }
    return new RequestId(raw);
  }

  static generate(today: Date, sequence: number): RequestId {
    if (!Number.isInteger(sequence) || sequence < 0 || sequence > 999) {
      throw new DomainError(`Invalid sequence: ${sequence}`, 'sequence');
    }
    const yyyy = today.getUTCFullYear().toString().padStart(4, '0');
    const mm = (today.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = today.getUTCDate().toString().padStart(2, '0');
    const seq = sequence.toString().padStart(3, '0');
    return new RequestId(`${yyyy}-${mm}-${dd}-${seq}`);
  }

  toString(): string {
    return this.value;
  }
}
