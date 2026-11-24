import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crown, Loader2, LogOut, Play, RotateCcw, UserPlus, Users } from 'lucide-react';
import { gameMeta } from '../engine';
import {
  claimTimeout,
  ENGINES,
  gameErrorMessage,
  heartbeat,
  joinRoom,
  leaveRoom,
  listenRoom,
  listenRoomMessages,
  playMove,
  recordResult,
  startGame,
  TIMEOUT_GRACE_MS,
  voteRematch,
  type GameRoom,
  type Me,
  type RoomMessage
} from '../rooms';
import { GameBoard, seatDecor, statusLine } from './GameTable';
import { colorsForPlayers } from '../ludo';
import { Avatar, PlayerStrip, ResultBanner, useCountdown, type SeatInfo } from './common';
import { FloatingReactions, InviteSheet, RoomChat, ShareRoom } from './RoomExtras';
import { playSound } from '../../utils/gameSounds';

const ONLINE_MS = 60_000;

export const OnlineRoom: React.FC<{ roomId: string; me: Me; friendIds: string[]; onExit: () => void }> = ({ roomId, me, friendIds, onExit }) => {
  const [room, setRoom] = useState<GameRoom | null | undefined>(undefined);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now());
  const openedAt = useRef(Date.now());
  const sending = useRef(false);
  const recordedRound = useRef('');
  const lastPlayerCount = useRef(0);
  const lastTurnKey = useRef('');

  useEffect(() => listenRoom(roomId, setRoom, err => setError(gameErrorMessage(err))), [roomId]);
  useEffect(() => listenRoomMessages(roomId, setMessages), [roomId]);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 5000); return () => window.clearInterval(id); }, []);

  const mySeat = room ? room.playerIds.indexOf(me.uid) : -1;
  const isMember = mySeat >= 0;
  const engine = room ? ENGINES[room.game] : null;
  const meta = room ? gameMeta(room.game) : undefined;
  const current = room && engine && room.status === 'playing' ? engine.current(room.state) : -1;
  const secondsLeft = useCountdown(room?.turnDeadline || 0, Boolean(room && room.status === 'playing'));

  // Presence heartbeat while the room is open.
  useEffect(() => {
    if (!room || !isMember || room.status === 'finished') return;
    void heartbeat(roomId, me.uid).catch(() => {});
    const id = window.setInterval(() => { void heartbeat(roomId, me.uid).catch(() => {}); }, 25_000);
    return () => window.clearInterval(id);
  }, [roomId, me.uid, isMember, room?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Opponent joined" notice + sound.
  useEffect(() => {
    if (!room) return;
    if (lastPlayerCount.current && room.playerIds.length > lastPlayerCount.current && room.status === 'waiting') {
      const joined = room.players[room.players.length - 1];
      setNotice(`${joined?.name || 'A player'} joined!`);
      playSound('ding');
      window.setTimeout(() => setNotice(''), 3000);
    }
    lastPlayerCount.current = room.playerIds.length;
  }, [room]);

  // Sound when it becomes my turn.
  useEffect(() => {
    if (!room || room.status !== 'playing') return;
    const key = `${room.round}:${current}:${room.version}`;
    if (current === mySeat && lastTurnKey.current && !lastTurnKey.current.startsWith(`${room.round}:${mySeat}:`)) playSound('tick');
    lastTurnKey.current = key;
  }, [room, current, mySeat]);

  // Turn timer ran out → auto-roll (Ludo) / loss on time. Others step in after a short grace period.
  useEffect(() => {
    if (!room || room.status !== 'playing' || !isMember || current < 0) return;
    const mine = current === mySeat;
    const due = room.turnDeadline + (mine ? 0 : TIMEOUT_GRACE_MS + mySeat * 1500);
    let attempts = 0;
    let cancelled = false;
    let timer = 0;
    // Clocks differ between phones, so a claim can be "not due yet" — retry a few times.
    const attempt = () => {
      attempts++;
      void claimTimeout(roomId, me).then(applied => {
        if (!applied && !cancelled && attempts < 6) timer = window.setTimeout(attempt, 2000);
      }).catch(err => console.warn('[EChat games] timeout claim failed', err));
    };
    timer = window.setTimeout(attempt, Math.max(0, due - Date.now()) + 50);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [room, current, mySeat, isMember, roomId, me]);

  // Record my win / loss / draw once per finished round.
  useEffect(() => {
    if (!room || room.status !== 'finished' || !isMember || room.statsRecorded.includes(me.uid)) return;
    const key = `${room.id}:${room.round}`;
    if (recordedRound.current === key) return;
    recordedRound.current = key;
    const won = room.winnerIds.includes(me.uid);
    playSound(room.draw ? 'draw' : won ? 'win' : 'lose');
    if (won) void import('canvas-confetti').then(module => module.default({ particleCount: 140, spread: 75, origin: { y: 0.6 } })).catch(() => {});
    void recordResult(room, me).catch(err => console.warn('[EChat games] could not record result', err));
  }, [room, isMember, me]);

  const act = useCallback(async (action: unknown) => {
    if (sending.current) return;
    sending.current = true;
    setError('');
    try { await playMove(roomId, me, action); }
    catch (err) { setError(gameErrorMessage(err)); playSound('buzz'); }
    finally { sending.current = false; }
  }, [roomId, me]);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await task(); } catch (err) { setError(gameErrorMessage(err)); } finally { setBusy(false); }
  };

  const seats: SeatInfo[] = useMemo(() => (room ? room.players.map((player, seat) => ({
    name: player.name,
    avatar: player.avatar,
    isMe: player.uid === me.uid,
    left: player.left,
    isHost: player.uid === room.hostId,
    online: player.uid === me.uid || now - (room.presence[player.uid] || 0) < ONLINE_MS,
    ...seatDecor(room.game, room.state, seat)
  })) : []), [room, me.uid, now]);

  if (room === undefined) return <div className="grid place-items-center rounded-2xl bg-white p-10 text-sm text-slate-500"><Loader2 className="mb-2 animate-spin" />Loading room…</div>;
  if (room === null) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
        <p className="text-lg font-extrabold text-slate-900">Room not found</p>
        <p className="mt-1 text-sm text-slate-600">It may have been closed. Check the code and try again.</p>
        <button type="button" onClick={onExit} className="mt-4 min-h-11 rounded-xl bg-[#1877F2] px-5 text-sm font-bold text-white">Back to Games</button>
      </div>
    );
  }

  const names = room.players.map(player => player.name);
  const gameName = meta?.name || 'Game';
  const isHost = room.hostId === me.uid;
  const present = room.players.filter(player => !player.left);
  const minPlayers = engine?.minPlayers || 2;

  // ---------------- lobby ----------------
  if (room.status === 'waiting') {
    const slots = Array.from({ length: room.maxPlayers }, (_, index) => room.players[index]);
    return (
      <div className="space-y-3">
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{gameName} room</p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <p className="font-mono text-4xl font-black tracking-[0.2em] text-[#1877F2]">{room.id}</p>
            <p className="flex items-center gap-1 text-sm font-bold text-slate-600"><Users size={16} />{room.players.length}/{room.maxPlayers}</p>
          </div>
          <p className="mt-1 text-sm text-slate-600">{room.players.length < minPlayers ? 'Waiting for opponent…' : room.players.length < room.maxPlayers ? `${room.players.length} players here — the host can start now or wait for more.` : 'Room full — ready to start!'}</p>
          {notice && <p className="mt-2 rounded-xl bg-emerald-50 p-2 text-center text-sm font-bold text-emerald-700">{notice}</p>}
        </section>

        <section className="grid grid-cols-2 gap-2">
          {slots.map((player, index) => {
            const decor = seatDecor(room.game, room.game === 'ludo' ? { colors: colorsForPlayers(Math.max(2, room.players.length)) } : null, index);
            return (
              <div key={index} className={`flex items-center gap-3 rounded-2xl border p-3 ${player ? 'border-slate-200 bg-white' : 'border-dashed border-slate-300 bg-white/60'}`}>
                {player ? <Avatar name={player.name} src={player.avatar} size={44} ring={decor.color} /> : <span className="grid h-11 w-11 place-items-center rounded-full bg-slate-100"><Loader2 size={18} className="animate-spin text-slate-400" /></span>}
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">{player ? (player.uid === me.uid ? 'You' : player.name) : 'Waiting…'}</p>
                  <p className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: decor.color }}>{decor.label}{player?.uid === room.hostId && <><Crown size={11} className="text-amber-500" /><span className="text-amber-600">Host</span></>}</p>
                </div>
              </div>
            );
          })}
        </section>

        {isMember && (
          <section className="space-y-2 rounded-2xl bg-white p-3 shadow-sm">
            <button type="button" onClick={() => setInviteOpen(true)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#E7F0FD] text-sm font-bold text-[#1877F2]"><UserPlus size={17} />Invite EChat friends</button>
            <ShareRoom room={room} gameName={gameName} />
          </section>
        )}

        {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

        {isMember ? (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => void run(async () => { await leaveRoom(roomId, me); onExit(); })} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700"><LogOut size={16} />Leave</button>
            {isHost ? (
              <button type="button" disabled={busy || room.players.length < minPlayers} onClick={() => void run(() => startGame(roomId, me))} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#1877F2] text-sm font-bold text-white disabled:opacity-50"><Play size={16} />Start game</button>
            ) : <p className="grid min-h-12 place-items-center rounded-xl bg-slate-100 px-2 text-center text-xs font-bold text-slate-600">Waiting for host to start…</p>}
          </div>
        ) : (
          <button type="button" disabled={busy || room.players.length >= room.maxPlayers} onClick={() => void run(() => joinRoom(roomId, me))} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1877F2] text-sm font-bold text-white disabled:opacity-50">
            {room.players.length >= room.maxPlayers ? 'Room is full' : `Join ${gameName}`}
          </button>
        )}

        {isMember && <RoomChat room={room} me={me} messages={messages} canSend={isMember} />}
        {inviteOpen && <InviteSheet room={room} me={me} friendIds={friendIds} gameName={gameName} onClose={() => setInviteOpen(false)} />}
      </div>
    );
  }

  // ---------------- game / result ----------------
  const finished = room.status === 'finished';
  const iWon = room.winnerIds.includes(me.uid);
  const winnerSeats = room.winnerIds.map(uid => room.playerIds.indexOf(uid)).filter(seat => seat >= 0);
  const myLeft = mySeat >= 0 && room.players[mySeat]?.left;
  const canAct = !finished && isMember && !myLeft && current === mySeat;
  const votedRematch = room.rematchVotes.includes(me.uid);
  const rematchAsked = room.rematchVotes.filter(uid => uid !== me.uid).map(uid => room.players.find(player => player.uid === uid)?.name).filter(Boolean);
  const canRematch = present.length >= minPlayers && present.some(player => player.uid === me.uid);

  return (
    <div className="space-y-3">
      <PlayerStrip seats={seats} turn={current} secondsLeft={secondsLeft} totalSeconds={engine?.turnSeconds} winners={finished ? winnerSeats : []} />

      {!finished && (
        <p className={`rounded-xl py-2 text-center text-sm font-extrabold ${canAct ? 'bg-[#1877F2] text-white' : 'bg-white text-slate-700'}`}>
          {statusLine(room.game, room.state, current, names, mySeat)}{secondsLeft <= 10 && current >= 0 ? ` · ${secondsLeft}s` : ''}
        </p>
      )}

      {finished && (
        <ResultBanner
          title={room.draw ? "It's a draw" : iWon ? 'You win! 🎉' : isMember ? 'You lose' : `${room.winnerIds.map(uid => room.players.find(player => player.uid === uid)?.name).join(', ')} wins`}
          subtitle={room.endReason}
          tone={room.draw ? 'draw' : iWon ? 'win' : 'lose'}>
          {isMember && canRematch && (
            <button type="button" disabled={busy || votedRematch} onClick={() => void run(() => voteRematch(roomId, me))} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-slate-900 disabled:opacity-70">
              <RotateCcw size={16} />{votedRematch ? 'Waiting for others…' : rematchAsked.length ? 'Accept rematch' : 'Rematch'}
            </button>
          )}
          {isMember && !canRematch && <span className="text-xs text-white/85">Not enough players left for a rematch.</span>}
        </ResultBanner>
      )}
      {finished && rematchAsked.length > 0 && !votedRematch && <p className="rounded-xl bg-amber-50 p-2 text-center text-sm font-bold text-amber-800">{rematchAsked.join(', ')} want{rematchAsked.length === 1 ? 's' : ''} a rematch!</p>}

      <div className="relative">
        <GameBoard game={room.game} state={room.state} mySeat={mySeat} canAct={canAct} onAction={action => void act(action)} names={names} />
        <FloatingReactions messages={messages} since={openedAt.current} />
      </div>

      {error && <p role="alert" className="rounded-xl bg-rose-50 p-2 text-center text-sm text-rose-700">{error}</p>}

      {isMember && <RoomChat room={room} me={me} messages={messages} canSend={isMember} />}

      <div className="flex justify-center">
        {isMember && !finished && !myLeft ? (
          confirmLeave ? (
            <div className="flex items-center gap-2 rounded-xl bg-rose-50 p-2">
              <span className="text-sm font-semibold text-rose-800">{room.game === 'ludo' && present.length > 2 ? 'Leave the game?' : 'Leave and lose by forfeit?'}</span>
              <button type="button" disabled={busy} onClick={() => void run(async () => { await leaveRoom(roomId, me); onExit(); })} className="min-h-9 rounded-lg bg-rose-600 px-3 text-sm font-bold text-white">Leave</button>
              <button type="button" onClick={() => setConfirmLeave(false)} className="min-h-9 rounded-lg bg-white px-3 text-sm font-bold text-slate-700">Stay</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmLeave(true)} className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700"><LogOut size={15} />{room.game === 'chess' || room.game === 'checkers' ? 'Resign / Leave' : 'Leave game'}</button>
          )
        ) : (
          <button type="button" disabled={busy} onClick={() => void run(async () => { if (isMember && finished) await leaveRoom(roomId, me); onExit(); })} className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700"><LogOut size={15} />Leave room</button>
        )}
      </div>
    </div>
  );
};
