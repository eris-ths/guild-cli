# guild-cli — 日本語概要（AIエージェント向け）

> 英語版のフル README は [`README.md`](./README.md) を参照してください。
> このファイルは AI エージェント向けの短い日本語要約です。

guild-cli は、AIエージェント（Claude / GPT / ローカルLLM など）と
人間のオペレーターが混在する小規模チームのための、**ファイルベース
の協調基盤**です。デーモンもネットワークもDBも不要で、状態はすべて
YAMLファイルとしてディスク上に永続化され、セッションを跨いで保持
されます。

中核は **Two-Persona Devil Review ループ** — 「書いた人とレビュー
する人は別人格でなければならない」というルールを構造的に強制する
仕組みです。単一エージェントの自己完結ループが見落としがちな盲点を、
異なる視点（`devil | layer | cognitive | user` の4つのレンズ）から
検出できます。

記録は append-only で、「現在の真実」に圧縮されることはありません。
誰が提案し、誰がどのレンズで異議を唱え、その異議が吸収されたか
無視されたか — **熟議の過程そのもの**が残ります。ツールは知覚を
研ぐだけで、結論を出しません。これは欠落ではなく設計選択です。

## セットアップ

Node.js 20 または 22 が必要。`prepare` script が `npm install` 時に
自動で `dist/` を build するので、別途 build は不要です（ソースを
編集した後だけ `npm run build`）。

```bash
npm install                              # prepare: tsc が dist/ を生成

# content_root ごとに 1 度: 自分を actor として登録
node ./bin/gate.mjs register --name <you>

# シェルごとに 1 度: 全 verb の default actor を環境変数で固定
export GUILD_ACTOR=<you>

# セッションごとに 1 度: 1 コマンドで全コンテキスト取得
node ./bin/gate.mjs boot                 # identity / status / tail / inbox / cross_passage を 1 JSON で
```

`gate` と `guild` は安定しており、`npm link` で PATH 化できます。
`agora` / `devil` / `ctx` は alpha のため意図的に `package.json#bin` から
外しており、`node ./bin/agora.mjs ...` または `npm run agora -- ...`
で起動してください（`devil`, `ctx` も同様）。これは見落としではなく
安定境界として opt-in にしてあります。`ctx` は phase 1 で `record`
verb のみ実装されています — 残り 6 verb (fork / supersede / show /
list / chain / status) は別セッションで段階的に追加されます。

**初めて触る場合**: まず `gate` から。 `guild` は admin 寄りの helper
(member 登録、 roster 検証) で大抵 1 度走らせて忘れる。 `agora` /
`devil` / `ctx` は **作業の形** がそれに合った時だけ手を伸ばす passage:
session を跨いで保留したい動いている思考 (`agora`)、 multi-persona
scrutiny が要る security-prone な変更 (`devil`)、 verdict 不要だが
session 終端で消したくない観察 (`ctx`)。

### Solo flow (30秒)

1人（または1つの AI エージェント）が単独で動く場合、 ツールの全体は
6 verb に集約されます:

```bash
gate register --name <you>
gate request --action "..." --reason "..." --executors <you>
gate approve <id> --by <mirror>
gate review  <id> --by <mirror> --lense user --verdict ok
gate execute <id> --by <you>
gate complete <id> --by <you>
```

`<mirror>` は **同じ actor の別 persona / 別 `--by`** です — 「別の
hat を被った自分」、または critic として動く別の登録 actor。
Two-Persona Devil discipline: solo であっても **approve / review の
人格は execute の人格と別レンズ・別瞬間** であるべき、というのが
substrate を形作っている規律です。 solo profile の default
(`self_approve: allowed`) では `--by <you>` でも直接通せますが、
mirror に手を伸ばすのが推奨形。 `swarm` profile に切り替えた瞬間に
`self_approve: forbidden` が効き、別 `--by` が config 強制になります。

並列 executor / worktree 隔離 / SubAgent swarm の流れは
[`docs/swarm.md`](./docs/swarm.md) を参照してください。

### このREADMEはどこまで読めばいい？

| 深さ | ファイル | 想定読者 | 十分な条件 |
|------|---------|---------|-----------|
| 30秒 | この上の段落 + 「Solo flow」 | solo | 何のツールか知りたい |
| 5分 | [`docs/concepts-for-newcomers.md`](./docs/concepts-for-newcomers.md) | solo | Jira / PR review / ADR から来た翻訳付き理解が欲しい |
| 10分 | [`AGENT.md`](./AGENT.md) | solo / agent | AI agent で四つの passage の全 verb map が欲しい |
| 15分 | [`docs/playbook.md`](./docs/playbook.md) | pair | passage 個別を知った上で **combos** (gate + agora + devil の合成パターン) が欲しい |
| 15分 | [`docs/swarm.md`](./docs/swarm.md) | swarm | ≥2 並列 executor / Claude SubAgent を orchestrate していて substrate-engagement レシピが要る |
| 30分 | [`docs/verbs.md`](./docs/verbs.md) | any | per-verb の例と設計ノートが欲しい |
| reference | [`docs/glossary.md`](./docs/glossary.md) | any | project 固有の用語に当たって正典が欲しい |

## あなたができること

- `guild new` で自分や仲間をメンバー登録する
- `gate request` で他のメンバー（または自分）に作業を依頼する
- `gate approve` → `execute` → `complete` でリクエストを状態遷移
  させ、各ステップが `status_log[]` に actor + timestamp 付きで残る
- `gate review` で**別メンバー**として批判的レビューを記録する
- `gate issues` で後で対処すべき欠陥を追跡する
- `gate message` / `broadcast` / `inbox` / `inbox mark-read` で
  メンバー間の非同期通知と受領記録をやり取りする
- 小さな自己完結タスクなら `gate fast-track` で create→complete
  を一発で通し、記録だけ残して規律を緩める
- `gate boot` でセッション開始時に全コンテキストを一発取得 —
  identity / queues / tail / your_recent / 未読 inbox / cross_passage
  (agora・devil の open / suspended / 直近 activity) を 1 つの JSON
  で。より軽い counts-only が欲しい時は `gate status`。
- `gate resume` で前セッション終端から再開 — open loops と
  「次の一手」を restoration prompt として返す（`--locale ja` で
  日本語 prose、`GUILD_ACTOR` 必須）
- **読みの道具一式**: `gate whoami` / `gate tail` /
  `gate voices <name>` / `gate chain <id>` /
  `gate show <id> --format text` で、自分や他者の utterance を
  時系列・横断的に辿る
- **Director 軸の読み (2026-05 ship arc)**:
  - `gate decisions [--for <m>]` — 自分が authored した state
    transition (approve / deny / execute / complete / fail) を window
    内で並べる。 default `--for` は `GUILD_ACTOR`。
  - `gate self-pattern [--for <m>]` — 自分の bias 面: decision counts +
    verdict 比率 + top lense + approve_rate + ok_rate。
  - `gate lense-stats [--for <m>]` — review entry の lense 分布。
    bias surface — 「最近どの lense ばかり使ったか」が即わかる。
  - `gate flow-suggest --severity <s> --area <a>` — 軽微修正で
    full request まで回す過剰儀式を避けるための advisory verb。
  - `gate wave-status <id>` — multi-executor wave の per-executor 進捗。
    #309 で per-executor stale 判定が入り、 fresh witness が古い
    wave で誤検知されない。
  - `gate review-context <id>` — reviewer が読みたい bundle
    (depth / recommended lenses / prior reviews) を 1 verb で。
    `--depth` advisory が初めて consumer-side で活かされる verb。
- write verbs に `--format json` を渡すと
  `{ok, id, state, suggested_next:{verb, args, reason}}` が返り、
  orchestrator は次の tool call を自分で導出せずに済む
- `--with <n1>,<n2>` で pair-mode: 誰との対話で形成された判断かを
  記録できる（solo なら omit）
- LLM の tool layer に gate を渡す場合は `gate schema` が
  draft-07 の JSON Schema カタログを出力する

## 並行性と拡張の指針

すべてファイル操作のみ。同一 content_root に複数プロセスが触る場合、
作成系は O_EXCL で race-safe ですが、それ以外は協調的直列化を前提に
しています。自動化を上に組む場合は、domain/application 境界を安定
層として扱い、infrastructure 層を差し替え可能な実装詳細とみなして
ください（新しい `Repository` 実装を書く方が、ユースケースを触る
より安全です）。

## guild の他の passage

`gate` は guild という container の中の最初の passage です。
同じ content_root を共有する passage が複数あり、それぞれ違う
**shape の作業** を hold します:

| passage | shape (一語) | 何をする | いつ手を伸ばすか |
|---------|--------------|----------|-------------------|
| `gate`  | **判断**     | request に verdict を出す | approve / deny / complete / fail / review が必要な時 |
| `agora` | **探索**     | 結論前の思考に留まる      | Quest / Sandbox、 cliff/invitation で時間を跨ぐ思考 |
| `devil` | **守備**     | end-user を守る           | 多角的 scrutiny が必要な変更 (security-prone change) |
| `ctx`   | **事実**     | 観察を記録する             | session を跨いで失われない形で attribution 付きで残したい観察 (verdict 不要) |

passage 群は AI エージェントが 「この作業はどの shape か」 で dispatch
できる単純な分類になっています。 集合は open — 詳しくは
[`lore/principles/12-substrate-pure-module-in-projection-ecosystem.md`](./lore/principles/12-substrate-pure-module-in-projection-ecosystem.md)
が、追加 passage がどう既存と合成しつつ吸収されないかを名指ししています。
個別:

- **`agora`** (`bin/agora.mjs`、 alpha) — play / narrative の
  passage。 Quest と Sandbox の game-kind、 **suspend / resume を
  first-class primitive** として持ちます。 中断時に `cliff` (何が
  起きたか) と `invitation` (次の opener が何をすべきか) の prose
  を残し、 次の instance がそれを読んで再入する — substrate-side
  Zeigarnik 効果。 設計の経緯は
  [issue #117](https://github.com/eris-ths/guild-cli/issues/117)。
- **`devil`** (`bin/devil.mjs`、 alpha) — security-backstop の
  review passage。 **multi-persona (red-team / author-defender /
  mirror) + lense 強制 (Claude Security の 8 category + devil 固有
  4 つ = 計 12 lense; composition / temporal / supply-chain /
  coherence) + 時間延長**された review surface。 single-pass
  tool (Anthropic `/ultrareview`、 Claude Security、
  supply-chain-guard) を **置き換えるのではなく compose** する後段
  backstop として設計されています。 目的は OWASP top 10 を一度も
  見ていない作者のコードに対する **security 知識の floor を 0 から
  少し上げる** こと。 完全な防護を保証するのではなく、 finding が
  dismiss された時にその理由が substrate に残る形で deliberation
  を honest に保つ。 設計は
  [issue #126](https://github.com/eris-ths/guild-cli/issues/126)。
- **`ctx`** (`bin/ctx.mjs`、 alpha phase 1) — fact accumulation の
  passage。 verdict なし、 attribution 必須、 append-only。 `gate`
  が *判断* を、 `agora` が *動いている思考* を残すのに対し、 `ctx`
  は *観察された事実* を残します — session を跨いで substrate が
  目撃した出来事を、 actor 付き、 `prefix:value` 形式のタグ
  (例: `tech:typescript`、 `status:active`) 付きで記録し、後から
  semantic に query できる形で保持します。 phase 1 は `ctx record`
  のみ。 `fork` / `supersede` / `show` / `list` / `chain` / `status`
  は phase 2。 観察を session 終端で消したくないが、 判断や熟議に
  押し上げる必要もない時に手を伸ばす passage です。

passage 群は同じ `members/<name>.yaml` substrate を共有し、
passage 固有の records はそれぞれ `<content_root>/agora/` /
`<content_root>/devil/` /
`<content_root>/ctx/` に置かれます。

## 実例

各ディレクトリは自己完結した `content_root` で、`cd` してそのまま
verb を叩けます:

- [`examples/quick-start/`](./examples/quick-start/) — 最小の config + members
- [`examples/dogfood-session/`](./examples/dogfood-session/) — 多 actor の長い実セッション（このツール自身が自分を拡張した完全な記録）
- [`examples/agent-first-session/`](./examples/agent-first-session/) — JSON envelope を中心とした agent-driven flow
- [`examples/agent-voices/`](./examples/agent-voices/) — multi-persona の voice 表現
- [`examples/three-passages-framing/`](./examples/three-passages-framing/) — gate / agora / devil の framing arc を substrate snapshot として保存 (3-passage 当時の凍結、`ctx` は後から open set に合流)
