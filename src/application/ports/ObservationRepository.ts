import {
  Observation,
  ObservationId,
  ObservationKind,
} from '../../domain/observation/Observation.js';
import { UnrecognizedRecordEntry } from './UnrecognizedRecordEntry.js';

/**
 * Port for the observation store.
 *
 * Deliberately narrower than `IssueRepository` / `RequestRepository`:
 * there is **no `save`**, only `saveNew`. Observations are append-only
 * facts about runs that already happened, so there is no legitimate
 * caller for "write this record back" — and with no update path there
 * is nothing for two writers to race over, which is why no version /
 * CAS machinery appears here either. The absence is the invariant.
 */
export interface ObservationRepository {
  findById(id: ObservationId): Promise<Observation | null>;
  listAll(): Promise<Observation[]>;
  /** Every observation attached to one wave, oldest first. */
  listBySubject(requestId: string): Promise<Observation[]>;
  listByKind(kind: ObservationKind): Promise<Observation[]>;
  /**
   * Surface entries that don't match the expected layout — .yaml files
   * whose name doesn't match `o-YYYY-MM-DD-NNNN.yaml` (silent listAll
   * drops) and subdirectories (the layout is flat). Diagnostic only.
   */
  listUnrecognizedFiles(): Promise<UnrecognizedRecordEntry[]>;
  /**
   * How many files on disk are *shaped* like observation records,
   * whether or not they hydrate.
   *
   * The list methods drop a record that fails hydrate — correctly, so
   * one corrupt file cannot take down a read — but that leaves "no
   * records" and "records I could not read" producing the same answer,
   * and the second one silently. A caller that reports emptiness needs
   * to be able to tell those apart.
   *
   * This became reachable rather than theoretical when `policy` moved
   * from `extra` into the contract: hydrate re-validates, so a record
   * written while a block was unspecified can stop being readable the
   * day it is specified. Zero such records exist today; the next block
   * promoted will not have that luxury.
   */
  countRecordFiles(): Promise<number>;
  /**
   * Create a brand-new observation file. Must fail with
   * `ObservationIdCollision` if a file for this id already exists —
   * callers rely on the error to drive sequence-allocation retry.
   */
  saveNew(observation: Observation): Promise<void>;
  nextSequence(dateKey: string): Promise<number>;
}

export class ObservationIdCollision extends Error {
  constructor(id: string) {
    super(`Observation id already exists: ${id}`);
    this.name = 'ObservationIdCollision';
  }
}
