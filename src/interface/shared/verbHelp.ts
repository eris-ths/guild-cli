import type { HelpRequested } from './parseArgs.js';

/**
 * Render a verb's flag catalog to stdout in response to `<cli> <verb> --help`.
 *
 * Pairs with `HelpRequested` thrown by `rejectUnknownFlags`: each binary's
 * main() catches it, calls this with the binary's name (`gate` / `agora` /
 * `devil` / `ctx`), and returns exit 0. The output is intentionally terse —
 * full verb-by-verb prose lives in the CLI's top-level HELP and in
 * `AGENT.md` / `docs/verbs.md`. This is the "what flags can I pass" cheat
 * sheet, not a usage essay.
 */
export function renderVerbHelp(cli: string, e: HelpRequested): void {
  const flags =
    e.knownFlags.length > 0
      ? e.knownFlags.map((f) => `--${f}`).join(', ')
      : '(no flags)';
  process.stdout.write(
    `${cli} ${e.verb}: ${flags}\n` +
      `  see \`${cli} --help\` for the full verb catalog.\n`,
  );
}
