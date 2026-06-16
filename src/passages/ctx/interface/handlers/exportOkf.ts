import { CtxUseCases } from '../../application/CtxUseCases.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';
import { parseFormat } from '../../../../interface/shared/parseFormat.js';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { DomainError } from '../../../../domain/shared/DomainError.js';
import { OKF_VERSION } from '../../../../domain/okf/OkfDocument.js';

const EXPORT_KNOWN_FLAGS: ReadonlySet<string> = new Set(['as', 'format']);

/**
 * Validate `--as <bundle-format>`. OKF is the only bundle format today;
 * the flag exists so a future second format is an enum addition, not a
 * new verb — mirroring how `--format json|text` carved its seam.
 */
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

export interface ExportCtxDeps {
  readonly uc: CtxUseCases;
  readonly config: GuildConfig;
}

/**
 * ctx export — project every ctx fact into an OKF bundle.
 *
 * Usage:
 *   ctx export <dir> [--as okf] [--format json|text]
 *
 * Writes one `<id>.md` per fact (YAML frontmatter + fact prose) plus the
 * generated `index.md` / `log.md` view files. Read-only over the
 * substrate — the bundle lands outside content_root.
 */
export async function exportCtx(
  deps: ExportCtxDeps,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, EXPORT_KNOWN_FLAGS, 'export');
  parseBundleFormat(args);
  const format = parseFormat(args);

  const dir = args.positional[0];
  if (dir === undefined || dir.length === 0) {
    throw new DomainError(
      'export requires a target directory (ctx export <dir>)',
      'dir',
    );
  }

  const summary = await deps.uc.exportOkf({ dir });

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          format: 'okf',
          okf_version: OKF_VERSION,
          dir,
          count: summary.count,
          written: summary.written,
          suggested_next: {
            verb: 'ctx',
            args: ['import', dir],
            reason:
              'Round-trip check: importing the bundle back into a fresh content_root reconstructs the same facts (ids preserved).',
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      `✓ exported ${summary.count} fact${summary.count === 1 ? '' : 's'} to ${dir} (OKF v${OKF_VERSION})\n`,
    );
    process.stderr.write(
      `notice: wrote ${summary.written.length} files (concepts + index.md + log.md) under ${dir}\n`,
    );
  }
  return 0;
}
