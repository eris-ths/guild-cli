# CLAUDE.md — guild-cli

Claude Code (および互換 AI agent) が guild-cli リポジトリで作業するときの guide。
**AGENT.md が CLI の使い方リファレンス**、この CLAUDE.md は **repo を開発する側の指示**。

## 一行で

file-based な coordination substrate を作っている TypeScript CLI。
**自分自身の substrate の上で開発を回す (dogfood)** のが中心原則。

## この repo は何か

4 つの passage を持つ public CLI:

- **gate** — request → approve → execute → complete の wave coordination
  + claim/witness の cross-session stake
- **agora** — `new` / `play` / `move` / `suspend` / `resume` / `conclude`
  の議論・探索プリミティブ (alpha)
- **devil** — multi-persona security review。bundled catalog は security
  12-lense (injection / path-network / supply-chain ...)。security 寄りの
  変更が主用途で、汎用レビューは `gate review` (docs/playbook.md
  "When NOT to use devil")。ただし no-gaps 強制 (全 lense に entry、silent
  gap 禁止) 自体は security 専用でなく、`<content_root>/devil/lenses/*.yaml`
  の extension lense で judgment 軸にも転用できる (#134 G、ComposedLenseCatalog)
- **ctx** — session 跨ぎの fact accumulation (alpha, phase 1 は `record` のみ)

Clean Architecture: **Domain → Application → Infrastructure → Interface**
(`src/` 配下に layer 分割)。`bin/*.mjs` が CLI dispatcher、各 passage の
handler は `src/interface/<passage>/handlers/` (gate) ないし
`src/passages/<passage>/interface/handlers/` (agora/devil/ctx)。

## Dogfooding rule — 開発の中心原則

**guild-cli の開発は guild-cli substrate の上で回す**。設計原則ではなく実用要請:

- 自分で作った primitive を自分の wave 進行に乗せれば friction が surface する
- surface した friction が次の improvement issue になる
  (例: #228 friction bundle、#233 self_approve)
- **records-outlive-writers は開発自身に効く** — 「誰が・なぜ・いつ・何を
  変えたか」が gate record / agora play / ctx fact に残り、次セッションの
  自分 (or 別 agent) が `gate boot` 一発で読み戻せる

### bug-killing flow (docs/playbook.md C4) — 推奨の一周

実バグは substrate に乗せて殺す。観察 → 探索 → 判断 → レビューが一本の線になる:

```
gate issues add ...              # 観察を notice として起票
  → agora new/play/move ...      # sandbox で root-cause を moves に記録
    → agora conclude + issues promote → gate request   # 判断: 実装の wave 化
      → 実装 → gate review (別 persona / 別 actor が red-team)   # Two-Persona
        → gate complete --cliff "..."   # 次へのバトン
```

`gate why <id>` が aligned / contested を分けて残すので、レビューの不同意が
消えずに次セッションへ差し戻る。

### 標準ワークフロー (single-executor wave)

```bash
# 起票 (eris は default host、members/ に登録済み actor を --executors に指定)
gate request --from eris --action "ship #N <feature>" --reason "<why>" \
             --executors <actor> --target "<files>"
# → 2026-MM-DD-NNNN (state=pending)
# NOTE: flag は --executors (複数)。単数 --executor は v0.6 で削除済み (#239)。
#       `gate list --executor <m>` (フィルタ単数) だけは別物で現役。

gate approve  <id> --by eris        # self-approve は notice 出るが通る (solo profile)
gate execute  <id> --by <actor>     # → state=executing
# (worktree 切って実装 / レビュー / テスト)
gate complete <id> --by <actor>     # → terminal、claim/witnesses は auto-reset
```

間違った順で叩くと、エラーが次の verb を名指しする (例: pending に execute →
"gate approve <id>")。state vocab は domain、verb hint は interface の分担。

### 並列 wave (parallel-impl 等)

`gate request --executors a,b,c` で複数 executor を同時記録 (#230)。
**worktree isolation 必須** — `profile: swarm` で強制 (#231)。
attribution race の物理化防止は filesystem 層 + record 層 + agent-loop 層の三層分担。
swarm の詳細は docs/swarm.md。

## Cross-session coordination

別セッション (別 SubAgent / 別 main session) が同 issue を独立着手するケースに備える:

- `gate claim <id> --by <actor>` — 「私が動かす」exclusive stake (#243 / ship 済)
- `gate witness <id> --by <actor>` — 「観察するだけ」non-exclusive (#244)
- `gate boot` で overlap 検知 (#234)

セッション開始時の routine: **`gate boot` で orient → open issue / 関連 wave 確認
→ claim 取得 → 作業開始**。

## Repository layout

| dir | 内容 | shared? |
|-----|------|--------|
| `src/` `tests/` | 実装と test (TS, node:test) | ✅ git |
| `bin/*.mjs` | CLI entrypoint dispatcher + `bin/_lib/` の plain .mjs helper | ✅ git |
| `examples/` | sample guild instances (各種 config パターン) | ✅ git |
| `docs/` | 設計・運用ドキュメント (README からリンク) | ✅ git |
| `lore/` | principles (16) + traps (8)。`gate lore list` で読める | ✅ git |
| `.changelog/next/` | per-PR changelog fragment (release 時に折り込み) | ✅ git |
| `members/` | gate member 登録 (alice/bob 等) | ❌ local-only via `.git/info/exclude` |
| `substrate/` | agora plays/games の作業領域 | ❌ local-only |
| `requests/` | gate request YAML records (dogfood 履歴、actor 名含む) | ❌ local-only via `.gitignore` |
| `.claude/` | worktree shadow / settings | ❌ local-only |

`guild.config.yaml` も local-only。なので fresh clone は素の状態で起動する
(`gate boot` が register への導線を出す)。

## Development workflow

1. **branch + worktree**: 大きい変更は `git worktree add ../guild-cli-<topic> -b feat/<topic>` で隔離
2. **build + test**: `npm test` (= `tsc && node tests/run.mjs`、node:test、~1800 tests)。
   - グループ実行: `npm run test:domain` / `test:interface` / `test:passages` 等
   - 並列度: `TEST_CONCURRENCY=20` 等で上げ下げ可 (既定 8)
   - **branch 跨ぎは `rm -rf dist` してから** — `tsc` は追加するが prune しない
     ので、別 branch でビルドした `.test.js` が残ると count が二重化する
     (trap_dist_stale_after_branch_switch)
3. **commit**: 必須 (Task tool / SubAgent の auto-cleanup 防止)
4. **PR**: main を rebase してから push、squash merge で fast ship
   - この環境では GitHub MCP tool 経由 (`gh` CLI は無い)
5. **changelog**: behavior change は `.changelog/next/<category>-<slug>.md` に
   fragment を1つ落とす。`CHANGELOG.md` の `[Unreleased]` は**直接編集しない**
   (release script が fragment を折り込む。詳細 .changelog/README.md)

## Style

- TS strict mode、no `any`
- domain は外部依存ゼロ (Clean Arch の依存方向厳守。CLI 語彙を domain に漏らさない)
- text mode と json mode の両 surface を維持 — **AI-first**: substrate (JSON) が
  contract、text は human projection (principle 11)。`--format json` の envelope
  shape は verb 横断で安定
- byte-stable YAML (空 field omit、hydrate tolerance) は永続層の不変条件
- **error message に recovery path を添える** (touch-feel UX): 「できない」だけ
  でなく「次にどの verb / flag を打つか」を示す。illegal transition は
  bridging verb を名指し、not-found は `gate list`/`tail` を指す。JSON では
  `error.recovery {verb,args}` + `error.code` を載せる
- 成功時の trailing `next:` hint は verb shape 依存 (principle 13): bootstrap/
  boundary は出す、lifecycle/flow は出さない (JSON `suggested_next` が担う)

## References

- CLI 使い方の一次リファレンス: [`AGENT.md`](./AGENT.md)
- combos / recipes / bug-killing flow: [`docs/playbook.md`](./docs/playbook.md)
- swarm / 並列調整: [`docs/swarm.md`](./docs/swarm.md)
- principles / traps: [`lore/`](./lore/) または `gate lore list`
- Roadmap: #36 / Profile design: #227 / Friction bundle: #228 / Cross-session: #226
- 進行中 wave の resume: `gate boot` + `gate resume` (+ 開発者の ctx)
