import React, { useEffect } from 'react';
import type { GameId } from '../engine';
import type { TttState } from '../tictactoe';
import type { ChessState } from '../chess';
import { chessGame } from '../chess';
import type { CheckersState } from '../checkers';
import { LUDO_COLORS, LUDO_HEX, type LudoState } from '../ludo';
import { TicTacToeBoard } from './TicTacToeBoard';
import { ChessBoard } from './ChessBoard';
import { CheckersBoard } from './CheckersBoard';
import { LudoBoard } from './LudoBoard';
import { Dice } from './common';

/** Piece colour + label for a seat. */
export function seatDecor(game: GameId, state: unknown, seat: number): { color: string; label: string } {
  if (game === 'tictactoe') return seat === 0 ? { color: '#1877F2', label: 'X' } : { color: '#F43F5E', label: 'O' };
  if (game === 'chess') return seat === 0 ? { color: '#94A3B8', label: 'White' } : { color: '#111827', label: 'Black' };
  if (game === 'checkers') return seat === 0 ? { color: '#E0322A', label: 'Red' } : { color: '#1F2937', label: 'Black' };
  const color = (state as LudoState | null)?.colors?.[seat] ?? [0, 2, 1, 3][seat] ?? 0;
  return { color: LUDO_HEX[color], label: LUDO_COLORS[color] };
}

/** One-line status for the current position. */
export function statusLine(game: GameId, state: unknown, current: number, names: string[], mySeat: number): string {
  if (current < 0) return '';
  const who = current === mySeat ? 'Your turn' : `${names[current] || 'Opponent'}'s turn`;
  if (game === 'chess' && chessGame(state as ChessState).inCheck()) return `${who} — Check!`;
  if (game === 'ludo') {
    const ludo = state as LudoState;
    if (ludo.phase === 'move') return current === mySeat ? `You rolled ${ludo.dice} — tap a glowing token` : `${names[current]} is moving…`;
    return current === mySeat ? 'Your turn — roll the dice' : `${names[current] || 'Player'} is rolling…`;
  }
  return who;
}

interface GameBoardProps {
  game: GameId;
  state: unknown;
  mySeat: number;
  canAct: boolean;
  onAction: (action: unknown) => void;
  names: string[];
}

export const GameBoard: React.FC<GameBoardProps> = ({ game, state, mySeat, canAct, onAction, names }) => {
  const ludoState = game === 'ludo' ? (state as LudoState) : null;

  // Ludo convenience: only one sensible choice → move it automatically.
  useEffect(() => {
    if (!ludoState || !canAct || ludoState.phase !== 'move' || ludoState.turn !== mySeat) return;
    const tokens = ludoState.movable;
    const allInYard = tokens.every(token => ludoState.pos[mySeat * 4 + token] === -1);
    if (tokens.length !== 1 && !allInYard) return;
    const id = window.setTimeout(() => onAction({ type: 'move', token: tokens[0] }), 700);
    return () => window.clearTimeout(id);
  }, [ludoState, canAct, mySeat, onAction]);

  if (game === 'tictactoe') return <TicTacToeBoard state={state as TttState} canAct={canAct} onAction={onAction} />;
  if (game === 'chess') return <ChessBoard state={state as ChessState} mySeat={mySeat} canAct={canAct} onAction={onAction} />;
  if (game === 'checkers') return <CheckersBoard state={state as CheckersState} mySeat={mySeat} canAct={canAct} onAction={onAction} />;
  const ludo = ludoState!;
  const turnColor = LUDO_HEX[ludo.colors[ludo.turn] ?? 0];
  const canRoll = canAct && ludo.phase === 'roll' && ludo.turn === mySeat && ludo.winner < 0;
  const diceColor = LUDO_HEX[ludo.colors[ludo.rolledBy >= 0 ? ludo.rolledBy : ludo.turn] ?? 0];
  return (
    <div className="space-y-3">
      <LudoBoard state={ludo} mySeat={mySeat} canAct={canAct} onAction={onAction} names={names} />
      <div className="flex items-center justify-center gap-5 rounded-2xl bg-white p-3 pb-7 shadow-sm">
        <Dice value={ludo.dice} rollId={ludo.rollId} color={canRoll ? turnColor : diceColor} canRoll={canRoll} onRoll={() => onAction({ type: 'roll', value: 1 + Math.floor(Math.random() * 6) })} />
        <div className="min-w-0 max-w-[55%] text-sm">
          <p className="font-extrabold" style={{ color: turnColor }}>{names[ludo.turn] || LUDO_COLORS[ludo.colors[ludo.turn]]}</p>
          <p className="text-xs text-slate-600">{ludo.log || (ludo.phase === 'roll' ? 'Waiting for roll' : 'Choose a token')}</p>
        </div>
      </div>
    </div>
  );
};
