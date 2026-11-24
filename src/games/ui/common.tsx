import React, { useEffect, useRef, useState } from 'react';
import { Bot, Crown, WifiOff } from 'lucide-react';

export interface SeatInfo {
  name: string;
  avatar: string;
  /** Accent colour for the seat (piece / token colour). */
  color: string;
  label?: string;
  isBot?: boolean;
  isMe?: boolean;
  left?: boolean;
  online?: boolean;
  isHost?: boolean;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || '?';

export const Avatar: React.FC<{ name: string; src: string; size?: number; ring?: string; dim?: boolean }> = ({ name, src, size = 44, ring, dim }) => {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-slate-200 to-slate-300 font-extrabold text-slate-700 ${dim ? 'opacity-40 grayscale' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.38, boxShadow: ring ? `0 0 0 3px ${ring}` : undefined }}>
      {src && !broken ? <img src={src} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} /> : initials(name)}
    </span>
  );
};

/** Seconds left until `deadline`, ticking every 250 ms. */
export function useCountdown(deadline: number, running: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);
  return running ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
}

/** Top bar like Facebook Games: every player's avatar + name, the current turn glows with a timer ring. */
export const PlayerStrip: React.FC<{ seats: SeatInfo[]; turn: number; secondsLeft?: number; totalSeconds?: number; winners?: number[] }> = ({ seats, turn, secondsLeft, totalSeconds, winners = [] }) => (
  <div className={`grid gap-2 ${seats.length <= 2 ? 'grid-cols-2' : seats.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
    {seats.map((seat, index) => {
      const active = index === turn && !seat.left;
      const fraction = active && totalSeconds && secondsLeft !== undefined ? secondsLeft / totalSeconds : 0;
      const urgent = active && secondsLeft !== undefined && secondsLeft <= 5;
      return (
        <div key={index} className={`relative flex min-w-0 flex-col items-center gap-1 rounded-2xl border px-1.5 py-2 text-center transition ${active ? 'border-transparent bg-white shadow-[0_6px_20px_rgba(24,119,242,0.25)]' : 'border-slate-200 bg-white/70'}`}>
          <div className="relative">
            <Avatar name={seat.name} src={seat.avatar} size={seats.length > 2 ? 40 : 48} ring={seat.color} dim={seat.left} />
            {active && totalSeconds ? (
              <svg className="pointer-events-none absolute -inset-[7px] h-[calc(100%+14px)] w-[calc(100%+14px)] -rotate-90" viewBox="0 0 40 40" aria-hidden="true">
                <circle cx="20" cy="20" r="18" fill="none" stroke="#E5E7EB" strokeWidth="2.5" />
                <circle cx="20" cy="20" r="18" fill="none" stroke={urgent ? '#EF4444' : '#1877F2'} strokeWidth="2.5" strokeLinecap="round"
                  strokeDasharray={`${Math.max(0, fraction) * 113.1} 113.1`} style={{ transition: 'stroke-dasharray 0.25s linear' }} />
              </svg>
            ) : null}
            {winners.includes(index) && <Crown size={18} className="absolute -top-3 left-1/2 -translate-x-1/2 fill-amber-400 text-amber-500" />}
            {seat.isBot && <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-slate-800 text-white"><Bot size={12} /></span>}
            {!seat.isBot && seat.online !== undefined && !seat.left && (
              <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${seat.online ? 'bg-emerald-500' : 'bg-slate-400'}`} title={seat.online ? 'Online' : 'Offline'} />
            )}
          </div>
          <p className="w-full truncate text-xs font-bold text-slate-900">{seat.isMe ? 'You' : seat.name}</p>
          <p className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: seat.left ? '#94A3B8' : seat.color }}>
            {seat.left ? <><WifiOff size={10} />Left</> : active && secondsLeft !== undefined && totalSeconds ? <span className={urgent ? 'text-rose-600' : 'text-[#1877F2]'}>{secondsLeft}s</span> : seat.label}
          </p>
        </div>
      );
    })}
  </div>
);

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 25], [72, 25], [28, 50], [72, 50], [28, 75], [72, 75]]
};

const DICE_CSS = '@keyframes echatDiceRoll { 0% { transform: rotate(0) scale(1); } 25% { transform: rotate(-25deg) scale(1.12) translateY(-6px); } 50% { transform: rotate(20deg) scale(0.95); } 75% { transform: rotate(-10deg) scale(1.05) translateY(-3px); } 100% { transform: rotate(0) scale(1); } } @keyframes echatPulse { 0%,100% { opacity: .35; } 50% { opacity: 1; } }';
let diceCss = false;
export function injectGameCss() {
  if (diceCss || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = DICE_CSS;
  document.head.appendChild(style);
  diceCss = true;
}

/** Ludo dice with a tumble animation whenever `rollId` changes. */
export const Dice: React.FC<{ value: number; rollId: number; color: string; canRoll: boolean; onRoll: () => void; size?: number }> = ({ value, rollId, color, canRoll, onRoll, size = 76 }) => {
  const [face, setFace] = useState(value || 1);
  const [rolling, setRolling] = useState(false);
  const lastRoll = useRef(rollId);
  useEffect(() => { injectGameCss(); }, []);
  useEffect(() => {
    if (rollId === lastRoll.current) { if (value) setFace(value); return; }
    lastRoll.current = rollId;
    setRolling(true);
    let ticks = 0;
    const id = window.setInterval(() => {
      ticks++;
      setFace(1 + Math.floor(Math.random() * 6));
      if (ticks >= 7) { window.clearInterval(id); setFace(value || 1); setRolling(false); }
    }, 80);
    return () => window.clearInterval(id);
  }, [rollId, value]);
  return (
    <button type="button" onClick={onRoll} disabled={!canRoll} aria-label={canRoll ? 'Roll the dice' : `Dice shows ${face}`}
      className={`relative grid place-items-center rounded-[22%] transition ${canRoll ? 'cursor-pointer hover:scale-105 active:scale-95' : 'cursor-default'}`}
      style={{ width: size, height: size, background: 'linear-gradient(145deg,#ffffff,#e9edf3)', boxShadow: canRoll ? `0 0 0 4px ${color}, 0 10px 24px rgba(0,0,0,.25)` : '0 6px 16px rgba(0,0,0,.18), inset 0 -3px 0 rgba(0,0,0,.08)', animation: rolling ? 'echatDiceRoll .56s ease-in-out' : undefined }}>
      <svg viewBox="0 0 100 100" className="h-[78%] w-[78%]" aria-hidden="true">
        {PIPS[face].map(([x, y], index) => <circle key={index} cx={x} cy={y} r="9.5" fill={face === 1 ? '#E53935' : '#1F2937'} />)}
      </svg>
      {canRoll && <span className="absolute -bottom-6 whitespace-nowrap text-[11px] font-extrabold uppercase tracking-wider" style={{ color, animation: 'echatPulse 1.2s ease-in-out infinite' }}>Tap to roll</span>}
    </button>
  );
};

export const ResultBanner: React.FC<{ title: string; subtitle: string; tone: 'win' | 'lose' | 'draw'; children?: React.ReactNode }> = ({ title, subtitle, tone, children }) => (
  <div className={`rounded-2xl p-4 text-center text-white shadow-lg ${tone === 'win' ? 'bg-gradient-to-br from-emerald-500 to-emerald-700' : tone === 'lose' ? 'bg-gradient-to-br from-slate-600 to-slate-800' : 'bg-gradient-to-br from-amber-500 to-orange-600'}`}>
    <p className="text-2xl font-black">{title}</p>
    <p className="mt-0.5 text-sm text-white/85">{subtitle}</p>
    {children && <div className="mt-3 flex flex-wrap justify-center gap-2">{children}</div>}
  </div>
);
