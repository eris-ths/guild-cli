import { buildContainer } from '../shared/container.js';
import { GuildConfig } from '../../infrastructure/config/GuildConfig.js';
import { loadVerbPlugins } from '../../infrastructure/plugin/VerbPluginLoader.js';
import { loadHookPlugins } from '../../infrastructure/plugin/HookPluginLoader.js';
import { parseArgs, optionalOption, HelpRequested } from '../shared/parseArgs.js';
import { renderVerbHelp } from '../shared/verbHelp.js';
import { nearestCommand } from '../shared/nearestCommand.js';
import { REQUEST_STATES } from '../../domain/request/RequestState.js';
import { getPackageVersion, isVersionFlag } from '../shared/version.js';
import { emitErrorEnvelope } from '../shared/errorEnvelope.js';
import {
  reqCreate,
  reqList,
  reqShow,
  reqApprove,
  reqDeny,
  reqExecute,
  reqComplete,
  reqFail,
  reqFastTrack,
} from './handlers/request.js';
import { reqReview } from './handlers/review.js';
import { reqClaim } from './handlers/claim.js';
import { reqWitness, reqUnwitness } from './handlers/witness.js';
import { reqThank } from './handlers/thank.js';
import {
  reqVoices,
  reqTail,
  reqWhoami,
  reqChain,
} from './handlers/read.js';
import { issuesCmd } from './handlers/issues.js';
import { boardCmd } from './handlers/board.js';
import { doctorCmd } from './handlers/doctor.js';
import { repairCmd } from './handlers/repair.js';
import { bootCmd } from './handlers/boot.js';
import { schemaCmd } from './handlers/schema.js';
import { resumeCmd } from './handlers/resume.js';
import { restCmd } from './handlers/rest.js';
import { wakeCmd } from './handlers/wake.js';
import { farewellCmd } from './handlers/farewell.js';
import { reqRegister } from './handlers/register.js';
import {
  msgSend,
  msgBroadcast,
  msgInbox,
} from './handlers/messages.js';
import { statusCmd } from './handlers/status.js';
import { suggestCmd } from './handlers/suggest.js';
import { flowSuggestCmd } from './handlers/flowSuggest.js';
import { transcriptCmd } from './handlers/transcript.js';
import { waveStatusCmd } from './handlers/waveStatus.js';
import { lenseStatsCmd } from './handlers/lenseStats.js';
import { reviewContextCmd } from './handlers/reviewContext.js';
import { summarizeCmd } from './handlers/summarize.js';
import { whyCmd } from './handlers/why.js';
import { unrespondedCmd } from './handlers/unresponded.js';
import { templatesCmd } from './handlers/templates.js';
import { withEntryLock } from '../../infrastructure/lock/withEntryLock.js';
import { resolveGuildActor } from '../shared/resolveGuildActor.js';
import { READ_VERBS, WRITE_VERBS, LOCK_EXEMPT_VERBS } from './verbs.js';
import { renderHelp } from './help.js';
import type { Container } from '../shared/container.js';
import type { ParsedArgs } from '../shared/parseArgs.js';

// Re-export for test backward-compat (tests/interface/reviewMarkers.test.ts).
// formatReviewMarkers and computeReviewMarkerWidth live in handlers/request.ts
// but tests still import from this module path.
export {
  formatReviewMarkers,
  computeReviewMarkerWidth,
} from './handlers/request.js';

// Top-level `gate --help` text is rendered by `renderHelp` (see
// ./help.ts): tiered by guild profile, with a `--all` override that
// shows the full catalog. `gate schema --format json` remains
// exhaustive regardless of profile or --all.

// Mirror of the switch below for typo suggestions. Keeping it adjacent
// to the switch (rather than auto-derived) is an obvious-when-broken
// signal: a new verb forgotten here just loses its did-you-mean entry,
// it doesn't crash anything.
const KNOWN_COMMANDS = [
  'request', 'pending', 'board', 'list', 'show', 'voices', 'tail',
  'whoami', 'register', 'chain', 'approve', 'deny', 'execute',
  'complete', 'fail', 'review', 'claim', 'witness', 'unwitness',
  'thank', 'fast-track', 'issues', 'message',
  'broadcast', 'inbox', 'doctor', 'repair', 'status', 'boot',
  'suggest', 'flow-suggest', 'transcript', 'summarize', 'why', 'resume', 'schema',
  'unresponded',
  'templates',
  'rest',
  'wake',
  'farewell',
  'wave-status',
  'lense-stats',
  'review-context',
] as const;

export async function main(argv: readonly string[]): Promise<number> {
  if (isVersionFlag(argv)) {
    process.stdout.write(`guild-cli ${getPackageVersion()}\n`);
    return 0;
  }
  const [cmd, ...rest] = argv;
  // Top-level help (#324). Tiering uses the guild profile loaded
  // from disk: standard → BASE only, swarm → BASE + COORDINATION,
  // `--all` → full catalog regardless. Config load failures fall
  // back to a standard-profile view so `gate --help` keeps working
  // even on a misconfigured root (the help payload is purely
  // informational and must never block diagnosis).
  if (!cmd || cmd === '--help' || cmd === '-h') {
    const wantAll = rest.includes('--all');
    let profile: 'standard' | 'swarm' = 'standard';
    try {
      profile = GuildConfig.load().profile;
    } catch {
      profile = 'standard';
    }
    process.stdout.write(renderHelp({ profile, all: wantAll }));
    return 0;
  }
  const args = parseArgs(rest);
  // Verb plugins (#36 Phase 1 step 4). Loaded before buildContainer
  // because dynamic ESM `import()` is async; the container itself
  // stays synchronous so test bootstraps don't need to thread an
  // async pre-pass through their helpers. Built-in command names
  // are reserved — the loader rejects collisions, so a plugin can
  // never shadow a core verb.
  const config = GuildConfig.load();
  const builtInNames = new Set<string>(KNOWN_COMMANDS);
  const verbPluginLoad = await loadVerbPlugins(
    config.verbPluginPaths,
    builtInNames,
  );
  // Hook plugins (#36 Phase 1 step 5). Loaded in parallel with verb
  // plugins because the two are independent; sequential here only
  // because the await contract is simpler. Container exposes the
  // resulting subscription map and load errors to handlers and
  // doctor respectively.
  const hookPluginLoad = await loadHookPlugins(config.hookPluginPaths);
  const c = buildContainer({
    verbPlugins: verbPluginLoad.plugins,
    verbPluginErrors: verbPluginLoad.errors,
    verbPluginsLoaded: verbPluginLoad.pluginsLoaded,
    hookSubscriptions: hookPluginLoad.subscriptions,
    hookPluginErrors: hookPluginLoad.errors,
    hookPluginsLoaded: hookPluginLoad.pluginsLoaded,
  });
  try {
    // #200: <write-verb> --help must not block on the lock. Help is
    // read-only; routing it through withEntryLock would surface
    // lock_busy when another writer holds the lock, even though the
    // dispatch path here only walks to the handler's rejectUnknownFlags
    // which throws HelpRequested before any side effect.
    if (args.options['help'] === true) {
      return await dispatch(cmd, c, args);
    }
    // #196: prefer an explicit placeholder over an empty string so
    // lock metadata / LockBusyError messages remain self-explanatory
    // when GUILD_ACTOR / .guild-actor are absent. Pass-through of
    // --by/--from at the entry layer is intentionally out of scope
    // (deferred follow-up); this is a strictly diagnostic improvement.
    const actor = resolveGuildActor() ?? '(unset)';
    // Augment the verb sets with the loaded plugins so the lock
    // middleware classifies plugin verbs by their declared category
    // rather than falling through to the unknown→write fail-safe.
    // category 'meta' rides with READ (introspection); 'admin' rides
    // with LOCK_EXEMPT (doctor / repair maintenance pattern).
    const readSet = new Set<string>(READ_VERBS);
    const writeSet = new Set<string>(WRITE_VERBS);
    const exemptSet = new Set<string>(LOCK_EXEMPT_VERBS);
    for (const p of c.verbPlugins) {
      if (p.category === 'read' || p.category === 'meta') readSet.add(p.name);
      else if (p.category === 'write') writeSet.add(p.name);
      else if (p.category === 'admin') exemptSet.add(p.name);
    }
    return await withEntryLock(
      c.config,
      'gate',
      cmd,
      { READ_VERBS: readSet, WRITE_VERBS: writeSet, LOCK_EXEMPT_VERBS: exemptSet },
      actor,
      () => dispatch(cmd, c, args),
    );
  } catch (e) {
    if (e instanceof HelpRequested) {
      renderVerbHelp('gate', e);
      return 0;
    }
    const fmt = args.options['format'];
    emitErrorEnvelope(
      e,
      typeof fmt === 'string' ? fmt : undefined,
      c.config.contentRoot,
    );
    return 1;
  }
}

async function dispatch(
  cmd: string,
  c: Container,
  args: ParsedArgs,
): Promise<number> {
  switch (cmd) {
    case 'request':
      return await reqCreate(c, args);
    case 'pending':
      return await reqList(c, 'pending', args, 'pending');
    case 'board':
      return await boardCmd(c, args);
    case 'list': {
      // `gate list` (no --state) defaults to `--state all`: the
      // muscle-memory call returns every request across every state,
      // matching `agora list` / `devil list` / `gate issues list`.
      // Pre-#218 this exited 1 with a hint that disclosed the
      // `--state` enum + the `all` sugar; now the hint lives in
      // `<verb> --help` (PR #163) and the hot-path call "just
      // works." Behaviour change documented under BREAKING (#217).
      //
      // The deliberate default-all is consistent with sibling list
      // verbs across all 4 passages and with `ls`-style muscle
      // memory; agents that want a specific subset still pass
      // `--state pending` (or any other state) and get the same
      // narrow result they did before.
      const state = optionalOption(args, 'state') ?? 'all';
      return await reqList(c, state, args, 'list');
    }
    case 'show':
      return await reqShow(c, args);
    case 'voices':
      return await reqVoices(c, args);
    case 'tail':
      return await reqTail(c, args);
    case 'whoami':
      return await reqWhoami(c, args);
    case 'register':
      return await reqRegister(c, args);
    case 'chain':
      return await reqChain(c, args);
    case 'approve':
      return await reqApprove(c, args);
    case 'deny':
      return await reqDeny(c, args);
    case 'execute':
      return await reqExecute(c, args);
    case 'complete':
      return await reqComplete(c, args);
    case 'fail':
      return await reqFail(c, args);
    case 'review':
      return await reqReview(c, args);
    case 'claim':
      return await reqClaim(c, args);
    case 'witness':
      return await reqWitness(c, args);
    case 'unwitness':
      return await reqUnwitness(c, args);
    case 'thank':
      return await reqThank(c, args);
    case 'fast-track':
      return await reqFastTrack(c, args);
    case 'issues':
      return await issuesCmd(c, args);
    case 'message':
      return await msgSend(c, args);
    case 'broadcast':
      return await msgBroadcast(c, args);
    case 'inbox':
      return await msgInbox(c, args);
    case 'doctor':
      return await doctorCmd(c, args);
    case 'repair':
      return await repairCmd(c, args);
    case 'status':
      return await statusCmd(c, args);
    case 'boot':
      return await bootCmd(c, args);
    case 'suggest':
      return await suggestCmd(c, args);
    case 'flow-suggest':
      return await flowSuggestCmd(c, args);
    case 'transcript':
      return await transcriptCmd(c, args);
    case 'wave-status':
      return await waveStatusCmd(c, args);
    case 'lense-stats':
      return await lenseStatsCmd(c, args);
    case 'review-context':
      return await reviewContextCmd(c, args);
    case 'summarize':
      return await summarizeCmd(c, args);
    case 'why':
      return await whyCmd(c, args);
    case 'resume':
      return await resumeCmd(c, args);
    case 'rest':
      return await restCmd(c, args);
    case 'wake':
      return await wakeCmd(c, args);
    case 'farewell':
      return await farewellCmd(c, args);
    case 'schema':
      return await schemaCmd(c, args);
    case 'unresponded':
      return await unrespondedCmd(c, args);
    case 'templates':
      return await templatesCmd(c, args);
    default: {
      // Verb plugin dispatch (#36 Phase 1 step 4). Built-in cases
      // run first (the switch above); plugins are the fall-through
      // step before "unknown command". Built-in name collisions are
      // already filtered out in the loader, so a plugin reaching
      // this point is guaranteed not to shadow core dispatch.
      for (const p of c.verbPlugins) {
        if (p.name === cmd) {
          return await p.run(c, args);
        }
      }
      // The did-you-mean hint searches both core verbs and loaded
      // plugins so a typo against a plugin verb still gets a useful
      // suggestion ("did you mean: gate myverb?").
      const candidates = [
        ...KNOWN_COMMANDS,
        ...c.verbPlugins.map((p) => p.name),
      ];
      const hint = nearestCommand(cmd, candidates);
      const suggest = hint ? `\n  did you mean: gate ${hint}?` : '';
      process.stderr.write(
        `unknown command: ${cmd}${suggest}\n` +
          `  see 'gate --help' for the full command list.\n`,
      );
      return 1;
    }
  }
}

