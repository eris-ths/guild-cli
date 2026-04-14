import YAML from 'yaml';
import { Member } from '../../domain/member/Member.js';
import { MemberName } from '../../domain/member/MemberName.js';
import { MemberRepository } from '../../application/ports/MemberRepository.js';
import {
  assertUnder,
  existsSafe,
  listDirSafe,
  readTextSafe,
  writeTextSafe,
} from './safeFs.js';
import { GuildConfig } from '../config/GuildConfig.js';

/**
 * File layout: <config.paths.members>/<name>.yaml
 *
 * YAML loaded via yaml lib's default schema which is json-like and does NOT
 * execute custom tags. For extra paranoia we validate the parsed result is a
 * plain object before mapping to domain.
 */
export class YamlMemberRepository implements MemberRepository {
  constructor(private readonly config: GuildConfig) {}

  async findByName(name: MemberName): Promise<Member | null> {
    const file = `${name.value}.yaml`;
    if (!existsSafe(this.config.paths.members, file)) return null;
    const raw = readTextSafe(this.config.paths.members, file);
    const data = YAML.parse(raw);
    return hydrate(data, name.value);
  }

  async exists(name: MemberName): Promise<boolean> {
    return existsSafe(this.config.paths.members, `${name.value}.yaml`);
  }

  async listAll(): Promise<Member[]> {
    const files = listDirSafe(this.config.paths.members, '.').filter((f) =>
      /^[a-z][a-z0-9_-]{0,31}\.yaml$/.test(f),
    );
    const out: Member[] = [];
    for (const f of files.slice(0, 1000)) {
      const raw = readTextSafe(this.config.paths.members, f);
      const data = YAML.parse(raw);
      const name = f.replace(/\.yaml$/, '');
      const m = hydrate(data, name);
      if (m) out.push(m);
    }
    return out;
  }

  async save(member: Member): Promise<void> {
    const file = `${member.name.value}.yaml`;
    const data = member.toJSON();
    const text = YAML.stringify(data);
    writeTextSafe(this.config.paths.members, file, text);
  }

  async listHostNames(): Promise<string[]> {
    return [...this.config.hostNames];
  }
}

function hydrate(data: unknown, fallbackName: string): Member | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  const obj = data as Record<string, unknown>;
  const name =
    typeof obj['name'] === 'string' ? (obj['name'] as string) : fallbackName;
  const category =
    typeof obj['category'] === 'string' ? (obj['category'] as string) : 'core';
  const active = obj['active'] === false ? false : true;
  const displayName =
    typeof obj['displayName'] === 'string'
      ? (obj['displayName'] as string)
      : typeof obj['display_name'] === 'string'
        ? (obj['display_name'] as string)
        : undefined;
  try {
    const args: Parameters<typeof Member.create>[0] = {
      name,
      category,
      active,
    };
    if (displayName !== undefined) args.displayName = displayName;
    return Member.create(args);
  } catch {
    return null;
  }
}

// Silence unused import warning
void assertUnder;
