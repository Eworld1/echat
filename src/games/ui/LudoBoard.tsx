import React, { useEffect, useRef, useState } from 'react';
import { HOME, HOME_COLUMN, LUDO_HEX, LUDO_SAFE, LUDO_START, TRACK, YARD_ORIGIN, tokenPoint, type LudoAction, type LudoState } from '../ludo';
import { injectGameCss } from './common';

const LIGHT = ['#FFCDD2', '#C8E6C9', '#FFF3B0', '#BBDEFB'];
const DARK = ['#B71C1C', '#1B5E20', '#B7950B', '#0D47A1'];

/** Animates tokens one square per step toward their new progress (captured tokens jump home after). */
function useAnimatedPositions(target: number[]): number[] {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  useEffect(() => {
    const step = () => {
      const current = shownRef.current;
      if (current.length !== target.length) { shownRef.current = target; setShown(target); return false; }
      let moving = false;
      const next = current.map((value, index) => {
        const goal = target[index];
        if (value === goal) return value;
        if (goal > value && value >= 0) { moving = true; return value + 1; }
        if (value === -1 && goal >= 0) { moving = true; return 0; }
        return value; // captured: handled after movers finish
      });
      if (!moving) {
        const settled = next.map((value, index) => (value !== target[index] ? target[index] : value));
        const changed = settled.some((value, index) => value !== next[index]);
        shownRef.current = settled;
        setShown(settled);
        return changed;
      }
      shownRef.current = next;
      setShown(next);
      return true;
    };
    if (step() === false) return;
    const id = window.setInterval(() => { if (!step()) window.clearInterval(id); }, 150);
    return () => window.clearInterval(id);
  }, [target]);
  return shown;
}

const Star: React.FC<{ x: number; y: number; color: string }> = ({ x, y, color }) => (
  <path transform={`translate(${x + 0.5} ${y + 0.5}) scale(0.32)`} d="M0,-1 L0.29,-0.4 L0.95,-0.31 L0.47,0.15 L0.59,0.81 L0,0.5 L-0.59,0.81 L-0.47,0.15 L-0.95,-0.31 L-0.29,-0.4 Z" fill={color} />
);

interface LudoBoardProps {
  state: LudoState;
  /** Seat of the viewer (-1 = spectator / computer). Only their tokens are tappable. */
  mySeat: number;
  canAct: boolean;
  onAction: (action: LudoAction) => void;
  names: string[];
}

export const LudoBoard: React.FC<LudoBoardProps> = ({ state, mySeat, canAct, onAction, names }) => {
  const shown = useAnimatedPositions(state.pos);
  useEffect(() => { injectGameCss(); }, []);
  const colorSeat = new Map(state.colors.map((color, seat) => [color, seat]));
  const selectable = canAct && state.phase === 'move' && state.turn === mySeat;

  // Group tokens per cell so stacked tokens fan out.
  const tokens = state.colors.flatMap((color, seat) => [0, 1, 2, 3].map(token => {
    const progress = shown[seat * 4 + token] ?? -1;
    const [y, x] = tokenPoint(color, token, progress);
    return { seat, color, token, progress, x, y, key: `${x.toFixed(2)}:${y.toFixed(2)}` };
  })).filter(item => state.active[item.seat] || item.progress >= 0);
  const groups = new Map<string, number>();
  tokens.forEach(item => groups.set(item.key, (groups.get(item.key) || 0) + 1));
  const groupIndex = new Map<string, number>();

  const cell = (r: number, c: number, fill: string, key: string) => <rect key={key} x={c} y={r} width="1" height="1" fill={fill} stroke="#CBD5E1" strokeWidth="0.03" />;

  return (
    <div className="mx-auto w-full max-w-[560px]">
      <svg viewBox="-0.2 -0.2 15.4 15.4" className="aspect-square w-full rounded-2xl bg-white shadow-[0_18px_40px_rgba(0,0,0,0.25)]" role="img" aria-label="Ludo board">
        <rect x="-0.2" y="-0.2" width="15.4" height="15.4" rx="0.5" fill="#FFFFFF" />
        {/* yards */}
        {YARD_ORIGIN.map(([r, c], color) => {
          const seat = colorSeat.get(color);
          const inGame = seat !== undefined;
          return (
            <g key={`yard${color}`}>
              <rect x={c} y={r} width="6" height="6" rx="0.35" fill={inGame ? LUDO_HEX[color] : '#CBD5E1'} />
              <rect x={c + 0.8} y={r + 0.8} width="4.4" height="4.4" rx="0.5" fill="#FFFFFF" />
              {[[1.5, 1.5], [1.5, 3.5], [3.5, 1.5], [3.5, 3.5]].map(([dr, dc], index) => (
                <circle key={index} cx={c + dc + 0.5} cy={r + dr + 0.5} r="0.62" fill={inGame ? LIGHT[color] : '#E2E8F0'} stroke={inGame ? LUDO_HEX[color] : '#CBD5E1'} strokeWidth="0.12" />
              ))}
              {inGame && (
                <text x={c + 3} y={color < 2 ? r + 0.55 : r + 5.72} textAnchor="middle" fontSize="0.42" fontWeight="800" fill="#FFFFFF" style={{ paintOrder: 'stroke' }} stroke={DARK[color]} strokeWidth="0.06">
                  {(names[seat!] || '').slice(0, 14)}
                </text>
              )}
            </g>
          );
        })}
        {/* track */}
        {TRACK.map(([r, c], index) => {
          const startColor = LUDO_START.indexOf(index);
          return (
            <g key={`t${index}`}>
              {cell(r, c, startColor >= 0 ? LUDO_HEX[startColor] : '#FFFFFF', `c${index}`)}
              {LUDO_SAFE.has(index) && <Star x={c} y={r} color={startColor >= 0 ? '#FFFFFF' : '#94A3B8'} />}
            </g>
          );
        })}
        {/* home columns */}
        {HOME_COLUMN.map((squares, color) => squares.map(([r, c], index) => cell(r, c, LUDO_HEX[color], `h${color}${index}`)))}
        {/* entry arrows on the last track square before each home column */}
        {/* centre */}
        <polygon points="6,6 7.5,7.5 6,9" fill={LUDO_HEX[0]} />
        <polygon points="6,6 7.5,7.5 9,6" fill={LUDO_HEX[1]} />
        <polygon points="9,6 7.5,7.5 9,9" fill={LUDO_HEX[2]} />
        <polygon points="6,9 7.5,7.5 9,9" fill={LUDO_HEX[3]} />
        <rect x="6" y="6" width="3" height="3" fill="none" stroke="#CBD5E1" strokeWidth="0.03" />

        {/* tokens */}
        {tokens.map(item => {
          const count = groups.get(item.key) || 1;
          const nth = groupIndex.get(item.key) || 0;
          groupIndex.set(item.key, nth + 1);
          const spread = count > 2 ? 0.2 : count > 1 ? 0.2 : 0;
          const angle = (nth / count) * Math.PI * 2;
          const x = item.x + Math.cos(angle) * spread;
          const y = item.y + Math.sin(angle) * spread;
          const scale = count > 2 ? 0.6 : count > 1 ? 0.72 : 1;
          const canTap = selectable && item.seat === mySeat && state.movable.includes(item.token) && item.progress === state.pos[item.seat * 4 + item.token];
          const last = state.lastMove && state.lastMove.seat === item.seat && state.lastMove.token === item.token;
          return (
            <g key={`k${item.seat}${item.token}`}
              onClick={canTap ? () => onAction({ type: 'move', token: item.token }) : undefined}
              style={{ cursor: canTap ? 'pointer' : 'default', transform: `translate(${x}px, ${y}px) scale(${scale})`, transition: 'transform 0.14s linear' }}
              role={canTap ? 'button' : undefined} aria-label={canTap ? `Move ${['first', 'second', 'third', 'fourth'][item.token]} token` : undefined}>
              {canTap && <circle r="0.62" fill="none" stroke="#111827" strokeWidth="0.09" strokeDasharray="0.25 0.15" style={{ animation: 'echatPulse 0.9s ease-in-out infinite' }} />}
              <ellipse cx="0" cy="0.3" rx="0.36" ry="0.13" fill="rgba(0,0,0,0.25)" />
              <circle r="0.42" fill={DARK[item.color]} />
              <circle r="0.36" fill={LUDO_HEX[item.color]} />
              <circle r="0.2" fill="#FFFFFF" opacity="0.85" />
              <circle r="0.12" fill={LUDO_HEX[item.color]} />
              {last && item.progress !== HOME && <circle r="0.5" fill="none" stroke="#FFFFFF" strokeWidth="0.06" opacity="0.9" />}
              {canTap && <circle r="0.75" fill="transparent" />}
            </g>
          );
        })}
      </svg>
    </div>
  );
};
