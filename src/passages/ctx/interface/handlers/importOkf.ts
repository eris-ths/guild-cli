import { CtxUseCases } from '../../application/CtxUseCases.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';
import { parseFormat } from '../../../../interface/shared/parseFormat.js';
import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { DomainError } from '../../../../domain/shared/DomainError.js';
import { OKF_VERSION } from '../../../../domain/okf/OkfDocument.js';

const IMPORT_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'as',
  'by',
  'format',
  'allow-duplicates',
]);

/**
 * Boolean flags for `ctx import`, threaded into `parseArgs` by the
 * dispatcher (issue #158 per-verb pattern) so `--allow-duplicates <dir>`
 * doesn't speculatively consume the positional directory as its value.
 */
export const IMPORT_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  'allow-duplicates',
]);

function parseBundleFormat(args: ParsedArgs): 'okf' {
  const raw = optionalOption(args, 'as') ?? 'okf';
  if (raw !== 'okf') {
    throw new DomainError(
      `--as must be 'okf' (the only bundle format), got: ${raw}`,
      'as',
    );
  }
  return 'okf';
}

export interface ImportCtxDeps {
  readonly uc: CtxUseCases;
  readonly config: GuildConfig;
}

/**
 * ctx import — record an OKF bundle's concepts as ctx facts.
 *
 * Usage:
 *   ctx import <dir> [--as okf] [--by <m>] [--format json|text]
 *
 * Idempotent for guild-authored bundles: a concept whose `id` already
 * exists on the substrate is skipped, so re-importing the same bundle is
 * a no-op. Foreign concepts import tolerantly (fresh id, `--by` as the
 * fallback author, provenance preserved as tags). `--by` defaults from
 * GUILD_ACTOR.
 *
 * Prose dedup is on by default: a fact whose normalized prose is already
 * recorded — under any id, or earlier in the same bundle — is skipped,
 * so even an id-less foreign bundle re-imported is a no-op.
 * `--allow-duplicates` opts out for a deliberate re-record.
 */
export async function importCtx(
  deps: ImportCtxDeps,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, IMPORT_KNOWN_FLAGS, 'import');
  parseBundleFormat(args);
  const format = parseFormat(args);
  const by = requireOption(args, 'by', '<m>', 'GUILD_ACTOR');
  const allowDuplicates = args.options['allow-duplicates'] === true;

  const dir = args.positional[0];
  if (dir === undefined || dir.length === 0) {
    throw new DomainError(
      'import requires a source directory (ctx import <dir>)',
      'dir',
    );
  }

  const summary = await deps.uc.importOkf({ dir, by, allowDuplicates });

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          format: 'okf',
          okf_version: OKF_VERSION,
          dir,
          imported_count: summary.imported.length,
          imported: summary.imported,
          skipped_count: summary.skipped.length,
          skipped: summary.skipped,
          suggested_next: {
            verb: 'gate',
            args: ['boot'],
            reason:
              'Confirm the imported facts landed via `gate boot` (ctx cross-passage count) or the filesystem.',
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      `✓ imported ${summary.imported.length} fact${summary.imported.length === 1 ? '' : 's'} from ${dir} (OKF v${OKF_VERSION})\n`,
    );
    if (summary.skipped.length > 0) {
      process.stderr.write(
        `notice: skipped ${summary.skipped.length} document${summary.skipped.length === 1 ? '' : 's'}:\n`,
      );
      for (const s of summary.skipped) {
        process.stderr.write(`  - ${s.path}: ${s.reason}\n`);
      }
    }
  }
  return 0;
}
