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
  /** See StatusLogEntry.invokedBy — same semantics here. */
  invokedBy?: string;
}

export class Review {
  private constructor(private readonly props: ReviewProps) {}

  static create(input: {
    by: string;
    lense: string;
    verdict: string;
    comment: string;
    at?: string;
    invokedBy?: string;
    allowedLenses?: readonly string[];
    /**
     * Whether to reject a lense that is not in `allowedLenses`.
     * Defaults to true — the write path must reject unknown
     * lenses so no surprise values enter the record. Hydration
     * passes false so that historical records whose lense has
     * since been removed from config still load (see i-0005).
     */
    strictLense?: boolean;
  }): Review {
    const by = MemberName.of(input.by);
    const lense = parseLense(
      input.lense,
      input.allowedLenses,
      input.strictLense !== false,
    );
    const verdict = parseVerdict(input.verdict);
    const comment = sanitizeComment(input.comment);
    const at = input.at ?? new Date().toISOString();
    const props: ReviewProps = { by, lense, verdict, comment, at };
    if (input.invokedBy !== undefined && input.invokedBy !== by.value) {
      props.invokedBy = input.invokedBy;
    }
    return new Review(props);
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

  get invokedBy(): string | undefined {
    return this.props.invokedBy;
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      by: this.props.by.value,
      lense: this.props.lense,
      verdict: this.props.verdict,
      comment: this.props.comment,
      at: this.props.at,
    };
    if (this.props.invokedBy !== undefined) {
      out['invoked_by'] = this.props.invokedBy;
    }
    return out;
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
