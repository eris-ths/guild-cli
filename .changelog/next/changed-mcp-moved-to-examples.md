- **`mcp/` moved to `examples/mcp/`.** The directory held a worked
  example of MCP integration (`gate_mcp.py`) plus two example hook
  plugins (`mcp/plugins/{doc-check,self-loop-check}.mjs`) — none of
  it is core substrate, so its top-level position misled cold readers
  about what was load-bearing. The move brings the repo root one
  step closer to the 11 → 8 dir target named in #385. Voice-budget
  test allowlist and principle 03 reference paths updated to match.
