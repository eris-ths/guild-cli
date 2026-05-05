// Per-CLI, per-verb usage example shown by `<cli> <verb> --help`.
//
// Source of truth is AGENT.md / docs/verbs.md — the examples here are
// the canonical one-liners abridged to the smallest invocation that
// would actually run. Required flags only; optional flags belong in
// docs. Single line per verb so the help output stays a cheat sheet,
// not a usage essay.
//
// Missing entries gracefully degrade to "no example line" — adding a
// verb here is opt-in. A new CLI can ship without touching this map;
// the touch-feel benefit arrives when the example is added. Tests pin
// the CLI×verb pairs that DO exist so a typo (`registr` vs `register`)
// silently dropping the example surfaces in CI.

export const VERB_EXAMPLES: Record<string, Record<string, string>> = {
  gate: {
    register: 'register --name <you>',
    request: 'request --action "<what>" --reason "<why>"',
    approve: 'approve <id>',
    deny: 'deny <id> --reason "<why>"',
    execute: 'execute <id>',
    complete: 'complete <id>',
    fail: 'fail <id> --reason "<why>"',
    'fast-track': 'fast-track --action "<what>" --reason "<why>"',
    review: 'review <id> --lense layer --verdict ok --comment "<note>"',
    thank: 'thank <to> --for <id>',
    message: 'message --to <m> --text "<body>"',
    broadcast: 'broadcast --text "<body>"',
    inbox: 'inbox',
    'inbox mark-read': 'inbox mark-read [N]',
    'issues add': 'issues add --severity med --area <a> "<text>"',
    'issues list': 'issues list',
    'issues note': 'issues note <id> --text "<note>"',
    'issues promote': 'issues promote <id>',
    'issues resolve': 'issues resolve <id>',
    'issues defer': 'issues defer <id>',
    'issues start': 'issues start <id>',
    'issues reopen': 'issues reopen <id>',
    show: 'show <id>',
    list: 'list --state pending',
    board: 'board',
    tail: 'tail [N]',
    chain: 'chain <id>',
    transcript: 'transcript <id>',
    voices: 'voices <name>',
    whoami: 'whoami',
    boot: 'boot',
    status: 'status',
    suggest: 'suggest',
    resume: 'resume',
    summarize: 'summarize <id>',
    why: 'why <id>',
    unresponded: 'unresponded',
    schema: 'schema',
    doctor: 'doctor',
    repair: 'repair --apply',
  },
  agora: {
    new: 'new --slug <s> --kind sandbox --title "<t>"',
    play: 'play --slug <slug>',
    move: 'move <play-id> --text "<text>"',
    suspend: 'suspend <play-id> --cliff "<what>" --invitation "<next>"',
    resume: 'resume <play-id>',
    conclude: 'conclude <play-id>',
    list: 'list',
    show: 'show <slug-or-play-id>',
    last: 'last',
    cliff: 'cliff <play-id>',
    schema: 'schema',
  },
  devil: {
    open: 'open <target-ref> --type pr',
    entry:
      'entry <rev-id> --persona red-team --lense injection ' +
      '--kind finding --text "<prose>" --severity high ' +
      '--severity-rationale "<why>"',
    list: 'list',
    show: 'show <rev-id>',
    conclude: 'conclude <rev-id> --synthesis "<prose>"',
    dismiss: 'dismiss <rev-id> <entry-id> --reason not-applicable',
    resolve: 'resolve <rev-id> <entry-id>',
    suspend: 'suspend <rev-id> --cliff "<what>" --invitation "<next>"',
    resume: 'resume <rev-id>',
    ingest: 'ingest <rev-id> --from claude-security <input-path>',
    schema: 'schema',
  },
  ctx: {
    record: 'record --fact "<prose>" --tag prefix:value,prefix:value',
  },
  guild: {
    list: 'list',
    show: 'show <name>',
    new: 'new --name <n> --category professional',
    validate: 'validate',
  },
};
