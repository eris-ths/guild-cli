# Plugin examples

End-to-end examples for the three extension surfaces:

- **Verb plugins** — register new `gate <verb>` commands without
  forking the core dispatcher
- **Hook plugins** — observe / veto the request lifecycle with
  `before:` / `after:` callbacks
- **Voice plugins** — attach deployment-local personality to
  write-verb responses, schema descriptions, `--help` curation,
  and `gate boot`'s read surfaces — without forking, without
  touching the substrate's neutral voice

> **Field-by-field schema reference**: see
> [`docs/plugin-schema.md`](../../docs/plugin-schema.md) for the
> runtime type of every `ctx.request.*` field hooks receive (which
> are value objects needing `.value`, which are plain primitives,
> and the `toJSON()` escape hatch). Read it before writing your
> first hook — the value-object footgun (`ctx.request.from === 'alice'`
> is always false) is the #1 source of silent policy bugs.

Both surfaces share one consent gate (`plugins.trusted: true`) and
one trust model (in-process, full Node capabilities, no sandbox).
See `SECURITY.md` § "Plugin trust model" before loading any plugin
you didn't author.

## Quick start

1. Drop a plugin file under your content_root:

   ```
   <content_root>/
     guild.config.yaml
     plugins/
       echo.mjs              # copy of examples/plugins/verbs/echo.mjs
       audit-log.mjs         # copy of examples/plugins/hooks/audit-log.mjs
   ```

2. Declare it in `guild.config.yaml`:

   ```yaml
   plugins:
     trusted: true                    # one gate for every plugin kind
     verbs:
       - plugins/echo.mjs
     hooks:
       - plugins/audit-log.mjs
   ```

   Plugin paths must resolve **under** `content_root` — `safeFs`
   refuses to load anything outside (same rule every persistence
   path follows).

3. Run:

   ```
   $ gate echo --text "hello"
   hello

   $ gate approve <id> --by alice
   ✓ approved: <id>
   # audit-log.mjs has now appended one JSON line to ./audit.log
   ```

4. Inspect what's loaded:

   ```
   $ gate schema --format json --verb echo | jq .verbs[0].source
   "plugin"

   $ gate doctor --format text
   ...
   plugins loaded: 2
       ✓ [loaded] /path/to/plugins/echo.mjs
       ✓ [loaded] /path/to/plugins/audit-log.mjs
   ```

## Trust model (read this first)

- **Plugins run in-process with full Node.js capabilities.** They
  can read your files, talk to the network, exec subprocesses,
  modify environment variables, and crash the CLI. There is no
  sandbox.
- **`plugins.trusted: true` is the consent gate.** Without it,
  every entry under `plugins.verbs` / `plugins.hooks` is dropped
  with a stderr notice. The YAML alone is not consent — a
  teammate's `git pull` should not silently start running new code
  on your machine.
- **Origin matters more than review.** Whitelist by author (a
  known team member, a vendored module you've audited end-to-end),
  not by reading the diff at PR time.
- **Plugin failures are non-fatal.** A broken plugin surfaces as
  a `gate doctor` finding under `area: 'plugin'`, not as a CLI
  crash. Read verbs (`gate boot`, `gate show`, …) keep working
  even when an extension is broken.

Full discussion: [`SECURITY.md`](../../SECURITY.md) § "Plugin trust
model"; stability contract in [`docs/POLICY.md`](../../docs/POLICY.md)
§ "Plugin stability".

## Verb plugins

Add a new `gate <verb>` command. The plugin's default export carries
the same shape `gate schema` declares for built-in verbs, plus a
`run` function:

```js
// plugins/echo.mjs
export default {
  name: 'echo',                                              // [a-z][a-z0-9-]*, must not collide with a built-in
  category: 'meta',                                          // 'read' | 'write' | 'admin' | 'meta'
  summary: 'echo --text <s> back to stdout',
  input:  { type: 'object', properties: { ... } },           // JsonSchema
  output: { type: 'object', properties: { ... } },           // JsonSchema
  run: async (c, args) => {
    // c    — the gate Container (use cases, config, etc.)
    // args — ParsedArgs (positional + options)
    process.stdout.write(args.options['text'] + '\n');
    return 0;                                                // exit code: 0 success, non-zero error
  },
};
```

**Built-in verbs always win.** A plugin claiming a name that
collides with a core verb is rejected at load time and surfaces as
a `gate doctor` finding. Plugins cannot shadow `request`,
`approve`, etc.

**Lock classification follows the declared `category`:**

| `category` | Lock behaviour |
|-----------|----------------|
| `read`    | no lock (read verbs run concurrently) |
| `meta`    | no lock (introspection, like `gate schema`) |
| `write`   | content-root-wide lock acquired (default) |
| `admin`   | exempt (like `doctor` / `repair` — maintenance-tier) |

**Working example**: [`verbs/echo.mjs`](verbs/echo.mjs).

## Hook plugins

Observe or veto request lifecycle transitions and review appends.
A hook subscribes to one or more events:

```
before:approve  before:deny  before:execute  before:complete  before:fail  before:review
after:approve   after:deny   after:execute   after:complete   after:fail   after:review
```

```js
// plugins/audit-log.mjs
export default {
  on: ['after:approve', 'after:complete', 'after:fail'],     // single event or array
  run: async (ctx) => {
    // ctx.event   — 'after:approve' | ...
    // ctx.request — Request snapshot (post-mutation for after:, pre-mutation for before:)
    // ctx.actor   — the --by / --from invoker (canonicalised)
  },
};
```

### Two flavours

|         | Veto? | Throw behaviour |
|---------|-------|-----------------|
| `before:<verb>` | Return `{ allow: false, reason }` to block | Treated as veto (fail-closed — a buggy security policy should block, not silently pass) |
| `after:<verb>`  | Cannot veto (transition already happened) | Logged to stderr as a warning; transition succeeds |

**First veto wins.** Remaining `before:` hooks for the same event
do **not** run after a veto. Order is the order of `plugins.hooks`
in `guild.config.yaml` — a "deny everything else" hook can sit at
the end of the chain.

**Working examples**:
- [`hooks/audit-log.mjs`](hooks/audit-log.mjs) — `after:` flavour,
  multi-event subscription, write to a side-effect file
- [`hooks/policy-no-self-approve.mjs`](hooks/policy-no-self-approve.mjs)
  — `before:` flavour, conditional veto

## Voice plugins

Voice plugins are **pure data** (no `run` function). They attach
optional personality to surfaces a write verb or `gate boot`
already renders — augment-only, the doctrinal voice held in
handlers (principle 08) is never replaced. Stripping `_meta.voice`
from a pipeline loses zero information.

```js
// plugins/voices/mine.mjs
export default {
  name: 'mine',                                  // [a-z][a-z0-9-]*
  verbs: {
    complete: [
      { when: 'cliff_present', template: '{action} 閉じた。 次の手: 「{cliff}」' },
      { when: 'default',        template: '{action} 完。' },
    ],
    review: [
      { when: 'verdict_ok',      template: '{lense} 異存なし。' },
      { when: 'verdict_concern', template: '{lense} 懸念 — {comment}' },
      { when: 'verdict_reject',  template: '{lense} 通せない — {comment}' },
    ],
  },
  // Optional sections — each independent. A plugin may carry any subset.
  essentials: {
    verbs: ['boot', 'next', 'voice', 'fast-track', 'complete', 'review'],
    note: 'my daily',
  },
  schema: {
    verbs: {
      complete: {
        summary: 'my-flavored summary for complete',
        input: { cliff: '次に拾う者へのメッセージ' },
      },
    },
  },
  read: {
    past_cliffs: {
      header: '── 過去から {count} 通の手紙:',
      entry:  '   ✧ {action} → 「{cliff}」',
    },
  },
};
```

**Activation** — 4-layer resolution, most specific wins:

1. `--voice <name>` (per-invocation; e.g. `gate schema --voice mine`)
2. `GUILD_VOICE` env (session)
3. `<content_root>/.guild-voice` file (cwd-stable; written by `gate voice <name>`)
4. `voice.default: <name>` in `guild.config.yaml` (deployment baseline)

**`gate voice` verb** is the lever for layer 3:

```bash
gate voice                  # introspect (active voice + which layer)
gate voice mine             # write .guild-voice
gate voice off              # clear
```

Set is permissive on whether the named voice is currently loaded —
mirrors the silent-miss contract on the rest of the cluster.

**Sections**:

| Section | Surface | Notes |
|---------|---------|-------|
| `verbs.<verb>` | `_meta.voice` on write-verb JSON envelope; `⟶ …` line on stderr in text mode | Wired for `approve` / `deny` / `execute` / `complete` (incl. fast-track's complete segment) / `fail` / `review` |
| `essentials` | `gate --help --essentials` (multi-line) / `--essentials --compact` (one line / verb) | Orthogonal to the BASE / COORDINATION / EXTRA tiering; pass `--all` for the full catalog |
| `schema` | `gate schema --voice <name>` overlays `summary` + per-flag `description` | Per-invocation flag; doesn't touch the layer-3 file |
| `read.past_cliffs` | `gate boot --format text` "past cliffs" section | JSON mode unaffected; structured `past_cliffs` preserves the data shape |

**Template variables** (sourced from substrate state — voice cannot invent facts):

| Variable | Source |
|----------|--------|
| `{id}` | `req.id.value` |
| `{action}` | `req.action` |
| `{by}` | terminal status_log entry's actor (review: the just-appended review's actor) |
| `{note}` | `status_log[-1].note` |
| `{cliff}` | `status_log[-1].cliff` (completed entries only) |
| `{verdict}` / `{lense}` / `{comment}` | `reviews[-1].*` on review verb |
| `{count}` / `{closed_by}` / `{closed_at}` | read-surface vars (`read.past_cliffs.entry`) |

Unknown vars render as literal `{name}` — typo loudness is the invariant.

**`when` predicates**:

| Predicate | Matches when |
|-----------|--------------|
| `default` | always (use as the last entry per verb) |
| `cliff_present` / `cliff_absent` | terminal entry's cliff is / isn't set |
| `with_note` / `without_note` | terminal entry's note is / isn't set |
| `verdict_ok` / `verdict_concern` / `verdict_reject` | review's verdict |

First matching `when` per array wins. Predicate set is intentionally small — additive within 0.x.

**Honesty invariants** (carry over from the write-verb landing):

- Doctrinal voice (the verb's `message`, `suggested_next.reason`,
  schema description, etc.) is **never** replaced by voice plugin
  content. Voice augments; never substitutes. Principle 08 stands.
- `_meta.voice` carries personality, not facts. Variables come from
  substrate state; templates cannot reach outside the supported set.
- `fail` / `complete` voice fires on **wave-terminal only**, never on
  slice-only closures. Narrating a slice as "completed" would be a
  false claim about wave state.

**Working example**: a runnable voice plugin lives under
[`voices/eris-sample.mjs`](./voices/eris-sample.mjs) (added 2026-05-14)
demonstrating all four sections.

## Diagnostics

Every plugin path's load outcome is in `gate doctor` output:

```
$ gate doctor --format json | jq '.plugins_loaded'
[
  { "path": "/.../plugins/echo.mjs",      "status": "loaded" },
  { "path": "/.../plugins/audit-log.mjs", "status": "loaded" },
  { "path": "/.../plugins/broken.mjs",    "status": "error"  }
]
```

Load failures appear as `findings` with `area: "plugin"` and a
prefix discriminating the plugin kind:

```json
{ "area": "plugin", "source": "/.../plugins/broken.mjs",
  "kind": "unknown", "message": "verb plugin: import failed: ..." }
```

A broken plugin never breaks the CLI — read verbs keep working
regardless.

## Stability

The plugin contract is **additive within a 0.x line**: new optional
fields may appear in any release; renaming or removing existing
fields requires a minor bump and a `BREAKING` entry in `CHANGELOG.md`.
Hook firing order is part of the contract — reordering existing
fire points is breaking. See [`docs/POLICY.md`](../../docs/POLICY.md)
§ "Plugin stability" for the full rule.

## Roadmap

Phase 1 ships **verb plugins** (#36 step 4, PR #258) and **hook
plugins** (#36 step 5, PR #259). The remaining Phase 1 surface —
**content transforms** (`on:save` / `on:load` around YAML I/O,
step 6) — is deferred. Phase 2 (time-aware verbs) and Phase 3
(federation) are tracked in [#36](https://github.com/eris-ths/guild-cli/issues/36).
