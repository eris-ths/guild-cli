// TrapSweepUseCases — application layer for `gate doctor sweep-traps` (#327).
//
// Trap memory is a markdown file with optional frontmatter:
//
//   ---
//   relevant_until: 2026-04-01     # ISO date OR the literal `indefinite`
//   ---
//   <body — free-form markdown>
//
// Sweep is the quarantine-based retirement path: when `relevant_until`
// is an ISO date that has passed, the trap is moved to a sibling
// `trap-quarantine/` directory and a single line is appended to a
// `trap-retirement-log.yaml` file. Records-outlive-writers (principle
// 04): nothing is ever deleted; quarantine + log is the entire shape.
//
// Two surfaces:
//
//   plan(now, traps)     — pure. Returns one TrapPlanEntry per trap
//                          describing the action the apply pass would
//                          take (sweep | keep | invalid).
//   apply / revive       — interface-layer concerns (use node:fs against
//                          absolute paths). Live in the handler.
//
// Why the split: planning is a function of (now, frontmatter values)
// and benefits from unit-test isolation. Filesystem I/O is intentionally
// kept in the handler because it is a single-shot, single-content_root
// operation — wiring a port abstraction would be more boilerplate than
// the call site warrants for one verb.

/**
 * Parsed trap descriptor handed to the planner. The handler scans
 * `<content_root>/lore/traps/` for `*.md` files and produces one of
 * these per file before invoking `planTrapSweep`.
 *
 * `relevantUntil`:
 *   - `null`           : no frontmatter, OR frontmatter present but the
 *                        field is absent. Treated as `indefinite` per
 *                        principle 04 (safe default — never sweep).
 *   - `'indefinite'`   : explicit indefinite — never sweep.
 *   - `Date`           : ISO date parsed from the frontmatter value.
 *   - `'invalid'`      : a non-empty value that did not parse as an ISO
 *                        date and was not the literal 'indefinite'.
 *                        The planner surfaces it as `kept-invalid` so
 *                        the operator sees the typo without losing the
 *                        file to a silent default.
 */
export type RelevantUntil = null | 'indefinite' | 'invalid' | Date;

export interface TrapDescriptor {
  /** Filename only (e.g. `trap_silent_fallback_loses_signal.md`). */
  readonly filename: string;
  /** Absolute path to the trap on disk. */
  readonly absolutePath: string;
  readonly relevantUntil: RelevantUntil;
  /**
   * The raw frontmatter string for `relevant_until`, surfaced verbatim
   * in the plan output and the audit log so the operator sees the
   * value that triggered the sweep. `null` when no frontmatter or no
   * field was present.
   */
  readonly rawValue: string | null;
}

export type TrapPlanAction =
  | 'sweep'           // expired ISO date < now
  | 'keep-future'     // ISO date in the future
  | 'keep-indefinite' // explicit indefinite OR no frontmatter (safe default)
  | 'keep-invalid';   // unparseable value — surfaced for the operator

export interface TrapPlanEntry {
  readonly trap: TrapDescriptor;
  readonly action: TrapPlanAction;
  /**
   * Human-readable rationale carried into the dry-run report and (when
   * `action === 'sweep'`) into the audit log entry's `reason:` field.
   */
  readonly rationale: string;
}

export interface TrapSweepPlan {
  readonly entries: readonly TrapPlanEntry[];
}

/**
 * Pure planner: classify each trap by its `relevant_until` against a
 * fixed `now`. Tests inject a deterministic `now`; production passes
 * `new Date()`. Day-granularity comparison: a trap with
 * `relevant_until: 2026-05-11` is NOT swept on 2026-05-11 itself —
 * it's still relevant *until* that date. Sweep fires the day after.
 */
export function planTrapSweep(
  now: Date,
  traps: readonly TrapDescriptor[],
): TrapSweepPlan {
  const todayUtc = toUtcDayStart(now);
  const entries: TrapPlanEntry[] = traps.map((trap) => {
    const ru = trap.relevantUntil;
    if (ru === null) {
      return {
        trap,
        action: 'keep-indefinite' as const,
        rationale:
          'no relevant_until frontmatter — treated as indefinite per principle 04 (safe default).',
      };
    }
    if (ru === 'indefinite') {
      return {
        trap,
        action: 'keep-indefinite' as const,
        rationale: 'relevant_until: indefinite — never auto-swept.',
      };
    }
    if (ru === 'invalid') {
      return {
        trap,
        action: 'keep-invalid' as const,
        rationale:
          `relevant_until value ${JSON.stringify(trap.rawValue)} did not parse as an ISO date or 'indefinite' — kept (safe default).`,
      };
    }
    const dueUtc = toUtcDayStart(ru);
    if (dueUtc.getTime() < todayUtc.getTime()) {
      return {
        trap,
        action: 'sweep' as const,
        rationale: `expired (relevant_until: ${trap.rawValue})`,
      };
    }
    return {
      trap,
      action: 'keep-future' as const,
      rationale: `still relevant (relevant_until: ${trap.rawValue}).`,
    };
  });
  return { entries };
}

/**
 * Parse a raw `relevant_until` frontmatter string into the typed
 * `RelevantUntil` shape. Whitespace is trimmed; `indefinite` is matched
 * case-insensitively; ISO dates are validated by re-rendering and
 * comparing to reject malformed-but-coercible inputs (`2026-13-99` etc).
 */
export function parseRelevantUntil(raw: string | null): RelevantUntil {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.toLowerCase() === 'indefinite') return 'indefinite';
  // Accept only YYYY-MM-DD (no time/zone). Strict regex avoids
  // accepting partial dates that Date() would happily coerce.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!m) return 'invalid';
  const [, y, mo, d] = m as unknown as [string, string, string, string];
  const yi = Number.parseInt(y, 10);
  const mi = Number.parseInt(mo, 10);
  const di = Number.parseInt(d, 10);
  // Build a UTC date and validate round-trip — rejects 2026-02-31 etc.
  const dt = new Date(Date.UTC(yi, mi - 1, di));
  if (
    dt.getUTCFullYear() !== yi ||
    dt.getUTCMonth() !== mi - 1 ||
    dt.getUTCDate() !== di
  ) {
    return 'invalid';
  }
  return dt;
}

/**
 * Extract the raw string value of a single frontmatter key, or null if
 * the document has no frontmatter block or the key is absent.
 *
 * Frontmatter is the YAML-flavoured `---\n...\n---` opener many
 * markdown files use. We do NOT pull in a YAML parser for this — the
 * trap-frontmatter contract is a single scalar field (`relevant_until`)
 * with no nesting, so a one-line key:value scan is sufficient and
 * keeps the dependency surface small. Lines beginning with `#` inside
 * the frontmatter are skipped (YAML comments).
 */
export function extractFrontmatterField(
  raw: string,
  key: string,
): string | null {
  // The opener must be the very first three chars of the file, then
  // a newline. Many editors strip trailing whitespace; allow optional
  // trailing whitespace on the opener line.
  if (!/^---[ \t]*\r?\n/.test(raw)) return null;
  const afterOpen = raw.slice(raw.indexOf('\n') + 1);
  // The closer is `---` on its own line. Find the next one.
  const closeMatch = /(^|\r?\n)---[ \t]*(\r?\n|$)/.exec(afterOpen);
  if (!closeMatch) return null;
  const block = afterOpen.slice(0, closeMatch.index);
  const lines = block.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 0) continue;
    const k = trimmed.slice(0, colon).trim();
    if (k !== key) continue;
    let v = trimmed.slice(colon + 1).trim();
    // Strip surrounding quotes if present.
    if (
      (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
      (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
    ) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return null;
}

/**
 * Floor a Date to the start of its UTC day. Used by the planner so the
 * comparison is calendar-day, not millisecond — a trap due on
 * 2026-05-11 should be considered expired starting 2026-05-12 00:00 UTC,
 * regardless of the wall-clock time at which `gate doctor sweep-traps`
 * runs.
 */
function toUtcDayStart(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}
