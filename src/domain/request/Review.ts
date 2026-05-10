import { Lense, parseLense, parseLenseLoose } from '../shared/Lense.js';
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

  /**
   * Create a new review at the application/domain boundary.
   *
   * Strict on `comment`: empty / whitespace-only is rejected. The
   * judgment-trail principle (records outlive writers) wants every
   * fresh review entry to carry actual prose. Bypass via `restore`
   * only — and that path exists for hydration of pre-strictness
   * substrate, not for new writes.
   *
   * Pre-2026-05 this was tolerant at the domain level and strict
   * only at the CLI handler. That left the application API
   * (`RequestUseCases.review`) and any future programmatic caller
   * able to land empty comments. Tightening here makes the domain
   * the load-bearing gate.
   */
  static create(input: {
    by: string;
    lense: string;
    verdict: string;
    comment: string;
    at?: string;
    invokedBy?: string;
    allowedLenses?: readonly string[];
  }): Review {
    return Review.build(input, /* strictComment */ true);
  }

  /**
   * Re-hydrate from on-disk YAML. Tolerant of empty comments — the
   * fallback in `YamlRequestRepository.findById` injects `''` when a
   * historical record predates `comment`-strictness or has the field
   * dropped. Failing hydration would erase those records from list
   * outputs; tolerating them keeps the audit trail visible while
   * still funneling fresh writes through the strict `create` path.
   */
  static restore(input: {
    by: string;
    lense: string;
    verdict: string;
    comment: string;
    at?: string;
    invokedBy?: string;
    allowedLenses?: readonly string[];
  }): Review {
    return Review.build(input, /* strictComment */ false);
  }

  private static build(
    input: {
      by: string;
      lense: string;
      verdict: string;
      comment: string;
      at?: string;
      invokedBy?: string;
      allowedLenses?: readonly string[];
    },
    strictComment: boolean,
  ): Review {
    const by = MemberName.of(input.by);
    // Hydrate path uses the loose parser (records-outlive-writers): a
    // historical record's lense was already validated at write time;
    // re-checking it against a possibly-changed allowed-set (config
    // edited, or #134 H2 strict mode toggled since the write) would
    // erase the record from list/show output and break the audit
    // trail. Strict path keeps the allowed-set check so a fresh write
    // with a typo'd lense still fails closed.
    const lense = strictComment
      ? parseLense(input.lense, input.allowedLenses)
      : parseLenseLoose(input.lense);
    const verdict = parseVerdict(input.verdict);
    const comment = sanitizeComment(input.comment, strictComment);
    // sanitize keeps inner/leading whitespace (`trim: false` so code
    // blocks render); domain-side strict path also rejects whitespace-
    // only input so a programmatic caller can't bypass the CLI's
    // `!comment.trim()` check by passing `"   "`.
    if (strictComment && comment.trim().length === 0) {
      throw new DomainError('comment required (cannot be blank)', 'comment');
    }
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
 * Review comments have one quirk vs other text fields:
 *   - `trim: false` — inner/trailing whitespace preserved so code
 *     blocks and indented bullets render correctly (the interface
 *     layer already stripped leading/trailing before calling create).
 *
 * Strictness is parameterised: `Review.create` passes
 * `requireNonEmpty: true`, `Review.restore` passes `false`. The split
 * lets fresh writes always carry prose while letting hydration tolerate
 * historical empty-comment records.
 */
function sanitizeComment(raw: unknown, requireNonEmpty: boolean): string {
  return sharedSanitizeText(raw, 'comment', {
    maxLen: MAX_COMMENT_LEN,
    trim: false,
    requireNonEmpty,
  });
}
