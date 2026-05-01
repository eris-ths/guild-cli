import { Member } from '../../domain/member/Member.js';
import { MemberName } from '../../domain/member/MemberName.js';
import { UnrecognizedRecordEntry } from './UnrecognizedRecordEntry.js';

export interface MemberRepository {
  findByName(name: MemberName): Promise<Member | null>;
  exists(name: MemberName): Promise<boolean>;
  listAll(): Promise<Member[]>;
  /**
   * Walk the members directory and surface entries that don't match
   * the expected layout — .yaml files whose name doesn't match the
   * `[a-z][a-z0-9_-]{0,31}.yaml` pattern (silent listAll drops:
   * uppercase, leading digit, too long) and subdirectories (flat
   * layout; nested dirs have no legitimate place). Used exclusively
   * by the diagnostic.
   */
  listUnrecognizedFiles(): Promise<UnrecognizedRecordEntry[]>;
  save(member: Member): Promise<void>;
  /** Host names (not real members but valid actors: eris, nao, etc.) */
  listHostNames(): Promise<string[]>;
}
