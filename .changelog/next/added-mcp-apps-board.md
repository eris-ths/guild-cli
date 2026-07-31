- **`gate_board` — the example MCP server now speaks the MCP Apps extension
  (`io.modelcontextprotocol/ui`).** The tool carries
  `_meta.ui.resourceUri` pointing at a `ui://gate/board` resource, so hosts
  that implement the extension render the decision history as an
  interactive board inline in the conversation instead of a wall of text.
  The board shows request id, passage kind, actor, timestamp, action,
  reason, and completion note per record. Hosts without the extension
  ignore `_meta` and get `gate_board` as a plain text tool, so nothing
  breaks — support is per-client (as of 2026-07-31 the published client
  matrix lists Claude web/Desktop, VS Code Copilot, Cursor and ChatGPT
  among others; Claude Code is not listed).
- The board reads `gate tail --format json` rather than parsing text
  output, following principle 11: the substrate is the contract and text is
  a human projection. The HTML is self-contained (no CDN) because MCP Apps
  cannot reach external origins unless they are declared in `_meta.ui.csp`,
  and because an example should not grow dependencies.
- **`gate` remains the source of truth.** This adds a window, not a
  migration: no existing tool, verb, or substrate shape changed. The board
  is read-only and does the one thing the CLI cannot — put "who decided
  what, and why" next to the conversation that led there.
- Substrate values are HTML-escaped before they reach `innerHTML`, and the
  embedded JSON escapes `</` so an action or reason containing markup
  cannot break out of the page.
