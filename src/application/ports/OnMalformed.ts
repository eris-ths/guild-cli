// OnMalformed — port for surfacing data-loss events from hydrate
// paths. The infrastructure layer's GuildConfig.OnMalformed type is
// structurally identical; this port lives in application so use cases
// (e.g. DiagnosticUseCases) don't reach back into infrastructure.

export type OnMalformed = (msg: string) => void;
