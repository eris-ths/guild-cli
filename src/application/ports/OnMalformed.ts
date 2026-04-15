// OnMalformed — port for surfacing data-loss events from hydrate
// paths. The infrastructure layer's GuildConfig.OnMalformed type is
// structurally identical; this port lives in application so use cases
// (e.g. DiagnosticUseCases) don't reach back into infrastructure.
//
// `source` is the absolute filesystem path of the offending file.
// Structured-by-construction so that intervention verbs (gate repair)
// can act on it without parsing free-form messages — this closes
// i-2026-04-15-0025 by making the contract type-enforced rather than
// convention-pinned.

export type OnMalformed = (source: string, msg: string) => void;
