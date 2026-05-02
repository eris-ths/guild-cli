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
}

export interface PlayMove {
  readonly id: string; // sequence inside the play (e.g., "001")
  readonly at: string;
  readonly by: string;
  readonly text: string;
}

export class Play {
  readonly id: string;
  readonly game: string;
  readonly state: PlayState;
  readonly started_at: string;
  readonly started_by: string;
  readonly moves: readonly PlayMove[];

  private constructor(props: PlayProps) {
    this.id = props.id;
    this.game = props.game;
    this.state = props.state;
    this.started_at = props.started_at;
    this.started_by = props.started_by;
    this.moves = props.moves;
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
    });
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      game: this.game,
      state: this.state,
      started_at: this.started_at,
      started_by: this.started_by,
      moves: this.moves.map((m) => ({ ...m })),
    };
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
