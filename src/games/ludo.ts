import { randomInt, type BotLevel, type Engine, type Outcome } from './engine';

/**
 * Ludo for 2–4 players.
 * Colours: 0 Red, 1 Green, 2 Yellow, 3 Blue (clockwise). 2 players use Red + Yellow (opposite corners).
 *
 * Token progress per token: -1 = in the yard, 0..50 = on the shared 52-square track
 * (absolute square = (START[colour] + progress) % 52), 51..55 = own home column, 56 = home (finished).
 *
 * Rules: roll a 6 to leave the yard; landing on an opponent outside a safe square sends it back to
 * its yard; a 6 or a capture gives another roll; exact roll needed to reach home; first player with
 * all 4 tokens home wins. Players who leave (or miss 3 turns) are removed; last player left wins.
 */
export const LUDO_COLORS = ['Red', 'Green', 'Yellow', 'Blue'] as const;
export const LUDO_HEX = ['#E53935', '#43A047', '#F9C613', '#1E88E5'];
export const LUDO_START = [0, 13, 26, 39];
/** Start squares and star squares. */
export const LUDO_SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
export const HOME = 56;
const LAST_TRACK = 50;

export interface LudoMove { seat: number; token: number; from: number; to: number; captured: number[] }

export interface LudoState {
  /** Colour index for each seat. */
  colors: number[];
  /** seat * 4 + token → progress. */
  pos: number[];
  turn: number;
  phase: 'roll' | 'move';
  dice: number;
  /** Increments on every roll so clients can animate the dice. */
  rollId: number;
  /** Seat that made the latest roll. */
  rolledBy: number;
  movable: number[];
  active: boolean[];
  winner: number;
  lastMove: LudoMove | null;
  /** Short text of what just happened (shown under the dice). */
  log: string;
}

export type LudoAction = { type: 'roll'; value: number } | { type: 'move'; token: number };

export const colorsForPlayers = (players: number) => (players === 2 ? [0, 2] : players === 3 ? [0, 1, 2] : [0, 1, 2, 3]);

export function absoluteSquare(color: number, progress: number): number {
  return (LUDO_START[color] + progress) % 52;
}

function movableTokens(state: LudoState, seat: number, dice: number): number[] {
  const tokens: number[] = [];
  for (let token = 0; token < 4; token++) {
    const progress = state.pos[seat * 4 + token];
    if (progress === -1 && dice === 6) tokens.push(token);
    else if (progress >= 0 && progress < HOME && progress + dice <= HOME) tokens.push(token);
  }
  return tokens;
}

function nextActive(state: LudoState, from: number): number {
  const seats = state.colors.length;
  for (let step = 1; step <= seats; step++) {
    const seat = (from + step) % seats;
    if (state.active[seat]) return seat;
  }
  return from;
}

/** Simulates moving one token; returns the new positions and who got captured. */
function simulate(state: LudoState, seat: number, token: number, dice: number) {
  const pos = [...state.pos];
  const index = seat * 4 + token;
  const from = pos[index];
  const to = from === -1 ? 0 : from + dice;
  pos[index] = to;
  const captured: number[] = [];
  if (to <= LAST_TRACK) {
    const square = absoluteSquare(state.colors[seat], to);
    if (!LUDO_SAFE.has(square)) {
      state.colors.forEach((color, other) => {
        if (other === seat || !state.active[other]) return;
        for (let t = 0; t < 4; t++) {
          const progress = pos[other * 4 + t];
          if (progress >= 0 && progress <= LAST_TRACK && absoluteSquare(color, progress) === square) {
            pos[other * 4 + t] = -1;
            captured.push(other * 4 + t);
          }
        }
      });
    }
  }
  return { pos, from, to, captured };
}

const allHome = (pos: number[], seat: number) => [0, 1, 2, 3].every(token => pos[seat * 4 + token] === HOME);

function outcome(state: LudoState): Outcome | null {
  if (state.winner >= 0) {
    const activeCount = state.active.filter(Boolean).length;
    const byRace = allHome(state.pos, state.winner);
    return { winners: [state.winner], draw: false, reason: byRace ? `${LUDO_COLORS[state.colors[state.winner]]} got all 4 tokens home` : activeCount <= 1 ? 'Everyone else left — win by forfeit' : 'Winner' };
  }
  return null;
}

/** How dangerous a track square is: opponents 1..6 squares behind it could hit it. */
function danger(state: LudoState, seat: number, square: number, pos: number[]): number {
  if (LUDO_SAFE.has(square)) return 0;
  let threats = 0;
  state.colors.forEach((color, other) => {
    if (other === seat || !state.active[other]) return;
    for (let t = 0; t < 4; t++) {
      const progress = pos[other * 4 + t];
      if (progress < 0 || progress > LAST_TRACK) continue;
      const theirs = absoluteSquare(color, progress);
      const distance = (square - theirs + 52) % 52;
      if (distance >= 1 && distance <= 6) threats++;
    }
  });
  return threats;
}

export function ludoBestToken(state: LudoState, seat: number, rng: () => number): number {
  let best = state.movable[0];
  let bestScore = -Infinity;
  for (const token of state.movable) {
    const { pos, from, to, captured } = simulate(state, seat, token, state.dice);
    let score = rng() * 2;
    if (to === HOME) score += 100;
    score += captured.length * 60;
    if (from === -1) score += 35;
    if (from <= LAST_TRACK && to > LAST_TRACK && to < HOME) score += 30;
    if (to <= LAST_TRACK) {
      const square = absoluteSquare(state.colors[seat], to);
      if (LUDO_SAFE.has(square)) score += 15;
      score -= danger(state, seat, square, pos) * 18;
    }
    if (from >= 0 && from <= LAST_TRACK) score += danger(state, seat, absoluteSquare(state.colors[seat], from), state.pos) * 14;
    score += to * 0.3;
    if (score > bestScore) { bestScore = score; best = token; }
  }
  return best;
}

export const ludo: Engine<LudoState, LudoAction> = {
  id: 'ludo',
  minPlayers: 2,
  maxPlayers: 4,
  turnSeconds: 30,
  init(players) {
    const colors = colorsForPlayers(Math.min(4, Math.max(2, players)));
    return {
      colors,
      pos: colors.flatMap(() => [-1, -1, -1, -1]),
      turn: 0,
      phase: 'roll',
      dice: 0,
      rollId: 0,
      rolledBy: -1,
      movable: [],
      active: colors.map(() => true),
      winner: -1,
      lastMove: null,
      log: ''
    };
  },
  current: state => (state.winner >= 0 ? -1 : state.turn),
  outcome,
  apply(state, action, seat) {
    if (state.winner >= 0) throw new Error('The game is over.');
    if (seat !== state.turn) throw new Error("It's not your turn.");
    const name = LUDO_COLORS[state.colors[seat]];
    if (action.type === 'roll') {
      if (state.phase !== 'roll') throw new Error('Move a token first.');
      const value = Math.round(action.value);
      if (value < 1 || value > 6) throw new Error('Invalid dice.');
      const movable = movableTokens(state, seat, value);
      const base = { ...state, dice: value, rollId: state.rollId + 1, rolledBy: seat, lastMove: null };
      if (!movable.length) {
        const next = nextActive(state, seat);
        return { ...base, phase: 'roll', movable: [], turn: next, log: `${name} rolled ${value} — no move` };
      }
      return { ...base, phase: 'move', movable, log: `${name} rolled ${value}` };
    }
    if (state.phase !== 'move') throw new Error('Roll the dice first.');
    const token = Math.round(action.token);
    if (!state.movable.includes(token)) throw new Error('That token cannot move.');
    const { pos, from, to, captured } = simulate(state, seat, token, state.dice);
    const won = allHome(pos, seat);
    const extra = !won && (state.dice === 6 || captured.length > 0);
    const capturedNames = captured.map(index => LUDO_COLORS[state.colors[Math.floor(index / 4)]]);
    const log = won ? `${name} wins!` : captured.length ? `${name} captured ${capturedNames.join(', ')}! Roll again` : to === HOME ? `${name} token reached home${extra ? ' — roll again' : ''}` : extra ? `${name} rolled a 6 — roll again` : '';
    return {
      ...state,
      pos,
      phase: 'roll',
      movable: [],
      turn: won ? seat : extra ? seat : nextActive(state, seat),
      winner: won ? seat : -1,
      lastMove: { seat, token, from, to, captured },
      log
    };
  },
  removePlayer(state, seat) {
    if (!state.active[seat]) return { state, outcome: outcome(state) };
    const active = [...state.active];
    active[seat] = false;
    const pos = [...state.pos];
    for (let token = 0; token < 4; token++) pos[seat * 4 + token] = -1;
    let next: LudoState = { ...state, active, pos, log: `${LUDO_COLORS[state.colors[seat]]} left the game` };
    const remaining = active.map((on, index) => (on ? index : -1)).filter(index => index >= 0);
    if (remaining.length === 1) next = { ...next, winner: remaining[0], turn: remaining[0], phase: 'roll', movable: [] };
    else if (state.turn === seat) next = { ...next, turn: nextActive(next, seat), phase: 'roll', movable: [], dice: 0 };
    return { state: next, outcome: outcome(next) };
  },
  autoAction(state, rng) {
    if (state.winner >= 0) return null;
    if (state.phase === 'roll') return { type: 'roll', value: 1 + randomInt(rng, 6) };
    return { type: 'move', token: ludoBestToken(state, state.turn, rng) };
  },
  bot(state, seat, rng, level: BotLevel = 'medium') {
    // The dice are always fair; difficulty only changes which token the computer moves.
    if (state.phase === 'roll') return { type: 'roll', value: 1 + randomInt(rng, 6) };
    const randomPick = level === 'easy' ? 0.6 : level === 'medium' ? 0.2 : 0;
    if (rng() < randomPick) return { type: 'move', token: state.movable[randomInt(rng, state.movable.length)] };
    return { type: 'move', token: ludoBestToken(state, seat, rng) };
  }
};

// ---------------- board geometry (15×15 grid) ----------------

/** The 52 shared track squares as [row, col], starting at Red's start square, clockwise. */
export const TRACK: [number, number][] = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7], [0, 8],
  [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14], [8, 14],
  [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7], [14, 6],
  [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0], [6, 0]
];

/** Home column squares (progress 51..55) per colour. */
export const HOME_COLUMN: [number, number][][] = [
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]]
];

/** Top-left cell of each colour's 6×6 yard. */
export const YARD_ORIGIN: [number, number][] = [[0, 0], [0, 9], [9, 9], [9, 0]];
const YARD_SPOTS: [number, number][] = [[1.5, 1.5], [1.5, 3.5], [3.5, 1.5], [3.5, 3.5]];
/** Where finished tokens sit inside the centre triangle of their colour. */
const HOME_SPOT: [number, number][] = [[7, 6.25], [6.25, 7], [7, 7.75], [7.75, 7]];

/** Centre point (row, col in grid units, +0.5 = cell centre) for a token. */
export function tokenPoint(color: number, token: number, progress: number): [number, number] {
  if (progress < 0) {
    const [r, c] = YARD_ORIGIN[color];
    const [dr, dc] = YARD_SPOTS[token];
    return [r + dr + 0.5, c + dc + 0.5];
  }
  if (progress === HOME) {
    const [r, c] = HOME_SPOT[color];
    return [r + 0.5, c + 0.5];
  }
  if (progress > LAST_TRACK) {
    const [r, c] = HOME_COLUMN[color][progress - 51];
    return [r + 0.5, c + 0.5];
  }
  const [r, c] = TRACK[absoluteSquare(color, progress)];
  return [r + 0.5, c + 0.5];
}
