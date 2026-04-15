// QuarantineStore — port for moving offending files out of the hot
// path. Implementations enforce that both source and destination
// resolve under the configured content_root; path traversal must be
// rejected. The port is intentionally narrow: a single move() verb,
// no copy / no delete / no overwrite. Idempotency is the caller's
// responsibility (applyRepair skips actions whose source no longer
// exists).
//
// The destination directory layout is decided by the implementation,
// not by the use case, so the application layer stays unaware of the
// concrete filesystem shape.

export interface QuarantineResult {
  readonly source: string;
  readonly destination: string;
}

export interface QuarantineStore {
  /**
   * Move `absSource` into the quarantine area. Returns the absolute
   * destination path. Throws if `absSource` does not exist, escapes
   * the content root, or the move fails.
   */
  move(absSource: string): Promise<QuarantineResult>;

  /**
   * Returns true if the absolute path currently exists. Used by
   * applyRepair to make repair idempotent (already-quarantined files
   * are skipped without throwing).
   */
  sourceExists(absSource: string): boolean;
}
