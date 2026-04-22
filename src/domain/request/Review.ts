import { Lense, parseLense } from '../shared/Lense.js';
import { Verdict, parseVerdict } from '../shared/Verdict.js';
import { MemberName } from '../member/MemberName.js';
import { DomainError } from '../shared/DomainError.js';
import { sanitizeText as sharedSanitizeText } from '../shared/sanitizeText.js';

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
  }): Review {
    const by = MemberName.of(input.by);
    const lense = parseLense(input.lense, input.allowedLenses);
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

/**
 * Review comments have two quirks vs other text fields:
 *   - `trim: false` — inner/trailing whitespace preserved so code blocks
 *     and indented bullets render correctly (the interface layer
 *     already stripped leading/trailing before calling create)
 *   - `requireNonEmpty: false` — empty-string comments are tolerated
 *     here at the domain level. The interface layer (handlers/review.ts)
 *     enforces "comment required" at its own boundary. This split keeps
 *     the domain permissive for programmatic callers who may have a
 *     legitimate empty-comment use (audit backfill, etc.) while still
 *     giving the CLI a UX nudge.
 *
 * Note: the second quirk is a drift that pre-dates consolidation. If it
 * turns out no caller relies on empty-comment passthrough, tighten to
 * `requireNonEmpty: true` in a later patch — consistency beats a loose
 * back-door every time.
 */
function sanitizeComment(raw: unknown): string {
  return sharedSanitizeText(raw, 'comment', {
    maxLen: MAX_COMMENT_LEN,
    trim: false,
    requireNonEmpty: false,
  });
}
