import { Lense, parseLense } from '../shared/Lense.js';
import { Verdict, parseVerdict } from '../shared/Verdict.js';
import { MemberName } from '../member/MemberName.js';
import { DomainError } from '../shared/DomainError.js';

const MAX_COMMENT_LEN = 4096;

export interface ReviewProps {
  by: MemberName;
  lense: Lense;
  verdict: Verdict;
  comment: string;
  at: string;
}

export class Review {
  private constructor(private readonly props: ReviewProps) {}

  static create(input: {
    by: string;
    lense: string;
    verdict: string;
    comment: string;
    at?: string;
    allowedLenses?: readonly string[];
  }): Review {
    const by = MemberName.of(input.by);
    const lense = parseLense(input.lense, input.allowedLenses);
    const verdict = parseVerdict(input.verdict);
    const comment = sanitizeComment(input.comment);
    const at = input.at ?? new Date().toISOString();
    return new Review({ by, lense, verdict, comment, at });
  }

  get by(): MemberName {
    return this.props.by;
  }
  get lense(): Lense {
    return this.props.lense;
  }
  get verdict(): Verdict {
    return this.props.verdict;
  }
  get comment(): string {
    return this.props.comment;
  }
  get at(): string {
    return this.props.at;
  }

  toJSON(): Record<string, unknown> {
    return {
      by: this.props.by.value,
      lense: this.props.lense,
      verdict: this.props.verdict,
      comment: this.props.comment,
      at: this.props.at,
    };
  }
}

function sanitizeComment(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new DomainError('Review comment must be a string', 'comment');
  }
  // Strip control characters except newline/tab
  const cleaned = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  if (cleaned.length > MAX_COMMENT_LEN) {
    throw new DomainError(
      `Review comment too long (max ${MAX_COMMENT_LEN} chars)`,
      'comment',
    );
  }
  return cleaned;
}
