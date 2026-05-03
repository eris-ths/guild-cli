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
  identity / queues / tail / your_recent / 未読 inbox を1つの
  JSON で。より軽い counts-only が欲しい時は `gate status`。
- `gate resume` で前セッション終端から再開 — open loops と
  「次の一手」を restoration prompt として返す（`--locale ja` で
  日本語 prose、`GUILD_ACTOR` 必須）
- **読みの道具一式**: `gate whoami` / `gate tail` /
  `gate voices <name>` / `gate chain <id>` /
  `gate show <id> --format text` で、自分や他者の utterance を
  時系列・横断的に辿る
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

`gate` は guild という container の中の一つ目の passage です。
同じ content_root を共有する別の passage が二つあります:

- **`agora`** (`bin/agora.mjs`、 alpha) — play / narrative の
  passage。 Quest と Sandbox の game-kind、 **suspend / resume を
  first-class primitive** として持ちます。 中断時に `cliff` (何が
  起きたか) と `invitation` (次の opener が何をすべきか) の prose
  を残し、 次の instance がそれを読んで再入する — substrate-side
  Zeigarnik 効果。 設計の経緯は
  [issue #117](https://github.com/eris-ths/guild-cli/issues/117)。
- **`devil`** (`bin/devil.mjs`、 snapshot) — security-backstop の
  review passage。 **multi-persona (red-team / author-defender /
  mirror) + lense 強制 (Claude Security の 8 category + 3 つの
  devil 固有) + 時間延長**された review surface。 single-pass
  tool (Anthropic `/ultrareview`、 Claude Security、
  supply-chain-guard) を **置き換えるのではなく compose** する後段
  backstop として設計されています。 目的は OWASP top 10 を一度も
  見ていない作者のコードに対する **security 知識の floor を 0 から
  少し上げる** こと。 完全な防護を保証するのではなく、 finding が
  dismiss された時にその理由が substrate に残る形で deliberation
  を honest に保つ。 設計は
  [issue #126](https://github.com/eris-ths/guild-cli/issues/126)。

3 つの passage は同じ `members/<name>.yaml` substrate を共有し、
agora / devil 固有の records はそれぞれ `<content_root>/agora/` /
`<content_root>/devil/` に置かれます。

## 実例

実動する典型例は [`examples/dogfood-session/`](./examples/dogfood-session/)
にあります — このツール自身がこのツールを使って自分を拡張した
セッションの完全な記録です。
