// OkfBundlePort — Application's view of OKF bundle IO.
//
// The use case orchestrates "read all facts -> write a bundle" and
// "read a bundle -> save facts"; the *how* of touching a directory of
// markdown files (frontmatter serialization, path safety, reserved-file
// handling) is an infrastructure concern behind this port. Same
// dependency-inversion shape as CtxRepository.

import { OkfDocument } from '../../../domain/okf/OkfDocument.js';

/** A document the bundle reader could not turn into a usable concept. */
export interface OkfSkippedDoc {
  readonly path: string;
  readonly reason: string;
}

export interface OkfBundleReadResult {
  readonly docs: readonly OkfDocument[];
  readonly skipped: readonly OkfSkippedDoc[];
}

export interface OkfBundleWriteResult {
  /** Relative paths written, in write order (concepts then views). */
  readonly written: readonly string[];
}

export interface OkfBundlePort {
  /**
   * Write `docs` as an OKF bundle under `dir`, plus the generated
   * `index.md` / `log.md` view files. `dir` is created if absent.
   */
  write(dir: string, docs: readonly OkfDocument[]): Promise<OkfBundleWriteResult>;

  /**
   * Read an OKF bundle from `dir`. Reserved view files (`index.md`,
   * `log.md`) are excluded from `docs`. Unparseable or non-conformant
   * files land in `skipped` rather than failing the whole read.
   */
  read(dir: string): Promise<OkfBundleReadResult>;
}
