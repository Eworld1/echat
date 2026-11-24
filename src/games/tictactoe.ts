import { randomInt, twoPlayerForfeit, type BotLevel, type Engine, type Outcome } from './engine';

/** Seat 0 plays X and moves first; seat 1 plays O. Board: 9 chars of 'X' | 'O' | '-'. */
export interface TttState { board: string; turn: number; forfeit?: Outcome | null }
export interface TttAction { type: 'place'; cell: number }

export const TTT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

export function tttWinningLine(board: string): number[] | null {
  for (const line of TTT_LINES) {
    const [a, b, c] = line;
    if (board[a] !== '-' && board[a] === board[b] && board[a] === board[c]) return line;
  }
  return null;
}

function outcome(state: TttState): Outcome | null {
  if (state.forfeit) return state.forfeit;
  const line = tttWinningLine(state.board);
  if (line) return { winners: [state.board[line[0]] === 'X' ? 0 : 1], draw: false, reason: 'Three in a row' };
  if (!state.board.includes('-')) return { winners: [], draw: true, reason: 'Board full — draw' };
  return null;
}

const minimaxCache = new Map<string, number>();
function minimax(board: string, mark: string, me: string): number {
  const key = `${board}${mark}${me}`;
  const cached = minimaxCache.get(key);
  if (cached !== undefined) return cached;
  const result = minimaxUncached(board, mark, me);
  minimaxCache.set(key, result);
  return result;
}

function minimaxUncached(board: string, mark: string, me: string): number {
  const line = tttWinningLine(board);
  if (line) return board[line[0]] === me ? 10 : -10;
  if (!board.includes('-')) return 0;
  const scores: number[] = [];
  for (let cell = 0; cell < 9; cell++) {
    if (board[cell] !== '-') continue;
    const next = board.slice(0, cell) + mark + board.slice(cell + 1);
    scores.push(minimax(next, mark === 'X' ? 'O' : 'X', me) * 0.9);
  }
  return mark === me ? Math.max(...scores) : Math.min(...scores);
}

export const ticTacToe: Engine<TttState, TttAction> = {
  id: 'tictactoe',
  minPlayers: 2,
  maxPlayers: 2,
  turnSeconds: 30,
  init: () => ({ board: '---------', turn: 0, forfeit: null }),
  current: state => (outcome(state) ? -1 : state.turn),
  outcome,
  apply(state, action, seat) {
    if (outcome(state)) throw new Error('The game is over.');
    if (seat !== state.turn) throw new Error("It's not your turn.");
    const cell = Math.round(action.cell);
    if (action.type !== 'place' || cell < 0 || cell > 8) throw new Error('Invalid move.');
    if (state.board[cell] !== '-') throw new Error('That square is taken.');
    const mark = seat === 0 ? 'X' : 'O';
    return { board: state.board.slice(0, cell) + mark + state.board.slice(cell + 1), turn: 1 - state.turn, forfeit: null };
  },
  removePlayer(state, seat) {
    const forfeit = twoPlayerForfeit(seat);
    return { state: { ...state, forfeit }, outcome: forfeit };
  },
  bot(state, seat, rng, level: BotLevel = 'medium') {
    const me = seat === 0 ? 'X' : 'O';
    const empty = [...state.board].map((value, index) => (value === '-' ? index : -1)).filter(index => index >= 0);
    // Easy: mostly random. Medium: a random move 1 time in 3. Hard: perfect play (you can only draw or win if it can't).
    const mistake = level === 'easy' ? 0.7 : level === 'medium' ? 0.33 : 0;
    if (rng() < mistake) return { type: 'place', cell: empty[randomInt(rng, empty.length)] };
    let best = empty[0];
    let bestScore = -Infinity;
    for (const cell of empty) {
      const next = state.board.slice(0, cell) + me + state.board.slice(cell + 1);
      const score = minimax(next, me === 'X' ? 'O' : 'X', me) + rng() * 0.01;
      if (score > bestScore) { bestScore = score; best = cell; }
    }
    return { type: 'place', cell: best };
  }
};
