import { Request } from '../../domain/request/Request.js';
import { RequestId } from '../../domain/request/RequestId.js';
import { RequestState } from '../../domain/request/RequestState.js';

/**
 * One unrecognized file discovered by a directory walk under
 * `<contentRoot>/requests/`. These are files that listByState's
 * regex filter silently drops — off-pattern names, .yaml files at
 * the wrong directory level, or subdirectories where leaf files
 * are expected. Surfaced by the diagnostic so doctor can warn
 * about them; pre-this they were invisible.
 */
export interface UnrecognizedRequestFile {
  /** Absolute path to the entry. */
  readonly path: string;
  /** What kind of entry was found (file vs directory). */
  readonly kind: 'file' | 'directory';
  /** Why it was flagged — short, suitable for inclusion in a finding message. */
  readonly reason: string;
}

export interface RequestRepository {
  findById(id: RequestId): Promise<Request | null>;
  listByState(state: RequestState): Promise<Request[]>;
  /**
   * List every request in every state, deduplicated by id. Used by
   * cross-cutting read commands (voices, tail, whoami, chain) that
   * don't care about lifecycle state. Implementations should read
   * all state directories in parallel and dedupe on id in case a
   * concurrent transition caused the same file to appear under two
   * state directories during the scan.
   */
  listAll(): Promise<Request[]>;
  /**
   * Walk the requests directory and surface entries that don't
   * match the expected layout — .yaml files at off-pattern names
   * (silent listByState drops), .yaml files at the requests/ root
   * (wrong directory level), or subdirectories under <state>/
   * (no legitimate place there). Used exclusively by the
   * diagnostic; never affects lifecycle reads.
   */
  listUnrecognizedFiles(): Promise<UnrecognizedRequestFile[]>;
  /** Persist; positions file under current state directory. */
  save(request: Request): Promise<void>;
  /**
   * Create a brand-new request file. Must fail with `RequestIdCollision`
   * if a file for this id already exists anywhere in the requests tree —
   * callers rely on the error to drive sequence-allocation retry.
   */
  saveNew(request: Request): Promise<void>;
  /** Allocate a candidate sequence number for the given date (YYYY-MM-DD). */
  nextSequence(dateKey: string): Promise<number>;
}

export class RequestIdCollision extends Error {
  constructor(id: string) {
    super(`Request id already exists: ${id}`);
    this.name = 'RequestIdCollision';
  }
}

/**
 * Thrown when `save()` detects that the on-disk total mutation count
 * (status_log.length + reviews.length) has grown since the request
 * was loaded — i.e. another writer committed a transition or a
 * review in the meantime. Callers should reload and retry rather
 * than blindly overwrite.
 */
export class RequestVersionConflict extends Error {
  readonly code = 'REQUEST_VERSION_CONFLICT' as const;
  constructor(
    readonly id: string,
    readonly expected: number,
    readonly found: number,
  ) {
    super(
      `Request ${id} changed on disk (expected version ${expected}, found ${found}); reload and retry`,
    );
    this.name = 'RequestVersionConflict';
  }
}
