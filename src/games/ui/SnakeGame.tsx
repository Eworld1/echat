import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Pause, Play, RotateCcw, Trophy } from 'lucide-react';

const GRID = 20;
type Point = { x: number; y: number };
type Dir = 'up' | 'down' | 'left' | 'right';
const DELTA: Record<Dir, Point> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

function randomFood(snake: Point[]): Point {
  for (;;) {
    const point = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
    if (!snake.some(part => part.x === point.x && part.y === point.y)) return point;
  }
}

const startSnake = (): Point[] => [{ x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }];

/** Classic Snake on a canvas. Keyboard (arrows / WASD), swipe on the board, or the on-screen pad. */
export const SnakeGame: React.FC<{ highScore: number; onGameOver: (score: number) => void }> = ({ highScore, onGameOver }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const snake = useRef<Point[]>(startSnake());
  const food = useRef<Point>(randomFood(snake.current));
  const dir = useRef<Dir>('right');
  const queued = useRef<Dir[]>([]);
  const [score, setScore] = useState(0);
  const [status, setStatus] = useState<'ready' | 'playing' | 'paused' | 'over' | 'won'>('ready');
  const touchStart = useRef<Point | null>(null);

  const draw = useCallback(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const size = element.width;
    const cellSize = size / GRID;
    context.fillStyle = '#0B3D2E';
    context.fillRect(0, 0, size, size);
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      if ((x + y) % 2 === 0) { context.fillStyle = '#0E4636'; context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize); }
    }
    // food
    const f = food.current;
    context.fillStyle = '#EF4444';
    context.beginPath();
    context.arc((f.x + 0.5) * cellSize, (f.y + 0.55) * cellSize, cellSize * 0.38, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#22C55E';
    context.fillRect((f.x + 0.48) * cellSize, (f.y + 0.08) * cellSize, cellSize * 0.1, cellSize * 0.2);
    // snake
    snake.current.forEach((part, index) => {
      const shade = Math.max(0.55, 1 - index / (snake.current.length * 1.6));
      context.fillStyle = index === 0 ? '#A3E635' : `rgba(74, 222, 128, ${shade})`;
      const pad = index === 0 ? 1 : 2;
      const radius = cellSize * 0.3;
      const x = part.x * cellSize + pad, y = part.y * cellSize + pad, w = cellSize - pad * 2;
      context.beginPath();
      if (typeof context.roundRect === 'function') context.roundRect(x, y, w, w, radius); else context.rect(x, y, w, w); // older Safari
      context.fill();
      if (index === 0) {
        const d = DELTA[dir.current];
        context.fillStyle = '#052e16';
        const eye = (ox: number, oy: number) => { context.beginPath(); context.arc(x + w / 2 + ox, y + w / 2 + oy, cellSize * 0.09, 0, Math.PI * 2); context.fill(); };
        if (d.x !== 0) { eye(d.x * w * 0.15, -w * 0.18); eye(d.x * w * 0.15, w * 0.18); }
        else { eye(-w * 0.18, d.y * w * 0.15); eye(w * 0.18, d.y * w * 0.15); }
      }
    });
  }, []);

  const reset = useCallback(() => {
    snake.current = startSnake();
    food.current = randomFood(snake.current);
    dir.current = 'right';
    queued.current = [];
    setScore(0);
    draw();
  }, [draw]);

  const turn = useCallback((next: Dir) => {
    const last = queued.current[queued.current.length - 1] || dir.current;
    if (next === last || next === OPPOSITE[last] || queued.current.length > 2) return;
    queued.current.push(next);
    setStatus(current => (current === 'ready' ? 'playing' : current));
  }, []);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    if (status !== 'playing') return;
    const speed = Math.max(65, 140 - Math.floor(score / 5) * 6);
    const id = window.setInterval(() => {
      if (queued.current.length) dir.current = queued.current.shift()!;
      const head = snake.current[0];
      const d = DELTA[dir.current];
      const next = { x: head.x + d.x, y: head.y + d.y };
      const ate = next.x === food.current.x && next.y === food.current.y;
      const body = ate ? snake.current : snake.current.slice(0, -1);
      if (next.x < 0 || next.y < 0 || next.x >= GRID || next.y >= GRID || body.some(part => part.x === next.x && part.y === next.y)) {
        setStatus('over');
        onGameOver(score);
        return;
      }
      snake.current = [next, ...body];
      if (ate && snake.current.length >= GRID * GRID) {
        // The snake fills the whole board: nothing left to eat — you win.
        draw();
        setScore(value => value + 1);
        setStatus('won');
        onGameOver(score + 1);
        return;
      }
      if (ate) { food.current = randomFood(snake.current); setScore(value => value + 1); }
      draw();
    }, speed);
    return () => window.clearInterval(id);
  }, [status, score, draw, onGameOver]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const map: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
      const next = map[event.key];
      if (next) { event.preventDefault(); if (status === 'over' || status === 'won') return; turn(next); }
      if (event.key === ' ') { event.preventDefault(); setStatus(current => (current === 'playing' ? 'paused' : current === 'paused' ? 'playing' : current)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, turn]);

  const best = Math.max(highScore, status === 'over' || status === 'won' ? score : 0);
  const pad = (label: string, icon: React.ReactNode, next: Dir) => (
    <button type="button" aria-label={label} onClick={() => status !== 'over' && status !== 'won' && turn(next)} className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-slate-800 shadow-[0_4px_0_#CBD5E1] active:translate-y-0.5 active:shadow-none">{icon}</button>
  );

  return (
    <div className="mx-auto w-full max-w-[480px] space-y-3">
      <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-2.5 shadow-sm">
        <p className="text-sm font-bold text-slate-700">Score <span className="ml-1 text-xl font-black text-emerald-600">{score}</span></p>
        <p className="flex items-center gap-1 text-sm font-bold text-slate-700"><Trophy size={16} className="text-amber-500" />Best <span className="ml-1 text-xl font-black text-amber-600">{best}</span></p>
        <button type="button" onClick={() => setStatus(current => (current === 'playing' ? 'paused' : current === 'paused' ? 'playing' : current))} disabled={status === 'ready' || status === 'over' || status === 'won'}
          aria-label={status === 'playing' ? 'Pause' : 'Resume'} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 disabled:opacity-40">
          {status === 'playing' ? <Pause size={18} /> : <Play size={18} />}
        </button>
      </div>
      <div className="relative">
        <canvas ref={canvas} width={480} height={480} className="aspect-square w-full touch-none rounded-2xl shadow-[0_18px_40px_rgba(0,0,0,0.3)]"
          onTouchStart={event => { const touch = event.touches[0]; touchStart.current = { x: touch.clientX, y: touch.clientY }; }}
          onTouchEnd={event => {
            const start = touchStart.current; const touch = event.changedTouches[0];
            if (!start || status === 'over' || status === 'won') return;
            const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
            if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
            turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
          }} />
        {status !== 'playing' && (
          <div className="absolute inset-0 grid place-items-center rounded-2xl bg-black/45 text-center text-white">
            <div>
              {status === 'won' ? (
                <>
                  <p className="text-3xl font-black">You Win! 🏆</p>
                  <p className="mt-1 text-sm">You filled the whole board — {score} points!</p>
                  <button type="button" onClick={() => { reset(); setStatus('ready'); }} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-bold"><RotateCcw size={16} />Play again</button>
                </>
              ) : status === 'over' ? (
                <>
                  <p className="text-3xl font-black">Game Over</p>
                  <p className="mt-1 text-sm">You scored {score}{score > 0 && score >= highScore ? ' — new high score! 🏆' : ''}</p>
                  <button type="button" onClick={() => { reset(); setStatus('ready'); }} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-bold"><RotateCcw size={16} />Play again</button>
                </>
              ) : status === 'paused' ? (
                <button type="button" onClick={() => setStatus('playing')} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-bold"><Play size={16} />Resume</button>
              ) : (
                <>
                  <p className="text-2xl font-black">🐍 Snake</p>
                  <p className="mt-1 px-6 text-sm text-white/85">Swipe, use the arrows below, or your keyboard</p>
                  <button type="button" onClick={() => setStatus('playing')} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-bold"><Play size={16} />Start</button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="mx-auto grid w-48 grid-cols-3 place-items-center gap-2">
        <span />{pad('Up', <ChevronUp size={26} />, 'up')}<span />
        {pad('Left', <ChevronLeft size={26} />, 'left')}{pad('Down', <ChevronDown size={26} />, 'down')}{pad('Right', <ChevronRight size={26} />, 'right')}
      </div>
    </div>
  );
};
