/**
 * Shared contract for every turn-based EChat game. Engines are pure functions over plain
 * JSON state (no nested arrays, so the state can live directly in a Firestore document).
 */
export type GameId = 'tictactoe' | 'chess' | 'checkers' | 'ludo';
export type HubGameId = GameId | 'snake';
export type BotLevel = 'easy' | 'medium' | 'hard';
export const BOT_LEVELS: { id: BotLevel; label: string }[] = [{ id: 'easy', label: 'Easy' }, { id: 'medium', label: 'Medium' }, { id: 'hard', label: 'Hard' }];

export interface Outcome {
  /** Seat indexes of the winners (empty on a draw). */
  winners: number[];
  draw: boolean;
  reason: string;
}

export interface Engine<S, A> {
  id: GameId;
  minPlayers: number;
  maxPlayers: number;
  /** Seconds a player has for each action before the timeout rule applies. */
  turnSeconds: number;
  init(players: number): S;
  /** Seat that must act now, or -1 when the game is over. */
  current(state: S): number;
  /** Returns the next state, or throws an Error with a readable message for an illegal action. */
  apply(state: S, action: A, seat: number): S;
  outcome(state: S): Outcome | null;
  /** A player left / forfeited. Returns the new state and the outcome if the game is now over. */
  removePlayer(state: S, seat: number, players: number): { state: S; outcome: Outcome | null };
  /** Action taken for a player whose timer ran out (Ludo auto-roll / auto-move). Null = they lose on time. */
  autoAction?(state: S, rng: () => number): A | null;
  /** Computer opponent. Easy makes mistakes often, Medium sometimes, Hard plays its best. */
  bot(state: S, seat: number, rng: () => number, level?: BotLevel): A;
}

export const twoPlayerForfeit = (seat: number): Outcome => ({ winners: [1 - seat], draw: false, reason: 'Opponent left — win by forfeit' });

export interface GameMeta {
  id: HubGameId;
  name: string;
  tagline: string;
  players: string;
  emoji: string;
  /** Tailwind gradient classes for the card art. */
  gradient: string;
  online: boolean;
  computer: boolean;
}

export const GAME_LIST: GameMeta[] = [
  { id: 'ludo', name: 'Ludo', tagline: 'Roll, race and capture. 2–4 players.', players: '2–4 players', emoji: '🎲', gradient: 'from-[#E53935] via-[#FDD835] to-[#1E88E5]', online: true, computer: true },
  { id: 'chess', name: 'Chess', tagline: 'Full rules: castling, check, mate.', players: '2 players', emoji: '♞', gradient: 'from-[#3B4A2F] to-[#769656]', online: true, computer: true },
  { id: 'checkers', name: 'Checkers', tagline: 'Forced jumps and king promotion.', players: '2 players', emoji: '⛀', gradient: 'from-[#7B2D26] to-[#C0392B]', online: true, computer: true },
  { id: 'tictactoe', name: 'Tic-Tac-Toe', tagline: 'Three in a row wins.', players: '2 players', emoji: '❌', gradient: 'from-[#1877F2] to-[#7C3AED]', online: true, computer: true },
  { id: 'snake', name: 'Snake', tagline: 'Eat, grow, beat your high score.', players: '1 player', emoji: '🐍', gradient: 'from-[#065F46] to-[#22C55E]', online: false, computer: false }
];

export const gameMeta = (id: string) => GAME_LIST.find(game => game.id === id);

export const randomInt = (rng: () => number, max: number) => Math.floor(rng() * max);
