import { Member } from '../../domain/member/Member.js';
import { MemberName } from '../../domain/member/MemberName.js';
import { MemberRepository } from '../ports/MemberRepository.js';

export class MemberUseCases {
  constructor(private readonly members: MemberRepository) {}

  async list(): Promise<Member[]> {
    return this.members.listAll();
  }

  async show(name: string): Promise<Member | null> {
    return this.members.findByName(MemberName.of(name));
  }

  async create(input: {
    name: string;
    category: string;
    displayName?: string;
  }): Promise<Member> {
    const member = Member.create(input);
    await this.members.save(member);
    return member;
  }
}
