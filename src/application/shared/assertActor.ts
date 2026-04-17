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
  // Include a register hint in the error so a newcomer whose first
  // touch hits this wall learns the one-command way out. The
  // lowercase pre-validation already ran via MemberName.of above,
  // so `name.value` is a safe name to suggest. The hint is
  // deliberately short — the vertical table format used by
  // severity/verdict/lense would be overkill here because the
  // signal is "you're not registered yet, here's the fix."
  throw new DomainError(
    [
      `Invalid ${field}: "${raw}" — no such member or host.`,
      `  To register yourself as a member:`,
      `    gate register --name ${name.value}     # category defaults to "professional"`,
      `  Or set GUILD_ACTOR to an already-registered actor.`,
    ].join('\n'),
    field,
  );
}
