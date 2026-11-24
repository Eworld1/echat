import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Crown } from 'lucide-react';
import { checkersMoves, pieceOwner, type CheckersAction, type CheckersState } from '../checkers';

const PIECE_STYLE: Record<number, { base: string; edge: string; crown: string }> = {
  0: { base: 'radial-gradient(circle at 35% 30%, #FF7A6E 0%, #E0322A 45%, #9E1B15 100%)', edge: '#6E110D', crown: '#FFE08A' },
  1: { base: 'radial-gradient(circle at 35% 30%, #6B7280 0%, #2A2F36 50%, #0D0F12 100%)', edge: '#000000', crown: '#FFD54F' }
};

/** Checkers board: tap a piece then a highlighted square. Pieces that must capture are outlined. */
export const CheckersBoard: React.FC<{ state: CheckersState; mySeat: number; canAct: boolean; onAction: (action: CheckersAction) => void }> = ({ state, mySeat, canAct, onAction }) => {
  const [selected, setSelected] = useState<number | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  useEffect(() => {
    const element = boardRef.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth || 360);
    measure();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const u = width / 100; // 1% of the board in px (no CSS container units, for older Safari)
  const flipped = mySeat === 1;
  const legal = useMemo(() => (canAct ? checkersMoves(state) : []), [state, canAct]);
  const movableFrom = useMemo(() => new Set(legal.map(move => move.from)), [legal]);
  const mustCapture = legal.some(move => move.captured >= 0);
  const active = state.forcedFrom >= 0 ? state.forcedFrom : selected;
  const targets = legal.filter(move => move.from === active);

  const tap = (square: number) => {
    if (!canAct) return;
    const move = targets.find(item => item.to === square);
    if (move) { onAction({ type: 'move', from: move.from, to: move.to }); setSelected(null); return; }
    setSelected(movableFrom.has(square) ? square : null);
  };

  const order = [...Array(64).keys()];
  if (flipped) order.reverse();

  return (
    <div className="mx-auto w-full max-w-[520px]">
      <div ref={boardRef} className="aspect-square w-full overflow-hidden rounded-xl border-[8px] border-[#4A2C17] shadow-[0_18px_40px_rgba(0,0,0,0.35)]"
        style={{ background: '#4A2C17' }}>
        <div className="grid h-full w-full grid-cols-8 grid-rows-8">
          {order.map(square => {
            const row = Math.floor(square / 8);
            const col = square % 8;
            const dark = (row + col) % 2 === 1;
            const piece = state.board[square];
            const owner = pieceOwner(piece);
            const isTarget = targets.some(move => move.to === square);
            const isLast = state.lastMove && (state.lastMove.from === square || state.lastMove.to === square);
            const style = PIECE_STYLE[owner];
            return (
              <button key={square} type="button" onClick={() => tap(square)} disabled={!dark}
                aria-label={`Row ${row + 1} column ${col + 1}${owner >= 0 ? `, ${owner === 0 ? 'red' : 'black'}${piece === piece.toUpperCase() ? ' king' : ''}` : ''}`}
                className="relative grid place-items-center"
                style={{ background: dark ? (isLast ? '#9C6B3A' : '#7A4A25') : '#F1DDB5' }}>
                {owner >= 0 && (
                  <span className="relative grid place-items-center rounded-full transition-transform"
                    style={{
                      width: '78%', height: '78%', background: style.base,
                      boxShadow: `0 ${0.8 * u}px 0 ${style.edge}, 0 ${1.4 * u}px ${1.6 * u}px rgba(0,0,0,.45), inset 0 0 0 ${0.6 * u}px rgba(255,255,255,.18)`,
                      outline: active === square ? `${0.7 * u}px solid #FDE047` : canAct && mustCapture && movableFrom.has(square) ? `${0.6 * u}px dashed #FDE047` : 'none',
                      outlineOffset: 0.4 * u,
                      transform: active === square ? `translateY(${-0.6 * u}px) scale(1.04)` : undefined
                    }}>
                    <span className="absolute inset-[18%] rounded-full border-white/25" style={{ borderWidth: 0.45 * u }} />
                    {piece === piece.toUpperCase() && <Crown className="relative" style={{ width: '48%', height: '48%', color: style.crown, fill: style.crown }} />}
                  </span>
                )}
                {isTarget && <span className="pointer-events-none absolute h-[32%] w-[32%] rounded-full bg-[#FDE047]/80 shadow" />}
              </button>
            );
          })}
        </div>
      </div>
      {canAct && mustCapture && <p className="mt-2 text-center text-xs font-bold text-amber-700">{state.forcedFrom >= 0 ? 'Keep jumping with the same piece!' : 'You must capture — jump an opponent piece.'}</p>}
    </div>
  );
};
