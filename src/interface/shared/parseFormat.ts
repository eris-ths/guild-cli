// parseFormat — shared `--format <json|text>` parser.
//
// Before this helper: 40+ handlers across gate / agora / devil / ctx
// each inlined the same 4-line validation:
//
//   const format = optionalOption(args, 'format') ?? 'text';
//   if (format !== 'json' && format !== 'text') {
//     process.stderr.write(`error: --format must be 'json' or 'text', got: ${format}\n`);
//     return 1;
//   }
//
// Two issues with the inline form:
//   1. Drift surface — 40+ places to keep aligned. Changing the
//      message (e.g. adding a yaml mode later) is a 40-file edit.
//   2. The inline `stderr.write + return 1` shape bypasses the
//      passage's outer-catch which already routes through
//      `emitErrorEnvelope`. JSON-mode callers got plain text back
//      from the validation while every OTHER error in the same
//      handler returned a structured envelope. Inconsistency.
//
// This helper collapses the call site to one line:
//
//   const format = parseFormat(args);   // or parseFormat(args, 'json') for json-default verbs
//
// The throw path goes through the passage's outer-catch and produces
// the same structured envelope as any other DomainError — JSON
// consumers now get `{"ok":false,"error":{"message":"...","field":"format","code":"validation_error"}}`
// for free.

import { ParsedArgs, optionalOption } from './parseArgs.js';
import { DomainError } from '../../domain/shared/DomainError.js';

export type Format = 'json' | 'text';

/**
 * Parse and validate `--format` from CLI args.
 *
 * Throws `DomainError(field='format')` on invalid input — caught by
 * the passage's outer error envelope (no per-handler try/catch
 * required).
 *
 * @param args            parsed argv
 * @param defaultFormat   format to use when `--format` is omitted
 *                        (most read/list verbs default to 'text';
 *                        agent-loop verbs like `gate boot` /
 *                        `gate schema` / `gate status` default to
 *                        'json' so the agent's first call gets a
 *                        machine-parseable response without an
 *                        extra flag).
 */
export function parseFormat(args: ParsedArgs, defaultFormat: Format = 'text'): Format {
  const raw = optionalOption(args, 'format') ?? defaultFormat;
  if (raw !== 'json' && raw !== 'text') {
    throw new DomainError(`--format must be 'json' or 'text', got: ${raw}`, 'format');
  }
  return raw;
}
