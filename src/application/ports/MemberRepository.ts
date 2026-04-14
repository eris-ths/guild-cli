import { Member } from '../../domain/member/Member.js';
import { MemberName } from '../../domain/member/MemberName.js';

export interface MemberRepository {
  findByName(name: MemberName): Promise<Member | null>;
  exists(name: MemberName): Promise<boolean>;
  listAll(): Promise<Member[]>;
  save(member: Member): Promise<void>;
  /** Host names (not real members but valid actors: eris, nao, etc.) */
  listHostNames(): Promise<string[]>;
}
