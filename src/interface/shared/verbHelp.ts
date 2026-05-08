import type { HelpRequested } from './parseArgs.js';
import { VERB_EXAMPLES } from './verbExamples.js';

/**
 * Render a verb's flag catalog to stdout in response to `<cli> <verb> --help`.
 *
 * Pairs with `HelpRequested` thrown by `rejectUnknownFlags`: each binary's
 * main() catches it, calls this with the binary's name (`gate` / `agora` /
 * `devil` / `ctx`), and returns exit 0. The output is intentionally terse —
 * full verb-by-verb prose lives in the CLI's top-level HELP and in
 * `AGENT.md` / `docs/verbs.md`. This is the "what flags can I pass" cheat
 * sheet, not a usage essay.
 *
 * When `VERB_EXAMPLES[cli][verb]` exists, an `e.g.` line follows the flag
 * list — the canonical smallest invocation that runs. Missing verbs skip
 * the example line silently rather than crash, so a new CLI can ship
 * before the example map catches up.
 */
export function renderVerbHelp(cli: string, e: HelpRequested): void {
  const flags =
    e.knownFlags.length > 0
      ? e.knownFlags.map((f) => `--${f}`).join(', ')
      : '(no flags)';
  const example = VERB_EXAMPLES[cli]?.[e.verb];
  const exampleLine = example !== undefined ? `  e.g. ${cli} ${example}\n` : '';
  // Verb-specific extras (e.g. the resolved `lenses:` set for `gate
  // review`) ride between the example line and the footer. Each entry
  // is a single rendered line; emitted only when the verb opts into
  // extras at rejectUnknownFlags time. Indentation matches the example
  // line so the visual hierarchy is consistent.
  const extrasBlock =
    e.extras.length > 0 ? e.extras.map((s) => `  ${s}\n`).join('') : '';
  process.stdout.write(
    `${cli} ${e.verb}: ${flags}\n` +
      exampleLine +
      extrasBlock +
      `  see \`${cli} --help\` for the full verb catalog.\n`,
  );
}
