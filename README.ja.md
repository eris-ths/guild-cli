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
- `gate status` でセッション開始時の全体把握 — pending / approved /
  executing の件数、open issues、未読 inbox、最終活動を JSON で一発
  取得（`--format text` で人間向け表示）
- **読みの道具一式**: `gate whoami` でセッション開始時に自分と
  直近の発話を取り戻し、`gate tail` で content_root 全体の最近を
  眺め、`gate voices <name>` で特定アクターの横断履歴を呼び戻し、
  `gate chain <id>` で cross-reference をたどり、
  `gate show <id> --format text` で時間差付きの単体詳細を読む

## 並行性と拡張の指針

すべてファイル操作のみ。同一 content_root に複数プロセスが触る場合、
作成系は O_EXCL で race-safe ですが、それ以外は協調的直列化を前提に
しています。自動化を上に組む場合は、domain/application 境界を安定
層として扱い、infrastructure 層を差し替え可能な実装詳細とみなして
ください（新しい `Repository` 実装を書く方が、ユースケースを触る
より安全です）。

## 実例

実動する典型例は [`examples/dogfood-session/`](./examples/dogfood-session/)
にあります — このツール自身がこのツールを使って自分を拡張した
セッションの完全な記録です。
