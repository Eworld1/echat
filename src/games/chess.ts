import { Chess, type Move, type Square } from 'chess.js';
import { randomInt, twoPlayerForfeit, type Engine, type Outcome } from './engine';

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
  /** Easy computer: greedy one-ply with a safety check and some randomness. */
  bot(state, _seat, rng) {
    const game = chessGame(state);
    const moves = game.moves({ verbose: true });
    let best = moves[randomInt(rng, moves.length)];
    let bestScore = -Infinity;
    for (const move of moves) {
      let score = (move.captured ? PIECE_VALUE[move.captured] * 10 : 0) + (move.promotion ? 80 : 0) + rng() * 6;
      const after = new Chess(game.fen());
      after.move(move.san);
      if (after.isCheckmate()) score += 1000;
      else if (after.inCheck()) score += 2;
      // Penalise leaving the moved piece where it can be taken for free.
      const replies = after.moves({ verbose: true });
      const attacked = replies.some(reply => reply.to === move.to);
      if (attacked) score -= PIECE_VALUE[move.promotion || move.piece] * 7;
      if (after.isStalemate() || after.isDraw()) score -= 20;
      if (score > bestScore) { bestScore = score; best = move; }
    }
    return { type: 'move', from: best.from, to: best.to, promotion: (best.promotion as ChessAction['promotion']) || undefined };
  }
};
