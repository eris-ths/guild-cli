// agora — Play (a play session against a Game definition).
//
// Where a Game is the design (rules, kind, title), a Play is one
// instance of running through that design — moves accumulating,
// possibly suspended mid-flight, eventually concluded.
//
// AI-first per principle 11:
//   - state machine is explicit and append-only — re-entering instance
//     can reconstruct the play from the file alone
//   - `state: suspended` is first-class (not derived from "no recent
//     activity") so suspend/resume becomes an act, not a guess
//   - moves[] is append-only; suspend/resume mutate state field but
//     never edit existing moves
//
// State machine (v0 — minimal):
//
//   playing ─ suspend ─▶ suspended ─ resume ─▶ playing
//      │                     │
//      └────── conclude ─────┴────────▶ concluded (terminal)
//
// `concluded` accepts both transitions because a play can be
// abandoned mid-suspension (the cliff was never picked back up;
// "the conversation drifted away" is a valid outcome).

import { DomainError } from '../../../domain/shared/DomainError.js';

export type PlayState = 'playing' | 'suspended' | 'concluded';

const VALID_STATES: ReadonlySet<PlayState> = new Set([
  'playing',
  'suspended',
  'concluded',
]);

export function parsePlayState(raw: unknown): PlayState {
  if (typeof raw !== 'string' || !VALID_STATES.has(raw as PlayState)) {
    throw new DomainError(
      `play state must be one of ${[...VALID_STATES].join(', ')}, got: ${String(raw)}`,
      'state',
    );
  }
  return raw as PlayState;
}

/**
 * Play id format: YYYY-MM-DD-NNN (sequence per game per day).
 *
 * Different from gate's request id (no game prefix because the play
 * lives under `agora/plays/<game-slug>/`, the directory disambiguates).
 * 3-digit sequence by default; widens to 4 if a single game gets
 * over 999 plays in one day, which is more activity than v0 needs to
 * handle.
 */
const PLAY_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-\d{3,4}$/;

export function parsePlayId(raw: unknown): string {
  if (typeof raw !== 'string' || !PLAY_ID_PATTERN.test(raw)) {
    throw new DomainError(
      `play id must match YYYY-MM-DD-NNN, got: ${String(raw)}`,
      'play_id',
    );
  }
  return raw;
}

export interface PlayProps {
  readonly id: string; // YYYY-MM-DD-NNN
  readonly game: string; // game slug this play references
  readonly state: PlayState;
  readonly started_at: string;
  readonly started_by: string;
  readonly moves: readonly PlayMove[];
  readonly suspensions: readonly SuspensionEntry[];
  readonly resumes: readonly ResumeEntry[];
  /**
   * Set when state is `concluded`. Inline (not array) because
   * `concluded` is terminal — at most one conclusion per play.
   * Mirrors gate's pattern of putting closure prose on the closing
   * status_log entry rather than in a separate stream.
   */
  readonly concluded_at?: string;
  readonly concluded_by?: string;
  readonly concluded_note?: string;
}

export interface PlayMove {
  readonly id: string; // sequence inside the play (e.g., "001")
  readonly at: string;
  readonly by: string;
  readonly text: string;
}

/**
 * One suspension event. Append-only. Every suspend appends a new
 * entry; every resume appends a corresponding entry to `resumes`.
 *
 * The `cliff` is what just happened (the unfinished thread); the
 * `invitation` is what the next opener should do. Both are
 * required because the whole point of agora's pivot is that
 * suspension is **information for re-entry**, not just "I left."
 *
 * Per principle 11, the prose is user-written — the substrate
 * doesn't auto-generate it. An empty cliff/invitation defeats
 * the purpose.
 */
export interface SuspensionEntry {
  readonly at: string;
  readonly by: string;
  readonly cliff: string;
  readonly invitation: string;
}

/**
 * One resume event, paired with the most-recent suspension by index
 * (resumes[N] resumes suspensions[N]). State-derivation invariant:
 *   suspensions.length === resumes.length    → play is `playing` (or `concluded`)
 *   suspensions.length === resumes.length + 1 → play is `suspended`
 */
export interface ResumeEntry {
  readonly at: string;
  readonly by: string;
  readonly note?: string; // optional prose: "noir resumed and addressed the contradiction"
}

export class Play {
  readonly id: string;
  readonly game: string;
  readonly state: PlayState;
  readonly started_at: string;
  readonly started_by: string;
  readonly moves: readonly PlayMove[];
  readonly suspensions: readonly SuspensionEntry[];
  readonly resumes: readonly ResumeEntry[];
  readonly concluded_at?: string;
  readonly concluded_by?: string;
  readonly concluded_note?: string;

  private constructor(props: PlayProps) {
    this.id = props.id;
    this.game = props.game;
    this.state = props.state;
    this.started_at = props.started_at;
    this.started_by = props.started_by;
    this.moves = props.moves;
    this.suspensions = props.suspensions;
    this.resumes = props.resumes;
    if (props.concluded_at !== undefined) this.concluded_at = props.concluded_at;
    if (props.concluded_by !== undefined) this.concluded_by = props.concluded_by;
    if (props.concluded_note !== undefined) this.concluded_note = props.concluded_note;
  }

  static start(input: {
    id: string;
    game: string;
    started_by: string;
    now?: () => Date;
  }): Play {
    const id = parsePlayId(input.id);
    if (typeof input.game !== 'string' || input.game.trim().length === 0) {
      throw new DomainError('game required (non-empty string)', 'game');
    }
    if (
      typeof input.started_by !== 'string' ||
      input.started_by.trim().length === 0
    ) {
      throw new DomainError(
        'started_by required (non-empty string)',
        'started_by',
      );
    }
    const started_at = (input.now ?? (() => new Date()))().toISOString();
    return new Play({
      id,
      game: input.game,
      state: 'playing',
      started_at,
      started_by: input.started_by,
      moves: [],
      suspensions: [],
      resumes: [],
    });
  }

  static restore(props: PlayProps): Play {
    return new Play({
      id: parsePlayId(props.id),
      game: props.game,
      state: parsePlayState(props.state),
      started_at: props.started_at,
      started_by: props.started_by,
      moves: props.moves,
      suspensions: props.suspensions,
      resumes: props.resumes,
      ...(props.concluded_at !== undefined ? { concluded_at: props.concluded_at } : {}),
      ...(props.concluded_by !== undefined ? { concluded_by: props.concluded_by } : {}),
      ...(props.concluded_note !== undefined ? { concluded_note: props.concluded_note } : {}),
    });
  }

  /**
   * Are we currently in a suspension? Derived from the array
   * lengths — the source of truth is the append-only history,
   * not a separate flag. (The `state` field on disk mirrors this
   * for read convenience but the domain checks the arrays.)
   */
  get isSuspended(): boolean {
    return this.suspensions.length === this.resumes.length + 1;
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      id: this.id,
      game: this.game,
      state: this.state,
      started_at: this.started_at,
      started_by: this.started_by,
      moves: this.moves.map((m) => ({ ...m })),
    };
    if (this.suspensions.length > 0) {
      out['suspensions'] = this.suspensions.map((s) => ({ ...s }));
    }
    if (this.resumes.length > 0) {
      out['resumes'] = this.resumes.map((r) => ({ ...r }));
    }
    if (this.concluded_at !== undefined) out['concluded_at'] = this.concluded_at;
    if (this.concluded_by !== undefined) out['concluded_by'] = this.concluded_by;
    if (this.concluded_note !== undefined) out['concluded_note'] = this.concluded_note;
    return out;
  }
}

export class PlayIdCollision extends Error {
  constructor(id: string) {
    super(`Play id already exists: ${id}`);
    this.name = 'PlayIdCollision';
  }
}

export class GameNotFoundForPlay extends Error {
  constructor(slug: string) {
    super(
      `Game "${slug}" does not exist. Create it first with: agora new --slug ${slug} --kind <quest|sandbox> --title "..."`,
    );
    this.name = 'GameNotFoundForPlay';
  }
}

export class PlayNotFound extends Error {
  constructor(id: string) {
    super(`Play "${id}" not found`);
    this.name = 'PlayNotFound';
  }
}

/**
 * Optimistic-lock conflict on append-move. The expected version is
 * the moves.length the caller loaded; the actual version is what's
 * on disk now. AI-natural: an instance re-entering and appending
 * sees a structured collision (not a silent overwrite).
 */
export class PlayVersionConflict extends Error {
  readonly code = 'PLAY_VERSION_CONFLICT' as const;
  constructor(
    readonly id: string,
    readonly expected: number,
    readonly found: number,
  ) {
    super(
      `Play ${id} changed on disk (expected moves count ${expected}, found ${found}); reload and retry`,
    );
    this.name = 'PlayVersionConflict';
  }
}

/**
 * State-machine refusal: caller tried to append a move to a play
 * that's no longer accepting them (suspended or concluded). The
 * agent gets a structured error that names the current state,
 * not silent failure.
 */
export class PlayNotPlayable extends Error {
  constructor(
    readonly id: string,
    readonly state: PlayState,
  ) {
    super(
      `Play ${id} is in state "${state}"; only "playing" plays accept moves. ` +
        (state === 'suspended'
          ? `Resume first: agora resume ${id}`
          : `Concluded plays are terminal.`),
    );
    this.name = 'PlayNotPlayable';
  }
}

/** Tried to suspend a play that's already suspended (or concluded). */
export class PlayCannotSuspend extends Error {
  constructor(
    readonly id: string,
    readonly state: PlayState,
  ) {
    super(
      `Play ${id} is in state "${state}"; only "playing" plays can be suspended. ` +
        (state === 'suspended'
          ? `Resume first if you want to suspend again with a new cliff.`
          : `Concluded plays are terminal.`),
    );
    this.name = 'PlayCannotSuspend';
  }
}

/** Tried to resume a play that isn't suspended. */
export class PlayCannotResume extends Error {
  constructor(
    readonly id: string,
    readonly state: PlayState,
  ) {
    super(
      `Play ${id} is in state "${state}"; only "suspended" plays can be resumed.`,
    );
    this.name = 'PlayCannotResume';
  }
}

/** Tried to conclude a play that's already concluded. */
export class PlayAlreadyConcluded extends Error {
  constructor(readonly id: string) {
    super(
      `Play ${id} is already concluded — terminal state, no further transitions.`,
    );
    this.name = 'PlayAlreadyConcluded';
  }
}
