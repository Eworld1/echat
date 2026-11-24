import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Square } from 'chess.js';
import { chessGame, legalChessMoves, type ChessAction, type ChessState } from '../chess';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const PROMOTIONS: ChessAction['promotion'][] = ['q', 'r', 'b', 'n'];

const Piece: React.FC<{ type: string; color: 'w' | 'b'; unit: number }> = ({ type, color, unit }) => (
  <span className="pointer-events-none select-none leading-none" style={{
    fontSize: `${10.2 * unit}px`,
    color: color === 'w' ? '#FFFFFF' : '#1F2328',
    WebkitTextStroke: `${(color === 'w' ? 0.35 : 0.25) * unit}px ${color === 'w' ? '#2B2B2B' : '#000'}`,
    textShadow: `0 ${0.5 * unit}px ${0.8 * unit}px rgba(0,0,0,0.35)`,
    fontFamily: '"Segoe UI Symbol","DejaVu Sans","Noto Sans Symbols 2","Apple Symbols",serif'
  }}>{GLYPH[type]}{'︎'}</span>
);

/** Chess board: tap a piece, then a highlighted square. Board is flipped for Black. */
export const ChessBoard: React.FC<{ state: ChessState; mySeat: number; canAct: boolean; onAction: (action: ChessAction) => void }> = ({ state, mySeat, canAct, onAction }) => {
  const game = chessGame(state);
  const board = game.board();
  const [selected, setSelected] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  // Board width in px (works on older iOS / Safari without CSS container units).
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
  const unit = width / 100;
  const flipped = mySeat === 1;
  const myColor = mySeat === 1 ? 'b' : 'w';
  const targets = useMemo(() => (selected ? legalChessMoves(state, selected) : []), [selected, state]);
  const last = state.moves[state.moves.length - 1];
  const checkSquare = useMemo(() => {
    if (!game.inCheck()) return '';
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && piece.type === 'k' && piece.color === game.turn()) return `${FILES[c]}${8 - r}`;
    }
    return '';
  }, [game, board]);

  const tap = (square: string) => {
    if (!canAct) return;
    const target = targets.find(move => move.to === square);
    if (selected && target) {
      if (target.promotion) { setPromotion({ from: selected, to: square }); return; }
      onAction({ type: 'move', from: selected, to: square });
      setSelected(null);
      return;
    }
    const piece = game.get(square as Square);
    setSelected(piece && piece.color === myColor && game.turn() === myColor ? square : null);
  };

  const rows = flipped ? [...Array(8).keys()].reverse() : [...Array(8).keys()];
  const cols = flipped ? [...Array(8).keys()].reverse() : [...Array(8).keys()];

  return (
    <div className="relative mx-auto w-full max-w-[520px]">
      <div ref={boardRef} className="aspect-square w-full overflow-hidden rounded-xl border-[6px] border-[#3B2F23] shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
        <div className="grid h-full w-full grid-cols-8 grid-rows-8">
          {rows.flatMap(r => cols.map(c => {
            const square = `${FILES[c]}${8 - r}`;
            const piece = board[r][c];
            const light = (r + c) % 2 === 0;
            const isTarget = targets.find(move => move.to === square);
            const isLast = last && (last.slice(0, 2) === square || last.slice(2, 4) === square);
            return (
              <button key={square} type="button" onClick={() => tap(square)} aria-label={`${square}${piece ? ` ${piece.color === 'w' ? 'white' : 'black'} ${piece.type}` : ''}`}
                className="relative grid place-items-center"
                style={{ background: square === selected ? '#F6F669' : isLast ? (light ? '#F5F682' : '#B9CA43') : light ? '#EEEED2' : '#769656' }}>
                {checkSquare === square && <span className="absolute inset-0" style={{ background: 'radial-gradient(circle, rgba(255,0,0,0.85) 0%, rgba(255,0,0,0.35) 45%, transparent 70%)' }} />}
                {piece && <Piece type={piece.type} color={piece.color} unit={unit} />}
                {isTarget && (piece
                  ? <span className="pointer-events-none absolute inset-[4%] rounded-full border-black/25" style={{ borderWidth: 0.9 * unit }} />
                  : <span className="pointer-events-none absolute h-[30%] w-[30%] rounded-full bg-black/25" />)}
                {c === (flipped ? 7 : 0) && <span className="pointer-events-none absolute left-[4%] top-[2%] font-bold" style={{ fontSize: Math.max(9, 2.4 * unit), color: light ? '#769656' : '#EEEED2' }}>{8 - r}</span>}
                {r === (flipped ? 0 : 7) && <span className="pointer-events-none absolute bottom-[1%] right-[5%] font-bold" style={{ fontSize: Math.max(9, 2.4 * unit), color: light ? '#769656' : '#EEEED2' }}>{FILES[c]}</span>}
              </button>
            );
          }))}
        </div>
      </div>
      {promotion && (
        <div className="absolute inset-0 z-10 grid place-items-center rounded-xl bg-black/50" role="dialog" aria-label="Choose promotion piece">
          <div className="rounded-2xl bg-white p-3 shadow-xl">
            <p className="mb-2 text-center text-sm font-extrabold text-slate-900">Promote pawn to</p>
            <div className="flex w-[min(70vw,280px)] gap-2">
              {PROMOTIONS.map(type => (
                <button key={type} type="button" onClick={() => { onAction({ type: 'move', from: promotion.from, to: promotion.to, promotion: type }); setPromotion(null); setSelected(null); }}
                  className="grid aspect-square flex-1 place-items-center rounded-xl bg-[#EEEED2] hover:bg-[#F6F669]" aria-label={`Promote to ${type}`}>
                  <Piece type={type || 'q'} color={myColor} unit={5} />
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setPromotion(null)} className="mt-2 w-full text-xs font-bold text-slate-500">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
};
