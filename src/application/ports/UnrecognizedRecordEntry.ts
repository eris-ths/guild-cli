/**
 * One unrecognized entry discovered by a directory walk under a
 * record area (`requests/`, `issues/`, or `members/`). These are
 * files or directories that the area's `listAll` regex filter
 * silently drops — off-pattern names, .yaml files at the wrong
 * directory level (requests only — issues/members are flat), or
 * subdirectories where leaf files are expected.
 *
 * Surfaced by the diagnostic so `gate doctor` can warn about them;
 * pre-this they were invisible to the operator.
 *
 * The shape is shared across `RequestRepository`, `IssueRepository`,
 * and `MemberRepository` because the diagnostic treats them
 * identically — area tagging happens at the use-case layer, not on
 * the entry itself, so a single shape keeps the call sites uniform.
 */
export interface UnrecognizedRecordEntry {
  /** Absolute path to the entry. */
  readonly path: string;
  /** What kind of entry was found (file vs directory). */
  readonly kind: 'file' | 'directory';
  /** Why it was flagged — short, suitable for inclusion in a finding message. */
  readonly reason: string;
}
