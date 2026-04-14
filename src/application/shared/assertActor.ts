import { MemberName } from '../../domain/member/MemberName.js';
import { MemberRepository } from '../ports/MemberRepository.js';
import { DomainError } from '../../domain/shared/DomainError.js';

/**
 * Assert that the given name is a known member or a registered host name.
 * This is the single point where command-line actor fields (`--by`, `--from`,
 * `--executor`, `--auto-review`, `--to`, `--exclude`) are verified.
 */
export async function assertActor(
  raw: string,
  field: string,
  members: MemberRepository,
): Promise<MemberName> {
  const name = MemberName.of(raw);
  if (await members.exists(name)) return name;
  const hosts = await members.listHostNames();
  if (hosts.includes(name.value)) return name;
  throw new DomainError(
    `Invalid ${field}: "${raw}" — no such member or host`,
    field,
  );
}
