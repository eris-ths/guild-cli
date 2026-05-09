// AgoraPlayBridge — read-only query that resolves a play id into the
// cliff/invitation prose used by `gate request --from-agora <play_id>`
// (#232).
//
// Lives in the gate's application layer (not the agora passage's)
// because the consumer is the gate request handler, and the lift
// rules (which suspension entry to pick, which states to refuse,
// what error message to show) are gate-side bridge policy — not
// agora-side play semantics. The agora repository stays the source of
// truth for the data; this service is the policy that maps Play → the
// two strings the request needs.
//
// Why a thin service instead of inlining into request.ts:
//   - the parse → resolve → state-check → suspension-pick chain has 4
//     distinct refusal reasons (ambiguous id, not found, concluded,
//     no-suspension-yet) and writing them as 4 if-branches inside
//     reqCreate would crowd the create path
//   - tests can target the bridge directly without spawning the CLI
//   - if a future verb (e.g. fast-track --from-agora) wants the same
//     lift, it has one place to call

import { PlayRepository } from '../../passages/agora/application/PlayRepository.js';
import { Play, parsePlayId } from '../../passages/agora/domain/Play.js';
import { resolvePlayForVerb } from '../../passages/agora/interface/handlers/resolvePlay.js';
import { GuildConfig } from '../../infrastructure/config/GuildConfig.js';

/**
 * Refusal kinds the bridge can surface. Each carries enough structure
 * for the interface layer to render an actionable error with a
 * `next:` hint without re-parsing prose.
 */
export type AgoraBridgeRefusal =
  | { kind: 'invalid_id'; raw: string; detail: string }
  | { kind: 'not_found'; playId: string; agoraRoot: string }
  | { kind: 'concluded'; playId: string; game: string }
  | { kind: 'no_suspension'; playId: string; game: string; state: string };

/**
 * Successful resolution. `cliff` and `invitation` come from the most
 * recent suspension entry — the same entry `agora cliff` returns. The
 * play id is echoed back so the handler can stamp it into
 * `Request.sourceAgoraPlay` without re-parsing.
 */
export interface AgoraBridgeResolution {
  readonly playId: string;
  readonly game: string;
  readonly state: 'playing' | 'suspended';
  readonly cliff: string;
  readonly invitation: string;
  readonly suspendedAt: string;
  readonly suspendedBy: string;
}

export type AgoraBridgeResult =
  | { ok: true; value: AgoraBridgeResolution }
  | { ok: false; refusal: AgoraBridgeRefusal };

/**
 * Resolve a `<play_id>` from an agora play into bridge inputs for
 * `gate request --from-agora`.
 *
 * Acceptance rules (per #232 spec):
 *   - state = `concluded` → refuse (terminal — bridging into a closed
 *     thread would mis-represent the request as following a live
 *     conversation).
 *   - state = `playing` or `suspended` → accept, BUT only if the play
 *     actually has at least one suspension on record. A `playing`
 *     play that has never been suspended has no cliff/invitation, so
 *     bridging would fabricate the prose; refuse with a hint pointing
 *     at `agora suspend`.
 *   - id with cross-game collision → resolvePlayForVerb throws
 *     PlayIdAmbiguous; the caller's outer-catch surfaces it via the
 *     normal error envelope (not handled here — same contract as
 *     `agora cliff`).
 *
 * Suspension picking: most recent entry, regardless of whether it has
 * been resumed. The same choice `agora cliff` makes — "what was the
 * conversation about most recently" matches the request author's
 * intent ("I want to act on the latest cliff").
 */
export class AgoraPlayBridge {
  constructor(
    private readonly plays: PlayRepository,
    private readonly config: GuildConfig,
  ) {}

  /**
   * Resolve `playIdRaw` to bridge inputs. `gameFilter` disambiguates
   * cross-game id collisions (mirrors `agora cliff --game <slug>`);
   * undefined means "scan all games and surface the unique match
   * (or throw PlayIdAmbiguous on collision)".
   *
   * Throws PlayIdAmbiguous on cross-game collision (same as
   * resolvePlayForVerb). All other failures return a refusal so the
   * handler can render a tailored error per kind.
   */
  async resolve(
    playIdRaw: string,
    gameFilter: string | undefined,
  ): Promise<AgoraBridgeResult> {
    let playId: string;
    try {
      playId = parsePlayId(playIdRaw);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { ok: false, refusal: { kind: 'invalid_id', raw: playIdRaw, detail } };
    }

    const play: Play | null = await resolvePlayForVerb(
      this.plays,
      playId,
      gameFilter,
    );
    if (play === null) {
      return {
        ok: false,
        refusal: {
          kind: 'not_found',
          playId,
          // Surface the agora root the bridge looked under so the
          // operator sees WHICH content_root rejected the lookup
          // (multi-root setups occasionally cross paths). Mirrors the
          // shape `agora cliff` uses when not_found bubbles up.
          agoraRoot: this.config.contentRoot,
        },
      };
    }

    if (play.state === 'concluded') {
      return {
        ok: false,
        refusal: { kind: 'concluded', playId: play.id, game: play.game },
      };
    }

    const lastSuspension = play.suspensions[play.suspensions.length - 1];
    if (!lastSuspension) {
      return {
        ok: false,
        refusal: {
          kind: 'no_suspension',
          playId: play.id,
          game: play.game,
          state: play.state,
        },
      };
    }

    return {
      ok: true,
      value: {
        playId: play.id,
        game: play.game,
        // Narrow the type: state was already filtered to non-concluded.
        state: play.state as 'playing' | 'suspended',
        cliff: lastSuspension.cliff,
        invitation: lastSuspension.invitation,
        suspendedAt: lastSuspension.at,
        suspendedBy: lastSuspension.by,
      },
    };
  }
}
