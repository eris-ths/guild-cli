# AGENTS.md — guild-cli

**この repo の開発者向け指示の本体は [`CLAUDE.md`](./CLAUDE.md) にある。まずそれを読むこと。**
Codex その他の AI agent も、harness の違いに関わらず同じ内容に従う。

内容をここに複製しない — 二重管理は必ず片方が古くなる。
実際、複製版は生まれた時点で ctx passage の記述が phase 遅れになり、
`.claude/` を `.Codex/` と誤記していた。だからこのファイルは入口だけを持つ。

## 読む順

| 知りたいこと | 見る先 |
|---|---|
| **この repo をどう開発するか**（dogfood / workflow / style） | [`CLAUDE.md`](./CLAUDE.md) |
| **CLI をどう使うか**（verb の一次リファレンス） | [`AGENT.md`](./AGENT.md) — 単数。上とは別物 |
| combos / recipes / bug-killing flow | [`docs/playbook.md`](./docs/playbook.md) |
| principles / traps | [`lore/`](./lore/) または `gate lore list` |
