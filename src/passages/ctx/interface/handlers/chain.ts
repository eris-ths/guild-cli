import { CtxUseCases } from '../../application/CtxUseCases.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';
import { parseFormat } from '../../../../interface/shared/parseFormat.js';
import {
  ParsedArgs,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { DomainError } from '../../../../domain/shared/DomainError.js';
import { RecoverableError } from '../../../../interface/shared/errorEnvelope.js';
import { Ctx } from '../../domain/Ctx.js';

const CHAIN_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format']);

export interface ChainCtxDeps {
  readonly uc: CtxUseCases;
  readonly config: GuildConfig;
}

/** First non-empty, collapsed, truncated line of a fact — for tree rows. */
function snippet(fact: string, max = 72): string {
  const line = fact
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (line === undefined) return '';
  const collapsed = line.replace(/\s+/g, ' ');
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

/** One tree row for a resolved fact. */
function factRow(c: Ctx): string {
  return `${c.id}  ${c.created_by}  ${snippet(c.fact)}`;
}

/**
 * ctx chain — show the one-hop neighborhood around a fact.
 *
 * Usage:
 *   ctx chain <id> [--format json|text]
 *
 * Walks four edge kinds from the root: outbound (ctx ids the root's prose
 * mentions), inbound (facts whose prose mentions the root), and the two
 * supersession links (the fact the root corrects, and the facts that
 * correct the root). One hop only — to go deeper, run `ctx chain` on a
 * surfaced id (same single-step discipline as `gate chain`). A dangling
 * outbound reference (prose mentions an absent id) is shown as
 * `(referenced but not found)` rather than dropped. A missing root is a
 * recoverable not-found that names `ctx list` as the recovery path.
 */
export async function chainCtx(
  deps: ChainCtxDeps,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, CHAIN_KNOWN_FLAGS, 'chain');
  const format = parseFormat(args);

  const id = args.positional[0];
  if (id === undefined || id.length === 0) {
    throw new DomainError('chain requires a fact id (ctx chain <id>)', 'id');
  }

  const chain = await deps.uc.chain(id); // chain() validates id shape

  if (chain === null) {
    throw new RecoverableError(
      `ctx fact ${id} not found.\n` +
        '  list the recorded facts to find the right id:\n' +
        '    ctx list',
      { verb: 'list', args: {}, reason: 'list the recorded facts to find the right id' },
      'not_found',
    );
  }

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          root: chain.root.toJSON(),
          outbound: chain.outbound.map((r) => ({
            id: r.id,
            resolved: r.fact !== null,
            ...(r.fact !== null ? { fact: r.fact.toJSON() } : {}),
          })),
          inbound: chain.inbound.map((c) => c.toJSON()),
          supersedes: chain.supersedes !== null ? chain.supersedes.toJSON() : null,
          superseded_by: chain.supersededBy.map((c) => c.toJSON()),
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  }

  // text: a one-hop tree rooted at the fact.
  const out: string[] = [];
  out.push(`${chain.root.id}  ${chain.root.created_by}  ${snippet(chain.root.fact)}`);

  const empty =
    chain.outbound.length === 0 &&
    chain.inbound.length === 0 &&
    chain.supersedes === null &&
    chain.supersededBy.length === 0;
  if (empty) {
    out.push('  (no chain: no references in or out, no supersession links)');
    process.stdout.write(out.join('\n') + '\n');
    return 0;
  }

  if (chain.supersedes !== null) {
    out.push('├── supersedes');
    out.push(`│   └── ${factRow(chain.supersedes)}`);
  }
  if (chain.supersededBy.length > 0) {
    out.push('├── superseded by');
    chain.supersededBy.forEach((c, i, a) => {
      out.push(`│   ${i === a.length - 1 ? '└──' : '├──'} ${factRow(c)}`);
    });
  }
  if (chain.outbound.length > 0) {
    out.push('├── references (outbound)');
    chain.outbound.forEach((r, i, a) => {
      const branch = i === a.length - 1 ? '└──' : '├──';
      out.push(
        `│   ${branch} ${
          r.fact !== null ? factRow(r.fact) : `${r.id}  (referenced but not found)`
        }`,
      );
    });
  }
  if (chain.inbound.length > 0) {
    out.push('└── referenced by (inbound)');
    chain.inbound.forEach((c, i, a) => {
      out.push(`    ${i === a.length - 1 ? '└──' : '├──'} ${factRow(c)}`);
    });
  }

  process.stdout.write(out.join('\n') + '\n');
  return 0;
}
