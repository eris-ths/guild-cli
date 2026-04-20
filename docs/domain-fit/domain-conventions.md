# Domain conventions

Six domains where gate was tried hands-on. Each section carries:

- **Use case** — what was being recorded.
- **Config / setup** — what went in `guild.config.yaml` and how
  members were registered.
- **Reproducible sandbox** — the shell commands that built the
  example. Anyone can rerun to verify.
- **What worked** — verbs and patterns that felt natural.
- **What pushed back** — friction the domain created with gate's
  defaults.
- **Fit verdict** — one-line summary.

Shared bootstrap used below (creates the sandbox dir + common
members):

```bash
mkdir -p /tmp/gate-sandbox && cd /tmp/gate-sandbox
cp /path/to/guild-cli/examples/quick-start/guild.config.yaml guild.config.yaml
mkdir members requests issues inbox
export GATE=/path/to/guild-cli/bin/gate.mjs
```

`GUILD_ACTOR=<name>` is exported per invocation as needed.

---

## 1. Storytelling — character + plot beats

**Use case**: tracking plot beats, character appearances, and
foreshadowed open threads as a long-form story develops.

**Config**: default lenses. Characters are members (Mira, Kit,
Narrator). Narrator is used as `GUILD_ACTOR` so authorial actions
are separable from in-character actions via the `invoked_by`
delegation mark.

```bash
node "$GATE" register --name mira --display-name "Mira"
node "$GATE" register --name kit --display-name "Kit"
node "$GATE" register --name narrator --display-name "Narrator"

# A plot beat authored by the narrator but attributed to Mira
GUILD_ACTOR=narrator node "$GATE" fast-track --from mira \
  --action "灯台に一人で登る" \
  --reason "父が最後に見た光を確かめに行く" \
  > /dev/null

# Authorial critique of the beat (structure lens)
GUILD_ACTOR=narrator node "$GATE" review 2026-04-18-0001 \
  --by narrator --lense devil --verdict concern \
  "一人で登らせるのは筋が通る、情報量は不足"

# An open plot question
GUILD_ACTOR=narrator node "$GATE" issues add \
  --from narrator --severity med --area plot \
  -- "父の死因が曖昧。第4章までに回答必要"
```

**What worked**:

- `voices <character>` returns every beat the character appeared
  in, chronologically. It reads as a character tracker.
- `invoked_by=narrator` on beats authored for a character lands
  the "the author moved this character" structure without extra
  mechanism.
- `issues` holds foreshadowing gracefully. An issue that stays
  open _is_ a plot thread still hanging.
- `chain` tracks which beats reference which earlier beats —
  useful for setup/payoff checks.

**What pushed back**:

- The state machine (pending → approved → executing → completed)
  doesn't map to how a beat lives in a manuscript. Everything
  ends up going through `fast-track` to compress the lifecycle,
  which works but leaves fake timestamps in `status_log` for a
  semantically single event.
- Story time is not wall-clock time. Beat 3 of Chapter 2 might
  be written after Chapter 7 is drafted. The append-only
  `status_log` actively fights this; retroactive edits have no
  first-class representation.
- No notion of "which beat is _now_ in the story" — no marker
  for narrative present vs. past.

**Fit verdict**: partial. Review vocabulary and character-voice
queries land beautifully; the state machine and wall-clock
append-only-log fight the domain.

Related in `open-questions.md`: the three-layer story plugin sketch.

---

## 2. Meetings — decisions and parking-lot items

**Use case**: capturing proposals, objections, action items, and
revised proposals from a live meeting.

**Config**: default lenses. Participants are members with their
roles in display-name (PM, eng lead, design).

```bash
node "$GATE" register --name nao --display-name "ナオ (PM)"
node "$GATE" register --name sari --display-name "サリ (eng lead)"
node "$GATE" register --name ren --display-name "レン (design)"

# Proposal
GUILD_ACTOR=nao node "$GATE" request --with sari,ren \
  --action "feature X を来週月曜にローンチ" \
  --reason "マーケ準備 OK、次の窓は2ヶ月先"

# Objections as reviews
GUILD_ACTOR=sari node "$GATE" review 2026-04-18-0001 \
  --by sari --lense layer --verdict concern \
  "DB migration 未完、火曜 or 翌週月曜提案"
GUILD_ACTOR=ren node "$GATE" review 2026-04-18-0001 \
  --by ren --lense user --verdict concern \
  "オンボ画面 QA 1週間必要"

# Formal rejection + refile with revision
GUILD_ACTOR=nao node "$GATE" deny 2026-04-18-0001 --by nao \
  --reason "2人 concern、翌週月曜に差し戻し、新 request で起票"
GUILD_ACTOR=nao node "$GATE" request --with sari,ren \
  --action "feature X を翌週月曜にローンチ (旧案 2026-04-18-0001 からの改訂)" \
  --reason "DB migration 余裕 + QA 1週間確保"

# Parking-lot item
GUILD_ACTOR=nao node "$GATE" issues add --from nao --severity low \
  --area meeting-backlog \
  -- "DB migration を ship blocking にするか、次回議題"

# Action item (executor named; cross-reference in reason)
GUILD_ACTOR=sari node "$GATE" request --from sari --executor sari \
  --action "DB migration 完了まで 3日見積もり、毎朝進捗共有" \
  --reason "ローンチ blocker として 2026-04-18-0002 に紐づく"
```

**What worked**:

- `deny` + refile reads as "proposal rejected; revised version
  submitted." Clean vocabulary match.
- `gate chain 2026-04-18-0002` later shows the full decision
  graph: old proposal (denied) ← new proposal ← action item
  depending on new proposal. This is the information that
  traditional meeting notes lose.
- `review` with layer / user lenses separates "technical
  constraint" from "user-impact concern" naturally.
- Parking lot as issues, action items as requests with executors.

**What pushed back**:

- Not much. This was the cleanest fit.

**Fit verdict**: **Maximum gift**. The domain's native vocabulary
(propose / object / reject / revise / act) is what gate was
already built to model. Decision provenance gets preserved without
extra process.

---

## 3. Game design brainstorming — proposal + multi-lens critique

**Use case**: exploring a game mechanic, surfacing failure modes,
variant proposals that respond to specific critiques.

**Config**: default lenses (devil / layer / user map surprisingly
well to game-design critique axes).

```bash
node "$GATE" register --name designer --display-name "Designer"
node "$GATE" register --name devil --display-name "Devil (critique)"
node "$GATE" register --name user --display-name "User (playability)"

GUILD_ACTOR=designer node "$GATE" request \
  --action "核: '時間を預ける' rogue-like" \
  --reason "プレイヤーが実時間を他プレイヤーに預けると、預け先で強力アイテムが生成される"
GUILD_ACTOR=designer node "$GATE" approve 2026-04-18-0001 --by designer

# Three lenses in action
GUILD_ACTOR=devil node "$GATE" review 2026-04-18-0001 \
  --by devil --lense devil --verdict concern \
  "グリーフィングが主ゲームになる。rogue-like の 'もう一回' 感が消える"
GUILD_ACTOR=devil node "$GATE" review 2026-04-18-0001 \
  --by devil --lense layer --verdict concern \
  "実時間消費は同期ゲーム。rogue-like の非同期 solo run と根本的に合わない"
GUILD_ACTOR=user node "$GATE" review 2026-04-18-0001 \
  --by user --lense user --verdict ok \
  "初回プレイは新鮮。ただし 3 run 目から作業"

# Variant that explicitly answers a critique
GUILD_ACTOR=designer node "$GATE" request \
  --action "変奏: solo で時間預け、AI shadow が返しに来る" \
  --reason "2026-04-18-0001 の devil concern (グリーフィング) を回避する案"

# Open design questions
GUILD_ACTOR=designer node "$GATE" issues add \
  --from designer --severity med --area mechanics \
  -- "初回 run で shadow が無い問題。チュートリアル run の扱いを決める"
```

**What worked**:

- devil / layer / user lenses map to **player-behavior critique /
  mechanical coherence / player experience** without renaming.
  This is surprising and suggests the default lens set has a
  generality beyond the tool's origin.
- Variant proposals referencing the original by ID create a
  design-decision genealogy that chain can walk.
- Issues for open questions with severity × area = natural
  triage.

**What pushed back**:

- State machine is underutilized (ideas don't really "execute"),
  so fast-track dominates again. Same pattern as story mode.

**Fit verdict**: strong. Review lenses are the load-bearing part;
state machine is overhead. Consider `fast-track` the default
verb in this mode.

---

## 4. Research log — literature review with cross-references

**Use case**: tracking read papers, their critiques, follow-up
work that responds to earlier papers, and open research questions.

**Config**: default lenses. Often a single actor (the reader).

```bash
node "$GATE" register --name me

# Each paper = one fast-tracked request; critique = review
GUILD_ACTOR=me node "$GATE" fast-track \
  --action "Paper: Attention Is All You Need (2017)" \
  --reason "Transformer 原論文。attention のみで seq2seq"
GUILD_ACTOR=me node "$GATE" review 2026-04-18-0001 \
  --by me --lense layer --verdict concern \
  "位置エンコーディングは ad-hoc、後続研究の方向性を示唆する weakness"

# Follow-up paper that references the earlier critique by ID
GUILD_ACTOR=me node "$GATE" fast-track \
  --action "Paper: RoPE (Su 2021)" \
  --reason "2026-04-18-0001 の位置情報 weakness への回答。外挿性あり"
GUILD_ACTOR=me node "$GATE" fast-track \
  --action "Paper: ALiBi (Press 2021)" \
  --reason "同じく 2026-04-18-0001 weakness。bias として注入"

# Open research question referencing both follow-ups
GUILD_ACTOR=me node "$GATE" issues add --from me --severity med --area theory \
  -- "RoPE と ALiBi、長文脈で支配的はどちら? 2026-04-18-0002 と 2026-04-18-0003 の extrapolation 比較探す"
```

**What worked**:

- `chain 2026-04-18-0001` shows **inbound** references — every
  follow-up paper that cited this one. The #45 bidirectional walk
  pays off directly here; citation graphs are inherently bidirectional.
- An open issue mentions multiple paper IDs in its text; chain
  walks those forward refs too. The question _about_ two papers
  gets correctly wired to both papers.
- `voices me` reads as "the reading log with my commentary."

**What pushed back**:

- State machine has no meaning for "read a paper." Every entry
  is fast-tracked.
- Single-actor means review lenses are self-critique only — no
  cross-principal perspective benefit.

**Fit verdict**: partial. The `chain` bidirectional walk is the
big win; it makes gate a credible lightweight reference tracker.
Everything else is overhead the single-principal structure can't
leverage.

---

## 5. Incident post-mortem — detection → mitigation timeline

**Use case**: reconstructing the timeline of a production incident,
attributing cause, process gap, and customer impact, producing
follow-up action items.

**Config**: default lenses. Principals are SRE, DB team, dev owner
— genuinely different roles writing from different viewpoints.

```bash
node "$GATE" register --name sre --display-name "SRE on-call"
node "$GATE" register --name db --display-name "DB team"
node "$GATE" register --name dev --display-name "dev owner"

# The incident as a request; state transitions map to detection/
# triage/mitigation/resolution.
GUILD_ACTOR=sre node "$GATE" request --executor sre \
  --action "INC-2026-04-18: 503 spike (14:02-14:47)" \
  --reason "14:02 UTC 0.1% → 47%. 14:05 pager. 14:47 rollback で復旧"
GUILD_ACTOR=sre node "$GATE" approve 2026-04-18-0001 --by sre \
  --note "14:05 調査開始 — db_connection_pool exhausted"
GUILD_ACTOR=sre node "$GATE" execute 2026-04-18-0001 --by sre \
  --note "14:23 mitigation: deployment 68af3 を rollback"
GUILD_ACTOR=sre node "$GATE" complete 2026-04-18-0001 --by sre \
  --note "14:47 metrics green、incident closed"

# Post-mortem multi-POV review
GUILD_ACTOR=db node "$GATE" review 2026-04-18-0001 \
  --by db --lense layer --verdict concern \
  "deployment 68af3 が connection leak。負荷試験の coverage gap"
GUILD_ACTOR=dev node "$GATE" review 2026-04-18-0001 \
  --by dev --lense cognitive --verdict concern \
  "PR review で close 漏れ見落とし。金曜18時も要因"
GUILD_ACTOR=sre node "$GATE" review 2026-04-18-0001 \
  --by sre --lense user --verdict concern \
  "顧客影響 45分、SLO 超過 5分、status page 更新 7分 gap"

# Action items as new requests; process question as issue
GUILD_ACTOR=db node "$GATE" request --from db --executor db \
  --action "負荷試験に connection leak 検出を追加 (2026-04-18-0001 INC から)" \
  --reason "coverage gap を埋める"
GUILD_ACTOR=dev node "$GATE" issues add --from dev --severity high --area process \
  -- "金曜夕方 deploy 禁止を制度化するか: 2026-04-18-0001 INC root cause"
```

**What worked**:

- **state machine is almost isomorphic to incident lifecycle**:
  pending = detected, approved = triaged, executing = mitigating,
  completed = resolved. The `status_log` with per-transition
  notes _is_ the incident timeline. This is the single cleanest
  fit among the six domains.
- Three lenses map to **technical root cause / process gap /
  customer impact** — the classic post-mortem triad.
- Follow-up action items with `executor` assignments, open
  process questions as issues — both supported by existing
  vocabulary.

**What pushed back**:

- Nothing significant.

**Fit verdict**: **Maximum gift**. The state machine that was
overhead everywhere else becomes a gift here because the domain's
native time structure matches gate's.

---

## 6. Solo journal — multi-voice self-dialogue

**Use case**: one person recording a decision while deliberately
separating perspectives (rational self, emotional self, imagined
future self, internal skeptic).

**Config**: **custom lenses** declared in `guild.config.yaml`.
Multiple "selves" registered as members to carry the different
voices.

```yaml
# guild.config.yaml
lenses:
  - rational
  - emotional
  - future-self
  - skeptic
```

```bash
node "$GATE" register --name me --display-name "Me (current)"
node "$GATE" register --name tomorrow --display-name "Me (tomorrow)"

GUILD_ACTOR=me node "$GATE" request \
  --action "仕事を辞めて 6ヶ月研究に専念するか" \
  --reason "貯金1年分。合わない3割で疲労大。平行1年試して失速"

# Self-review on the same decision through four separate lenses
GUILD_ACTOR=me node "$GATE" review 2026-04-18-0001 --by me \
  --lense rational --verdict concern \
  "財務は合理的。6ヶ月は弱気に取るべき、9ヶ月バッファで考え直す"
GUILD_ACTOR=me node "$GATE" review 2026-04-18-0001 --by me \
  --lense emotional --verdict concern \
  "疲労は本物。だが逃避と方向転換は区別すべき"
GUILD_ACTOR=tomorrow node "$GATE" review 2026-04-18-0001 --by tomorrow \
  --lense future-self --verdict ok \
  "6ヶ月後は 'やってよかった' と言う。ゴール明文化が条件"
GUILD_ACTOR=me node "$GATE" review 2026-04-18-0001 --by me \
  --lense skeptic --verdict reject \
  "決断しないことの不安からの決断。毎晩3時間で3週間続くか試せ"

# Skeptic's critique becomes a concrete pre-commitment action
GUILD_ACTOR=me node "$GATE" fast-track \
  --action "3週間の毎晩3時間テスト開始 (2026-04-18-0001 の skeptic concern への応答)" \
  --reason "決断前の検証。疲労か方向転換かを切り分け"
```

**What worked**:

- **Custom lenses become domain-specific perspective framework**.
  The four lenses read as four separable voices; gate's
  ⚠ self-review warning fires appropriately but doesn't block,
  matching the intended semantic (the reviewer _is_ the same
  person, on purpose).
- An action item that references a specific critique by verdict
  traces "what the skeptic said → what I did about it."
- Multiple "self" actors (me / tomorrow) let future-self
  reasoning carry a different `by` without lying about authorship.

**What pushed back**:

- **Bug (found via this dogfood, fixed in PR #52)**: custom
  lenses were accepted on write but rejected on listAll-backed
  read verbs (`chain`, `voices`, `tail`). `findById` passed
  `config.lenses` to hydrate; `listByState` didn't. Fixed.
- Single-principal state machine still has no traction. Every
  entry is fast-tracked.
- ⚠ self-review warnings fire on every lens — semantically
  correct but noisy when the pattern is intentional. A future
  convention might be `--self-review-ok` to suppress when the
  solo-dialogue use is declared.

**Fit verdict**: partial. The custom-lens mechanism generalizes
review beautifully to multi-voice self-dialogue, but the lifecycle
machinery sits unused. Good case study of how review and state
machine are orthogonal axes of fit.

---

## Summary matrix

| Domain | state machine | review lenses | issues | chain | Overall fit |
|---|---|---|---|---|---|
| Story | ✗ (fast-track) | ✓ authorial | ✓ foreshadowing | ○ beat refs | partial |
| Meeting | ✓ deny→refile | ✓ multi-POV | ✓ parking lot | ✓ decision graph | **max** |
| Game design | ✗ | ✓ multi-lens | ✓ open Qs | ○ | strong |
| Research | ✗ | ✓ self-critique | ✓ open Qs | ✓✓ citations | partial |
| Incident | ✓✓ isomorphic | ✓ triad | ✓ follow-ups | ○ | **max** |
| Solo journal | ✗ | ✓ custom lenses | — | — | partial |

The two "max" fits have a shared property: **multiple principals
deliberating about the same record across time**. The "partial"
fits either collapse principals to one (research, solo journal) or
have a domain time structure that doesn't match gate's (story,
game design). `design-notes.md` unpacks this further.
