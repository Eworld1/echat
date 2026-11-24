import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, RotateCcw } from 'lucide-react';
import type { BotLevel, GameId } from '../engine';
import { ENGINES } from '../registry';
import { GameBoard, seatDecor, statusLine, winnerLine } from './GameTable';
import { PlayerStrip, ResultBanner, type SeatInfo } from './common';
import { playSound } from '../../utils/gameSounds';

const BOT_NAMES = ['Computer', 'Bot Ama', 'Bot Sorie', 'Bot Fatu'];

/** Play against the computer on this device (nothing is saved online). */
export const LocalGame: React.FC<{ game: GameId; me: { name: string; avatar: string }; bots: number; level: BotLevel; startSeat: number }> = ({ game, me, bots, level, startSeat }) => {
  const engine = ENGINES[game];
  const players = Math.min(engine.maxPlayers, Math.max(engine.minPlayers, bots + 1));
  const [humanSeat, setHumanSeat] = useState(() => Math.min(Math.max(0, startSeat), players - 1));
  const [state, setState] = useState<unknown>(() => engine.init(players));
  const [error, setError] = useState('');
  const stateRef = useRef(state);
  stateRef.current = state;
  const current = engine.current(state);
  const result = useMemo(() => engine.outcome(state), [engine, state]);

  const names = useMemo(() => Array.from({ length: players }, (_, seat) => (seat === humanSeat ? me.name : BOT_NAMES[(seat - (seat > humanSeat ? 1 : 0)) % BOT_NAMES.length] || 'Computer')), [players, humanSeat, me.name]);
  const seats: SeatInfo[] = names.map((name, seat) => ({ name, avatar: seat === humanSeat ? me.avatar : '', isBot: seat !== humanSeat, isMe: seat === humanSeat, ...seatDecor(game, state, seat) }));

  const act = useCallback((action: unknown) => {
    try {
      const next = engine.apply(stateRef.current, action, humanSeat);
      stateRef.current = next;
      setState(next);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Illegal move');
      playSound('buzz');
    }
  }, [engine, humanSeat]);

  // Computer moves (Ludo dice + token moves get a little pause so you can follow).
  useEffect(() => {
    if (result || current < 0 || current === humanSeat) return;
    const delay = game === 'ludo' ? 650 : game === 'chess' ? 550 : 450;
    const id = window.setTimeout(() => {
      const previous = stateRef.current;
      const seat = engine.current(previous);
      if (seat < 0 || seat === humanSeat) return;
      try {
        const next = engine.apply(previous, engine.bot(previous, seat, Math.random, level), seat);
        stateRef.current = next;
        setState(next);
      } catch (err) {
        console.error('[EChat games] computer move failed', err);
      }
    }, delay);
    return () => window.clearTimeout(id);
  }, [state, current, humanSeat, result, engine, game, level]);

  useEffect(() => {
    if (!result) return;
    playSound(result.draw ? 'draw' : result.winners.includes(humanSeat) ? 'win' : 'lose');
  }, [result, humanSeat]);

  const restart = (switchSides = false) => {
    if (switchSides && players === 2) setHumanSeat(seat => 1 - seat);
    const fresh = engine.init(players);
    stateRef.current = fresh;
    setState(fresh);
    setError('');
  };

  const won = result && result.winners.includes(humanSeat);
  return (
    <div className="space-y-3">
      <PlayerStrip seats={seats} turn={current} winners={result?.winners} />
      {!result && <p className="text-center text-sm font-bold text-slate-700">{statusLine(game, state, current, names, humanSeat)}</p>}
      {result && (
        <ResultBanner title={result.draw ? "It's a draw" : won ? 'You Win! 🎉' : 'You Lose'} subtitle={[winnerLine(game, state, result.winners, names), result.reason].filter(Boolean).join(' — ')} tone={result.draw ? 'draw' : won ? 'win' : 'lose'}>
          <button type="button" onClick={() => restart()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-slate-900"><RotateCcw size={16} />Play again</button>
          {players === 2 && <button type="button" onClick={() => restart(true)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white/20 px-4 text-sm font-bold text-white"><ArrowLeftRight size={16} />Switch sides</button>}
        </ResultBanner>
      )}
      <GameBoard game={game} state={state} mySeat={humanSeat} canAct={!result && current === humanSeat} onAction={act} names={names} />
      {error && <p role="alert" className="text-center text-sm font-semibold text-rose-600">{error}</p>}
      {!result && <button type="button" onClick={() => restart()} className="mx-auto flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700"><RotateCcw size={15} />Restart</button>}
    </div>
  );
};
