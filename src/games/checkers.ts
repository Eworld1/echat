import { randomInt, twoPlayerForfeit, type Engine, type Outcome } from './engine';

/**
 * American checkers / English draughts on an 8×8 board.
 * Seat 0 = Red (bottom, moves up, moves first). Seat 1 = Black (top, moves down).
 * Board: 64 chars, index = row * 8 + col. 'r' / 'R' (king) = Red, 'b' / 'B' = Black, '.' = empty.
 * Captures are mandatory, multi-jumps must be completed with the same piece, a man reaching the
 * far row is crowned (and the turn ends). No legal move = loss. 40 moves each without a capture
 * or crowning = draw.
 */
export interface CheckersState {
  board: string;
  turn: number;
  /** Square that must keep jumping (multi-jump in progress), or -1. */
  forcedFrom: number;
  /** Plies since the last capture or crowning. */
  quiet: number;
  lastMove: { from: number; to: number; captured: number } | null;
  forfeit?: Outcome | null;
}
export interface CheckersAction { type: 'move'; from: number; to: number }
export interface CheckersMove { from: number; to: number; captured: number }

const DRAW_PLIES = 80;

export const pieceOwner = (piece: string) => (piece === 'r' || piece === 'R' ? 0 : piece === 'b' || piece === 'B' ? 1 : -1);
const isKing = (piece: string) => piece === 'R' || piece === 'B';

function directions(piece: string): [number, number][] {
  if (isKing(piece)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  return piece === 'r' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
}

const inside = (row: number, col: number) => row >= 0 && row < 8 && col >= 0 && col < 8;

function jumpsFrom(board: string, square: number): CheckersMove[] {
  const piece = board[square];
  const owner = pieceOwner(piece);
  if (owner < 0) return [];
  const row = Math.floor(square / 8);
  const col = square % 8;
  const moves: CheckersMove[] = [];
  for (const [dr, dc] of directions(piece)) {
    const midRow = row + dr, midCol = col + dc, landRow = row + 2 * dr, landCol = col + 2 * dc;
    if (!inside(landRow, landCol)) continue;
    const mid = midRow * 8 + midCol;
    const land = landRow * 8 + landCol;
    if (pieceOwner(board[mid]) === 1 - owner && board[land] === '.') moves.push({ from: square, to: land, captured: mid });
  }
  return moves;
}

function stepsFrom(board: string, square: number): CheckersMove[] {
  const piece = board[square];
  const row = Math.floor(square / 8);
  const col = square % 8;
  const moves: CheckersMove[] = [];
  for (const [dr, dc] of directions(piece)) {
    if (!inside(row + dr, col + dc)) continue;
    const to = (row + dr) * 8 + col + dc;
    if (board[to] === '.') moves.push({ from: square, to, captured: -1 });
  }
  return moves;
}

export function checkersMoves(state: CheckersState): CheckersMove[] {
  if (state.forfeit) return [];
  if (state.forcedFrom >= 0) return jumpsFrom(state.board, state.forcedFrom);
  const jumps: CheckersMove[] = [];
  const steps: CheckersMove[] = [];
  for (let square = 0; square < 64; square++) {
    if (pieceOwner(state.board[square]) !== state.turn) continue;
    jumps.push(...jumpsFrom(state.board, square));
    if (!jumps.length) steps.push(...stepsFrom(state.board, square));
  }
  return jumps.length ? jumps : steps;
}

function outcome(state: CheckersState): Outcome | null {
  if (state.forfeit) return state.forfeit;
  if (!checkersMoves(state).length) {
    const hasPieces = [...state.board].some(piece => pieceOwner(piece) === state.turn);
    return { winners: [1 - state.turn], draw: false, reason: hasPieces ? 'No legal moves left' : 'All pieces captured' };
  }
  if (state.quiet >= DRAW_PLIES) return { winners: [], draw: true, reason: '40 moves without a capture — draw' };
  return null;
}

function applyMove(state: CheckersState, move: CheckersMove): CheckersState {
  const cells = [...state.board];
  let piece = cells[move.from];
  cells[move.from] = '.';
  if (move.captured >= 0) cells[move.captured] = '.';
  const toRow = Math.floor(move.to / 8);
  const crowned = (piece === 'r' && toRow === 0) || (piece === 'b' && toRow === 7);
  if (crowned) piece = piece.toUpperCase();
  cells[move.to] = piece;
  const board = cells.join('');
  const keepsJumping = move.captured >= 0 && !crowned && jumpsFrom(board, move.to).length > 0;
  return {
    board,
    turn: keepsJumping ? state.turn : 1 - state.turn,
    forcedFrom: keepsJumping ? move.to : -1,
    quiet: move.captured >= 0 || crowned ? 0 : state.quiet + 1,
    lastMove: { from: move.from, to: move.to, captured: move.captured },
    forfeit: null
  };
}

function evaluate(state: CheckersState, seat: number): number {
  let score = 0;
  for (let square = 0; square < 64; square++) {
    const piece = state.board[square];
    const owner = pieceOwner(piece);
    if (owner < 0) continue;
    const row = Math.floor(square / 8);
    const advance = owner === 0 ? (7 - row) * 0.04 : row * 0.04;
    const value = (isKing(piece) ? 1.6 : 1 + advance);
    score += owner === seat ? value : -value;
  }
  return score;
}

function search(state: CheckersState, depth: number, seat: number, alpha: number, beta: number): number {
  const result = outcome(state);
  if (result) return result.draw ? 0 : result.winners.includes(seat) ? 100 + depth : -100 - depth;
  if (depth === 0) return evaluate(state, seat);
  const maximizing = state.turn === seat;
  let best = maximizing ? -Infinity : Infinity;
  for (const move of checkersMoves(state)) {
    const value = search(applyMove(state, move), depth - 1, seat, alpha, beta);
    if (maximizing) { best = Math.max(best, value); alpha = Math.max(alpha, value); }
    else { best = Math.min(best, value); beta = Math.min(beta, value); }
    if (beta <= alpha) break;
  }
  return best;
}

export const checkers: Engine<CheckersState, CheckersAction> = {
  id: 'checkers',
  minPlayers: 2,
  maxPlayers: 2,
  turnSeconds: 60,
  init() {
    let board = '';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const dark = (row + col) % 2 === 1;
        board += dark && row <= 2 ? 'b' : dark && row >= 5 ? 'r' : '.';
      }
    }
    return { board, turn: 0, forcedFrom: -1, quiet: 0, lastMove: null, forfeit: null };
  },
  current: state => (outcome(state) ? -1 : state.turn),
  outcome,
  apply(state, action, seat) {
    if (outcome(state)) throw new Error('The game is over.');
    if (seat !== state.turn) throw new Error("It's not your turn.");
    const legal = checkersMoves(state);
    const move = legal.find(item => item.from === action.from && item.to === action.to);
    if (!move) {
      if (legal.some(item => item.captured >= 0)) throw new Error(state.forcedFrom >= 0 ? 'Keep jumping with the same piece.' : 'You must capture when you can.');
      throw new Error('Illegal move.');
    }
    return applyMove(state, move);
  },
  removePlayer(state, seat) {
    const forfeit = twoPlayerForfeit(seat);
    return { state: { ...state, forfeit }, outcome: forfeit };
  },
  bot(state, seat, rng) {
    const legal = checkersMoves(state);
    let best = legal[randomInt(rng, legal.length)];
    let bestScore = -Infinity;
    for (const move of legal) {
      const score = search(applyMove(state, move), 4, seat, -Infinity, Infinity) + rng() * 0.3;
      if (score > bestScore) { bestScore = score; best = move; }
    }
    return { type: 'move', from: best.from, to: best.to };
  }
};
