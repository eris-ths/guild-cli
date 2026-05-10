# Plugin schema reference

Type-shape contract for plugin authors writing **verb plugins** and **hook
plugins** under [`examples/plugins/`](../examples/plugins/) /
[`SECURITY.md` § Plugin trust model](../SECURITY.md#plugin-trust-model).

This doc is the **source of truth** for what fields each callback
receives at runtime. Not all fields on a domain object are plain
strings — some are value objects that need `.value` to unwrap. Read
this *before* writing your first hook; the alternative is reading the
domain code under `src/domain/`.

> **Issue tracking:** [#280](https://github.com/eris-ths/guild-cli/issues/280).
> The longer-term shape (a normalized JSON projection so plugin authors
> never see value objects) is dogfood-trigger waited; this doc is the
> interim contract.

---

## Stability rule

Additive within a 0.x line. New optional fields may appear in any
release; renaming or removing existing fields requires a minor bump
and a `BREAKING` entry in `CHANGELOG.md`. Hook firing order is part
of the contract — reordering existing fire points is breaking.
See [`docs/POLICY.md` § Plugin stability](POLICY.md#plugin-stability).

---

## Hook plugin contract

A hook plugin's default export shape:

```js
export default {
  on: 'before:approve' | 'after:approve' | [...],   // one or many
  run: async (ctx) => { /* ... */ },
};
```

### `HookContext` shape (passed to `run`)

| field          | runtime type                  | notes |
|----------------|-------------------------------|-------|
| `ctx.event`    | `string`                      | Discriminator like `'before:approve'`. Useful when one plugin subscribes to many events. |
| `ctx.request`  | `Request` instance            | Pre-mutation snapshot for `before:`; post-mutation for `after:`. **Has value-object fields** — see § Request reference below. |
| `ctx.actor`    | `string`                      | The canonicalised `--by` / `--from` invoker. Already trimmed and lowercased. |
| `ctx.extra`    | `{ review?: ... }` \| undefined | Event-specific. Only `before:review` / `after:review` set `extra.review` (the appended review record). |

### Veto shape (`before:` hooks)

```js
return { allow: false, reason: 'org policy: ...' };  // veto
return undefined;                                    // pass
```

- Returning `{ allow: false, reason }` from a `before:` hook blocks
  the transition. Exit code 1; `reason` is written to stderr as
  `hook vetoed <event> on <id>: <reason>`.
- First veto wins — later `before:` hooks for the same event do **not**
  run.
- A `before:` hook that **throws** is treated as a veto (fail-closed).
  A buggy security policy should block the transition, not silently
  pass it through. The veto reason becomes `hook threw on <event>: <error>`.
- `after:` hooks **cannot veto** (the transition has already landed).
  Errors are logged to stderr but never break the handler.

### Lifecycle events

Phase 1 covers six request-lifecycle verbs plus review:

| event | fires when | `ctx.request.state` (post for `after:`) |
|-------|------------|------------------------------------------|
| `before:approve` / `after:approve` | `gate approve` / `gate fast-track` | `approved` |
| `before:deny`    / `after:deny`    | `gate deny`                        | `denied` (terminal) |
| `before:execute` / `after:execute` | `gate execute` / `gate fast-track` | `executing` |
| `before:complete`/ `after:complete`| `gate complete` / `gate fast-track`| `completed` (terminal) |
| `before:fail`    / `after:fail`    | `gate fail`                        | `failed` (terminal) |
| `before:review`  / `after:review`  | `gate review`                      | unchanged (review is non-mutating on state) |

`fast-track` runs three sub-transitions (approve → execute → complete)
and fires the corresponding before/after hooks at each step (#279). A
veto at any step aborts the chain and leaves the substrate in the
pre-veto state.

Verbs **not** covered by phase 1: `request` (creation has no
`before:create` / `after:create` event yet), `claim` / `witness` /
`unwitness` (stake-axis verbs, not lifecycle), `thank` (annotation,
not transition).

---

## Request reference (the field-by-field part)

`ctx.request` is a `Request` **class instance**, not a plain object.
Some getters return value objects (need `.value`); some return plain
primitives. The table below tells you which.

### Value-object fields — need `.value` to unwrap

| getter | runtime type | unwrap |
|--------|--------------|--------|
| `request.id`         | `RequestId`           | `request.id.value` → e.g. `'2026-05-10-0001'` |
| `request.from`       | `MemberName`          | `request.from.value` → e.g. `'alice'` |
| `request.executors`  | `readonly MemberName[]` | `request.executors.map(m => m.value)` |
| `request.autoReview` | `MemberName \| undefined` | `request.autoReview?.value` |
| `request.with`       | `readonly MemberName[]` | `request.with.map(m => m.value)` |
| `request.claimedBy`  | `MemberName \| undefined` | `request.claimedBy?.value` |
| `request.witnesses`  | `readonly MemberName[]` | `request.witnesses.map(m => m.value)` |

> **Footgun**: `request.from === 'alice'` is **always false** (object
> !== string). Use `request.from.value === 'alice'`. The
> `policy-no-self-approve.mjs` example shows the correct pattern.

### Plain primitives — no unwrap needed

| getter | runtime type | example value |
|--------|--------------|---------------|
| `request.state`       | string union: `'pending'\|'approved'\|'executing'\|'completed'\|'failed'\|'denied'` | `'approved'` |
| `request.action`      | `string`                  | `'ship #279 lifecycle hooks'` |
| `request.reason`      | `string`                  | `'audit-log gap surfaced in dogfood'` |
| `request.target`      | `string \| undefined`     | `'src/interface/gate/handlers/request.ts'` or undef |
| `request.depth`       | `'standard'\|'deep' \| undefined` | `'deep'` or undef |
| `request.promotedFrom`| `string \| undefined`     | issue id like `'i-2026-04-15-0007'` or undef |
| `request.sourceAgoraPlay` | `string \| undefined` | play id or undef |
| `request.template`    | `string \| undefined`     | template name or undef |
| `request.templateVersion` | `number \| undefined` | `1` or undef |
| `request.gateRequiredAcknowledged` | `boolean \| undefined` | true/false/undef |
| `request.requiresWorktreeIsolation` | `boolean`         | false-by-default |
| `request.lastExecutingCwd` | `string \| undefined` | absolute path or undef |
| `request.openedBySession` | `string \| undefined` | session id or undef |
| `request.claimedAt`   | `string \| undefined`     | ISO timestamp |
| `request.claimedBySession` | `string \| undefined` | session id |
| `request.claimNote`   | `string \| undefined`     | free-form |

### Collections that hold their own value-object fields

| getter | element type | unwrap pattern |
|--------|--------------|----------------|
| `request.reviews`   | `readonly Review[]` | `request.reviews.map(r => ({ by: r.by.value, lense: r.lense, verdict: r.verdict, comment: r.comment, at: r.at }))` |
| `request.statusLog` | `readonly StatusLogEntry[]` | each `entry.by` is a `MemberName` (`.value` to unwrap); `entry.state` / `entry.note` are strings |
| `request.thanks`    | `readonly Thank[]`  | `t.by.value` / `t.to.value`; `t.note` / `t.at` are strings |
| `request.witnessNotes`    | `ReadonlyMap<string, string>` | iterate with `for (const [actor, note] of map)` |
| `request.witnessSessions` | `ReadonlyMap<string, string>` | same shape |

---

## The escape hatch — `request.toJSON()`

When a hook only needs to **read** the request (audit log, external
notification, derived index rebuild), call `request.toJSON()` to get
a fully-flattened plain-JSON projection — no value objects, no
classes, snake_case keys matching the on-disk YAML form:

```js
export default {
  on: ['after:approve', 'after:execute', 'after:complete'],
  run: async (ctx) => {
    const snapshot = ctx.request.toJSON();
    // snapshot.from === 'alice'  (string, no .value)
    // snapshot.executors === ['alice']  (string array)
    // snapshot.id === '2026-05-10-0001'
    // ... matches the YAML on disk
    appendFileSync('audit.log', JSON.stringify({ event: ctx.event, ...snapshot }) + '\n');
  },
};
```

This is the recommended path for `after:` hooks where you only
inspect, never compare against business logic. For `before:` hooks
that do identity comparisons (e.g. *"is the actor the author?"*), the
class-instance form is fine — just remember `.value`.

---

## `ctx.extra.review` (review events only)

`before:review` and `after:review` carry the appended review on
`ctx.extra.review`:

```js
export default {
  on: 'after:review',
  run: async (ctx) => {
    const r = ctx.extra?.review;
    if (!r) return;
    // r.by is a MemberName: r.by.value to unwrap
    // r.lense, r.verdict, r.comment, r.at are strings
    appendFileSync('reviews.log', `${r.by.value}: ${r.lense}/${r.verdict}\n`);
  },
};
```

The same value-object/string distinction as `ctx.request` applies.
`ctx.extra` itself is `undefined` for non-review events — always
defensive-check.

---

## Verb plugin contract

Verb plugins register a new `gate <verb>` command:

```js
export default {
  name: 'echo',
  describe: 'Print arguments back to stdout',
  run: async ({ args, config }) => {
    process.stdout.write(args.options.text + '\n');
    return 0;   // exit code
  },
};
```

| field | runtime type | notes |
|-------|--------------|-------|
| `args.positional` | `string[]` | positional arguments (everything not a flag) |
| `args.options`    | `Record<string, string \| true>` | flags. A bare `--foo` is `true`; `--foo bar` or `--foo=bar` is the string |
| `config`          | `GuildConfig` | the loaded config (read-only). Use `config.contentRoot`, `config.lenses`, `config.gate.strictLenses`, etc. |

The `run` function returns the **process exit code** (`0` success,
non-zero failure). Throwing also exits non-zero with the error
message on stderr.

---

## Common patterns

### Audit log (multi-event after-hook, file write)

See [`examples/plugins/hooks/audit-log.mjs`](../examples/plugins/hooks/audit-log.mjs).
Uses `ctx.request.toJSON()` to get the plain projection, multi-event
subscription via `on: [...]`, and `appendFileSync` for the side effect.

### Policy gate (before-hook, conditional veto)

See [`examples/plugins/hooks/policy-no-self-approve.mjs`](../examples/plugins/hooks/policy-no-self-approve.mjs).
Reads `ctx.request.from.value` (note `.value`!) and compares to
`ctx.actor` (already a string).

### Conditional warning (before-hook, never veto)

```js
export default {
  on: 'before:approve',
  run: async (ctx) => {
    if (ctx.request.reason.includes('urgent') || ctx.request.reason.includes('緊急')) {
      process.stderr.write(`⚠ urgent flag in reason — review carefully: ${ctx.request.id.value}\n`);
    }
    // returning undefined = pass; the warning is observation-only
  },
};
```

### Derived-index rebuild (after-hook, idempotent)

```js
export default {
  on: ['after:approve', 'after:complete', 'after:fail', 'after:deny'],
  run: async (ctx) => {
    const snapshot = ctx.request.toJSON();
    await rebuildIndex(snapshot.id, snapshot.state);  // idempotent by id
  },
};
```

The `after:` hook fires exactly once per transition, so derived-index
work is naturally idempotent on `(id, state)` pairs.

---

## Footguns (read this once)

1. **`ctx.request.from === 'alice'` is always false.** Use
   `ctx.request.from.value === 'alice'`. The same applies to
   `executors[]`, `autoReview`, `with[]`, `claimedBy`, `witnesses[]`.
2. **`ctx.actor` is already a string.** Don't reach for `.value` on
   it. (Only `ctx.request.*` member fields are value objects.)
3. **`ctx.extra` may be undefined.** Always optional-chain:
   `ctx.extra?.review`.
4. **`before:` hook errors fail-closed.** A typo that throws will
   block the transition. Test your hook — or use `try/catch` inside
   to convert unexpected errors to explicit vetoes with a useful
   reason.
5. **`fast-track` fires hooks at each sub-step (#279).** A
   `before:approve` policy hook will fire 3 times if a single
   `gate fast-track` is the user-facing trigger — once per
   sub-transition (approve / execute / complete). Idempotency on
   `(event, id)` is the safest stance.
6. **`ctx.request.toJSON()` is the easiest read-path.** If you don't
   need value-object methods, prefer `toJSON()` over reaching into
   `.value` everywhere — fewer footguns, and your hook keeps working
   if a future minor release re-shapes a getter.

---

## Intentionally undocumented Request getters

These `Request` getters exist on the class but are deliberately **not**
exposed to plugin authors. Adding a row here (vs adding a row to the
field tables above) is the explicit choice when a new getter lands —
the CI sync check (`tests/docs/pluginSchemaDocSync.test.ts`, #283)
forces one or the other on every new `Request` getter.

- `loadedVersion` — internal version-counter for optimistic CAS on
  `requests.save()`. Plugins should not branch on this.
- `currentVersion` — sibling of `loadedVersion`; same rationale.
- `mutationSeq` — internal sequence number for in-memory mutation
  ordering. Not stable across processes.

If you reach for one of these inside a plugin, you almost certainly
want a different field — open an issue describing the use case.

## Where to look next

- [`SECURITY.md` § Plugin trust model](../SECURITY.md#plugin-trust-model) — what `plugins.trusted: true` actually grants
- [`examples/plugins/`](../examples/plugins/) — runnable examples for every contract above
- [`docs/POLICY.md` § Plugin stability](POLICY.md#plugin-stability) — versioning rules for the plugin contract
- `src/application/plugin/HookPlugin.ts` / `src/application/plugin/VerbPlugin.ts` — TypeScript contracts (the .d.ts source of truth)
- `src/domain/request/Request.ts` — full Request class, in case a getter you need isn't documented above
