import YAML from 'yaml';
import { Member } from '../../domain/member/Member.js';
import { MemberName } from '../../domain/member/MemberName.js';
import { MemberRepository } from '../../application/ports/MemberRepository.js';
import {
  MAX_DIR_ENTRIES,
  existsSafe,
  listDirSafe,
  readTextSafe,
  writeTextSafe,
} from './safeFs.js';
import { join } from 'node:path';
import { GuildConfig } from '../config/GuildConfig.js';
import { OnMalformed } from '../../application/ports/OnMalformed.js';
import { parseYamlSafe } from './parseYamlSafe.js';

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
    const absSource = join(this.config.paths.members, file);
    const data = parseYamlSafe(raw, absSource, this.config.onMalformed);
    if (data === undefined) return null;
    return hydrate(data, name.value, absSource, this.config.onMalformed);
  }

  async exists(name: MemberName): Promise<boolean> {
    return existsSafe(this.config.paths.members, `${name.value}.yaml`);
  }

  async listAll(): Promise<Member[]> {
    const files = listDirSafe(this.config.paths.members, '.').filter((f) =>
      /^[a-z][a-z0-9_-]{0,31}\.yaml$/.test(f),
    );
    const out: Member[] = [];
    for (const f of files.slice(0, MAX_DIR_ENTRIES)) {
      const raw = readTextSafe(this.config.paths.members, f);
      const name = f.replace(/\.yaml$/, '');
      const absSource = join(this.config.paths.members, f);
      const data = parseYamlSafe(raw, absSource, this.config.onMalformed);
      if (data === undefined) continue;
      const m = hydrate(data, name, absSource, this.config.onMalformed);
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

function hydrate(
  data: unknown,
  fallbackName: string,
  source: string,
  onMalformed: OnMalformed,
): Member | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    onMalformed(source, 'top-level YAML is not a mapping; skipping');
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    onMalformed(
      source,
      `hydrate failed (name=${name}), skipping record: ${msg}`,
    );
    return null;
  }
}
