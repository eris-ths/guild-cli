# CLAUDE.md — guild-cli

このファイルは Claude Code (および互換 AI agent) が guild-cli リポジトリで作業するときの guide。

## What this repo is

TypeScript 製 CLI `guild-cli` を提供する public repo。4 つの passage を持つ：

- **gate** — request/approve/execute/complete の wave coordination + claim/witness の cross-session stake
- **agora** — improvise / suspend / conclude の議論プリミティブ
- **devil** — devil's advocate review (lenses: devil/layer/cognitive/user + custom)
- **ctx** — session 跨ぎの文脈 primitive

Domain → Application → Infrastructure → Interface の Clean Architecture (`src/` 配下に layer 分割)。`bin/*.mjs` が CLI dispatcher、各 passage の handler は `src/interface/<passage>/handlers/` に。

## Dogfooding rule

**guild-cli の開発は guild-cli substrate の上で回す**。これは設計原則ではなく実用要請：

- 自分で作った primitive を自分の wave 進行に乗せれば friction が surface する
- surface した friction が次の improvement issue になる (例: #228 friction bundle、#233 self_approve)
- records-outlive-writers の原則は開発自身にも効く — 「誰が・なぜ・いつ・何を変えたか」が gate record に残る

### 標準ワークフロー (single-executor wave)

```bash
# 起票 (eris は default host、members/ に登録済み actor を --executor に指定)
gate request --action "ship #N <feature>" --reason "<why>" --executor <actor> --from eris --target "<files>"
# → 2026-MM-DD-NNNN (state=pending)

gate approve <id> --by eris        # self-approve は notice 出るが通る (現行)
gate execute <id> --by <actor>     # → state=executing

# (worktree 切って実装 / レビュー / テスト)

gate complete <id> --by <actor>    # → terminal、claim/witnesses は auto-reset
```

### 並列 wave (parallel-impl 等)

`gate request --executors a,b,c` で複数 executor を同時記録 (#230)。
**worktree isolation 必須** — `profile: swarm` で強制される (#231)。
attribution race の物理化防止は filesystem 層 + record 層 + agent-loop 層の三層分担。

## Cross-session coordination

別セッション (別 SubAgent / 別 main session) が同 issue を独立着手するケースに備える：

- `gate claim <id> --by <actor>` — 「私が動かす」exclusive stake (PR #243 / phase 1 ship 済)
- `gate witness <id> --by <actor>` — 「観察するだけ」non-exclusive (#244 / phase 2)
- `gate boot` で overlap 検知 (#234 / 設計中)

セッション開始時は **open issue 確認 → 関連 wave に claim 取得 → 作業開始** の routine 推奨。

## Repository layout

| dir | 内容 | shared? |
|-----|------|--------|
| `src/` `tests/` | 実装と test (TS) | ✅ git |
| `bin/*.mjs` | CLI entrypoint dispatcher | ✅ git |
| `examples/` | sample guild instances (各種 config パターン) | ✅ git |
| `docs/` | 設計・運用ドキュメント | ✅ git |
| `members/` | gate member 登録 (alice/bob 等) | ❌ local-only via `.git/info/exclude` |
| `substrate/` | agora plays/games の作業領域 | ❌ local-only |
| `experiments/` | substrate-experiment 跡地 | ❌ local-only |
| `.claude/` | worktree shadow / settings | ❌ local-only |
| `requests/` | gate request YAML records (dogfood 履歴、actor 名含む) | ❌ local-only via `.gitignore` |

## Development workflow

1. **branch + worktree**: 大きい変更は `git worktree add ../guild-cli-<topic> -b feat/<topic>` で隔離
2. **build + test**: `npm run build && npm test` (Jest、~1250 tests)
3. **commit**: 必須 (Task tool / SubAgent の auto-cleanup 防止)
4. **PR**: `gh pr create`、main rebase してから push、squash merge で fast ship
5. **docs**: behavior change は `CHANGELOG.md` の `[Unreleased]` に entry 追加

詳細は `docs/` 配下と `.gate-sessions/` (もしあれば) の wave 履歴を参照。

## Style

- TS strict mode、no `any`
- domain は外部依存ゼロ (Clean Arch の依存方向厳守)
- text mode と json mode の両 surface を維持 (LLM 消費前提)
- byte-stable YAML (空 field omit、hydrate tolerance) は永続層の不変条件
- error message に "next:" を添えて recovery path を提示 (touch-feel UX)

## References

- 進行中 wave の resume: `.gate-sessions/` 配下 / 開発者の ctx (例: `data/ctx/guild_cli_dev_resume.md`)
- Roadmap: #36
- Profile design: #227 (swarm profile epic)
- Friction bundle: #228
- Cross-session: #226 (claim/witness)
