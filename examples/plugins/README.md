# Plugin examples

End-to-end examples for the two extension surfaces shipped under
[#36](https://github.com/eris-ths/guild-cli/issues/36) Phase 1:

- **Verb plugins** — register new `gate <verb>` commands without
  forking the core dispatcher
- **Hook plugins** — observe / veto the request lifecycle with
  `before:` / `after:` callbacks

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
