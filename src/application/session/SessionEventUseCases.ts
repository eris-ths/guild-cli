import type { Clock } from '../ports/Clock.js';
import type { MemberRepository } from '../ports/MemberRepository.js';
import { SessionEvent, SessionKind } from '../../domain/session/SessionEvent.js';
import { SessionEventRepository } from './SessionEventRepository.js';
import { assertActor } from '../shared/assertActor.js';

export interface RecordSessionEventInput {
  readonly kind: SessionKind;
  readonly by: string;
  readonly note?: string;
}

/**
 * Outcome of an interceptor run. Mirrors the shape of `HookVeto`
 * without importing it (Clean Arch — the use case layer should not
 * reach into plugin/hook abstractions). The interface caller wraps
 * the hook bus into this contract.
 */
export interface RecordSessionInterceptResult {
  readonly veto: { readonly reason: string } | null;
}

/**
 * Optional interceptors the caller can wire so a hook bus (or other
 * cross-cut) can observe / veto a `record()` call.
 *
 *   - `beforeSave(event)` runs after the SessionEvent aggregate is
 *     built and validated, before persistence. Returning a veto
 *     aborts the record path; the use case throws a
 *     `SessionEventVetoed` error and the handler renders the same
 *     stderr shape as the request-side veto.
 *   - `afterSave(event)` runs after persistence succeeded. Errors
 *     from `afterSave` are the caller's responsibility — the use case
 *     does not catch them.
 *
 * Why callbacks rather than passing the hook bus directly: keeps the
 * application layer free of plugin/hook imports (Clean Arch), and
 * makes the unit-test path trivial — pass a stub interceptor instead
 * of building a hook subscription map.
 */
export interface RecordSessionInterceptors {
  readonly beforeSave?: (event: SessionEvent) => Promise<RecordSessionInterceptResult> | RecordSessionInterceptResult;
  readonly afterSave?: (event: SessionEvent) => Promise<void> | void;
}

/**
 * Thrown by `record()` when a `beforeSave` interceptor vetoes the
 * boundary record. Carries the structured reason so the handler can
 * render it via the shared `emitHookVeto` path. Distinct from a
 * generic `Error` so the handler's catch can route the rendering
 * decisively (rather than string-matching messages).
 */
export class SessionEventVetoed extends Error {
  constructor(
    public readonly verb: SessionKind,
    public readonly reason: string,
  ) {
    super(`hook vetoed ${verb}: ${reason}`);
    this.name = 'SessionEventVetoed';
  }
}

export interface SessionEventUseCasesDeps {
  readonly events: SessionEventRepository;
  readonly members: MemberRepository;
  readonly clock: Clock;
}

/**
 * Use-cases for session-boundary records (#36 Phase 2).
 *
 * Phase 2's first slice (this PR) only wires `record({ kind: 'rest' })`
 * via the `gate rest` handler. The interface accepts the full
 * `SessionKind` union so the wake / farewell handlers in follow-up
 * PRs can reuse `record()` without a domain change.
 */
export class SessionEventUseCases {
  constructor(private readonly deps: SessionEventUseCasesDeps) {}

  /**
   * Record one boundary event. Allocates a per-day sequence id,
   * stamps the system clock, and persists. Returns the saved
   * record so the handler can emit it back to the caller.
   *
   * Optional `interceptors` plug a hook bus (#290) into the
   * before-save / after-save fire points. A `beforeSave` veto
   * throws `SessionEventVetoed` — the handler maps that to the
   * standard `hook vetoed <verb>` stderr surface and exit code 1.
   */
  async record(
    input: RecordSessionEventInput,
    interceptors?: RecordSessionInterceptors,
  ): Promise<SessionEvent> {
    const actor = await assertActor(input.by, '--by', this.deps.members);
    const at = this.deps.clock.now().toISOString();
    const dateKey = at.slice(0, 10); // YYYY-MM-DD
    const seq = await this.deps.events.nextSequence(dateKey);
    const id = `${dateKey}-${String(seq).padStart(3, '0')}`;
    const event = SessionEvent.create({
      id,
      kind: input.kind,
      by: actor,
      at,
      ...(input.note !== undefined ? { note: input.note } : {}),
    });
    if (interceptors?.beforeSave) {
      const result = await interceptors.beforeSave(event);
      if (result.veto) {
        throw new SessionEventVetoed(input.kind, result.veto.reason);
      }
    }
    await this.deps.events.save(event);
    if (interceptors?.afterSave) {
      await interceptors.afterSave(event);
    }
    return event;
  }

  /**
   * Read every session-boundary record under content_root. Used by
   * `gate resume` to surface the most recent boundary in the
   * restoration prose ("you said farewell N hours ago — welcome
   * back"). Pure read, no side effects. Empty when the
   * `<content_root>/sessions/` directory is missing or empty —
   * matches the conservative pattern other repository ports use.
   */
  async listAll(): Promise<readonly SessionEvent[]> {
    return this.deps.events.listAll();
  }
}
