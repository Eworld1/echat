import React from 'react';
import { tttWinningLine, type TttAction, type TttState } from '../tictactoe';

const CELL_CENTER = (cell: number) => [((cell % 3) * 2 + 1) * (100 / 6), (Math.floor(cell / 3) * 2 + 1) * (100 / 6)];

export const TicTacToeBoard: React.FC<{ state: TttState; canAct: boolean; onAction: (action: TttAction) => void }> = ({ state, canAct, onAction }) => {
  const line = tttWinningLine(state.board);
  const [x1, y1] = line ? CELL_CENTER(line[0]) : [0, 0];
  const [x2, y2] = line ? CELL_CENTER(line[2]) : [0, 0];
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[420px] rounded-[28px] bg-gradient-to-br from-[#1877F2] to-[#7C3AED] p-3 shadow-[0_18px_40px_rgba(24,119,242,0.35)]">
      <div className="grid h-full w-full grid-cols-3 grid-rows-3 gap-2.5">
        {[...state.board].map((mark, cell) => {
          const playable = canAct && mark === '-';
          const winning = line?.includes(cell);
          return (
            <button key={cell} type="button" disabled={!playable} onClick={() => onAction({ type: 'place', cell })}
              aria-label={`Square ${cell + 1}${mark === '-' ? '' : `, ${mark}`}`}
              className={`grid place-items-center rounded-2xl transition ${winning ? 'bg-amber-50' : 'bg-white/95'} ${playable ? 'hover:bg-white hover:shadow-inner active:scale-95' : ''} shadow-[inset_0_-4px_0_rgba(0,0,0,0.06)]`}>
              {mark === 'X' && (
                <svg viewBox="0 0 100 100" className="h-[62%] w-[62%]" aria-hidden="true">
                  <path d="M22 22 L78 78 M78 22 L22 78" stroke="#1877F2" strokeWidth="15" strokeLinecap="round" fill="none" style={{ strokeDasharray: 160, strokeDashoffset: 0, animation: 'echatDraw .3s ease-out' }} />
                </svg>
              )}
              {mark === 'O' && (
                <svg viewBox="0 0 100 100" className="h-[62%] w-[62%]" aria-hidden="true">
                  <circle cx="50" cy="50" r="31" stroke="#F43F5E" strokeWidth="14" fill="none" style={{ strokeDasharray: 195, strokeDashoffset: 0, animation: 'echatDraw .3s ease-out' }} />
                </svg>
              )}
            </button>
          );
        })}
      </div>
      {line && (
        <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-3 h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)]" aria-hidden="true">
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#F59E0B" strokeWidth="4" strokeLinecap="round" opacity="0.9" />
        </svg>
      )}
      <style>{'@keyframes echatDraw { from { stroke-dashoffset: 200; } to { stroke-dashoffset: 0; } }'}</style>
    </div>
  );
};
