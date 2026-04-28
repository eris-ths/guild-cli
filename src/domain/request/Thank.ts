import { MemberName } from '../member/MemberName.js';
import { sanitizeText } from '../shared/sanitizeText.js';

const MAX_REASON_LEN = 1024;

/**
 * A `Thank` is a cross-actor appreciation primitive — one member
 * thanking another for their work on a specific request. It's a
 * sibling of `Review` but with a different purpose:
 *
 *   - Review = analytical judgement (ok / concern / reject), feeds
 *     voice calibration, load-bearing for Two-Persona Devil.
 *   - Thank  = emotional memory, no verdict, does NOT feed
 *     calibration. Tracks gratitude as its own first-class record.
 *
 * Both live on the Request as append-only lists. Review already
 * exists; this is the thank primitive that pairs with it so the
 * guild has both analytical and emotional memory on one record.
 *
 * Design choices:
 *  - `to` is explicit rather than inferred. A request has many
 *    actors (from, executor, auto_review, status_log participants);
 *    without `to` the thanks would be ambiguous.
 *  - `reason` is optional. Most of the time the fact of the thank
 *    is the signal; a reason is nice-to-have, not required.
 *  - Sanitization mirrors Review's comment sanitizer: strip control
 *    chars, cap length. Short-form by construction.
 */

export interface ThankProps {
  by: MemberName;
  to: MemberName;
  at: string;
  reason?: string;
  /** See StatusLogEntry.invokedBy — same semantics here. */
  invokedBy?: string;
}

export class Thank {
  private constructor(private readonly props: ThankProps) {}

  static create(input: {
    by: string;
    to: string;
    at?: string;
    reason?: string;
    invokedBy?: string;
  }): Thank {
    const by = MemberName.of(input.by);
    const to = MemberName.of(input.to);
    const at = input.at ?? new Date().toISOString();
    const props: ThankProps = { by, to, at };
    if (input.reason !== undefined) {
      props.reason = sanitizeReason(input.reason);
    }
    if (input.invokedBy !== undefined && input.invokedBy !== by.value) {
      props.invokedBy = input.invokedBy;
    }
    return new Thank(props);
  }

  get by(): MemberName {
    return this.props.by;
  }
  get to(): MemberName {
    return this.props.to;
  }
  get at(): string {
    return this.props.at;
  }
  get reason(): string | undefined {
    return this.props.reason;
  }
  get invokedBy(): string | undefined {
    return this.props.invokedBy;
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      by: this.props.by.value,
      to: this.props.to.value,
      at: this.props.at,
    };
    if (this.props.reason !== undefined) out['reason'] = this.props.reason;
    if (this.props.invokedBy !== undefined) {
      out['invoked_by'] = this.props.invokedBy;
    }
    return out;
  }
}

function sanitizeReason(raw: unknown): string {
  return sanitizeText(raw, 'reason', {
    maxLen: MAX_REASON_LEN,
    requireNonEmpty: false,
    trim: false,
  });
}
