import { Chess, type Move, type Square } from 'chess.js';
import { randomInt, twoPlayerForfeit, type BotLevel, type Engine, type Outcome } from './engine';

/**
 * Chess with full rules via chess.js (legal moves only, check, checkmate, stalemate, castling,
 * en passant, promotion, threefold repetition, 50-move rule, insufficient material).
 * Seat 0 = White, seat 1 = Black. State keeps the move list (UCI) so the game can be replayed
 * exactly, which repetition detection needs.
 */
export interface ChessState { moves: string[]; fen: string; forfeit?: Outcome | null }
export interface ChessAction { type: 'move'; from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' }

const replayCache = new Map<string, Chess>();

/** Rebuilds the game from its move list (memoised for the latest few positions). */
export function chessGame(state: ChessState): Chess {
  const key = state.moves.join(' ');
  const cached = replayCache.get(key);
  if (cached) return cached;
  const game = new Chess();
  for (const uci of state.moves) game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
  if (replayCache.size > 20) replayCache.clear();
  replayCache.set(key, game);
  return game;
}

function outcome(state: ChessState): Outcome | null {
  if (state.forfeit) return state.forfeit;
  const game = chessGame(state);
  if (game.isCheckmate()) return { winners: [game.turn() === 'w' ? 1 : 0], draw: false, reason: 'Checkmate' };
  if (game.isStalemate()) return { winners: [], draw: true, reason: 'Stalemate — draw' };
  if (game.isInsufficientMaterial()) return { winners: [], draw: true, reason: 'Insufficient material — draw' };
  if (game.isThreefoldRepetition()) return { winners: [], draw: true, reason: 'Threefold repetition — draw' };
  if (game.isDrawByFiftyMoves()) return { winners: [], draw: true, reason: '50-move rule — draw' };
  return null;
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3.2, r: 5, q: 9, k: 0 };

export function legalChessMoves(state: ChessState, from?: string): Move[] {
  const game = chessGame(state);
  return from ? game.moves({ square: from as Square, verbose: true }) : game.moves({ verbose: true });
}

export const chess: Engine<ChessState, ChessAction> = {
  id: 'chess',
  minPlayers: 2,
  maxPlayers: 2,
  turnSeconds: 120,
  init: () => ({ moves: [], fen: new Chess().fen(), forfeit: null }),
  current: state => (outcome(state) ? -1 : chessGame(state).turn() === 'w' ? 0 : 1),
  outcome,
  apply(state, action, seat) {
    if (outcome(state)) throw new Error('The game is over.');
    const game = chessGame(state);
    if ((game.turn() === 'w' ? 0 : 1) !== seat) throw new Error("It's not your turn.");
    const move = game.moves({ verbose: true }).find(item => item.from === action.from && item.to === action.to && (!item.promotion || item.promotion === (action.promotion || 'q')));
    if (!move) throw new Error('Illegal move.');
    const next = new Chess(game.fen());
    next.move(move.san);
    return { moves: [...state.moves, `${move.from}${move.to}${move.promotion || ''}`], fen: next.fen(), forfeit: null };
  },
  removePlayer(state, seat) {
    const forfeit = twoPlayerForfeit(seat);
    return { state: { ...state, forfeit }, outcome: forfeit };
  },
  bot(state, seat, rng, level: BotLevel = 'medium') {
    const game = chessGame(state);
    const moves = game.moves({ verbose: true });
    if (level === 'easy' && rng() < 0.4) {
      const pick = moves[randomInt(rng, moves.length)];
      return { type: 'move', from: pick.from, to: pick.to, promotion: (pick.promotion as ChessAction['promotion']) || undefined };
    }
    if (level === 'hard') {
      const best = searchBest(game.fen(), seat === 0 ? 'w' : 'b', rng);
      return { type: 'move', from: best.from, to: best.to, promotion: (best.promotion as ChessAction['promotion']) || undefined };
    }
    // Easy / Medium: greedy one-move look-ahead with a safety check and some randomness.
    const noise = level === 'easy' ? 14 : 6;
    let best = moves[randomInt(rng, moves.length)];
    let bestScore = -Infinity;
    for (const move of moves) {
      let score = (move.captured ? PIECE_VALUE[move.captured] * 10 : 0) + (move.promotion ? 80 : 0) + rng() * noise;
      const after = new Chess(game.fen());
      after.move(move.san);
      if (after.isCheckmate()) score += 1000;
      else if (after.inCheck()) score += 2;
      // Penalise leaving the moved piece where it can be taken.
      const attacked = after.moves({ verbose: true }).some(reply => reply.to === move.to);
      if (attacked) score -= PIECE_VALUE[move.promotion || move.piece] * 7;
      if (after.isStalemate() || after.isDraw()) score -= 20;
      if (score > bestScore) { bestScore = score; best = move; }
    }
    return { type: 'move', from: best.from, to: best.to, promotion: (best.promotion as ChessAction['promotion']) || undefined };
  }
};

// ---------------- Hard computer: 2-move look-ahead (minimax + alpha-beta) ----------------

const CENTER_BONUS = [0, 0.05, 0.1, 0.15, 0.15, 0.1, 0.05, 0];

/** Material + a little central control + pawn advance, from White's point of view (cheap: no move generation). */
function evaluateBoard(game: Chess): number {
  let score = 0;
  const board = game.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const value = PIECE_VALUE[piece.type] + (piece.type === 'k' ? 0 : CENTER_BONUS[r] + CENTER_BONUS[c]) + (piece.type === 'p' ? (piece.color === 'w' ? (6 - r) : (r - 1)) * 0.05 : 0);
      score += piece.color === 'w' ? value : -value;
    }
  }
  return score;
}

const MATE = 10_000;

function minimax(game: Chess, depth: number, alpha: number, beta: number): number {
  if (depth === 0) return evaluateBoard(game);
  const moves = game.moves({ verbose: true });
  if (!moves.length) return game.inCheck() ? (game.turn() === 'w' ? -MATE - depth : MATE + depth) : 0; // mate / stalemate
  // Captures first = better pruning.
  moves.sort((a, b) => (b.captured ? PIECE_VALUE[b.captured] : 0) - (a.captured ? PIECE_VALUE[a.captured] : 0));
  const white = game.turn() === 'w';
  let best = white ? -Infinity : Infinity;
  for (const move of moves) {
    game.move({ from: move.from, to: move.to, promotion: move.promotion });
    const value = minimax(game, depth - 1, alpha, beta);
    game.undo();
    if (white) { best = Math.max(best, value); alpha = Math.max(alpha, value); }
    else { best = Math.min(best, value); beta = Math.min(beta, value); }
    if (beta <= alpha) break;
  }
  return best;
}

function searchBest(fen: string, color: 'w' | 'b', rng: () => number): Move {
  const game = new Chess(fen);
  const moves = game.moves({ verbose: true });
  // Most promising first (captures, checks, promotions), so a time cap rarely cuts a good move.
  const promise = (move: Move) => (move.captured ? PIECE_VALUE[move.captured] * 10 : 0) + (move.promotion ? 50 : 0) + (move.san.includes('+') ? 3 : 0);
  moves.sort((a, b) => promise(b) - promise(a));
  const started = Date.now();
  let best = moves[0];
  let bestScore = -Infinity;
  for (const move of moves) {
    if (Date.now() - started > 700 && bestScore > -Infinity) break; // keep the phone responsive
    game.move({ from: move.from, to: move.to, promotion: move.promotion });
    const value = minimax(game, 1, -Infinity, Infinity);
    game.undo();
    const score = (color === 'w' ? value : -value) + rng() * 0.05;
    if (score > bestScore) { bestScore = score; best = move; }
  }
  return best;
}
