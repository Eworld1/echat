import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { ArrowLeft, Bot, Gamepad2, Globe2, LogIn, Medal, Play, Trophy, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { auth } from '../services/firebase';
import { usePathname } from '../utils/eventsNav';
import { BOT_LEVELS, GAME_LIST, gameMeta, type BotLevel, type GameId, type GameMeta } from '../games/engine';
import { colorsForPlayers, LUDO_COLORS, LUDO_HEX } from '../games/ludo';
import {
  createRoom,
  gameErrorMessage,
  joinRoom,
  listenInvites,
  listenLeaderboard,
  listenLiveRooms,
  listenMyRooms,
  listenMyStats,
  normalizeCode,
  recordResult,
  ROOM_CODE_LENGTH,
  roomExists,
  saveSnakeScore,
  toMe,
  type GameRoom,
  type GameStats,
  type Me
} from '../games/rooms';
import { OnlineRoom } from '../games/ui/OnlineRoom';
import { LocalGame } from '../games/ui/LocalGame';
import { SnakeGame } from '../games/ui/SnakeGame';
import { Avatar } from '../games/ui/common';

/** In-app navigation inside /games (App.tsx listens for "echat:navigate"). */
export function navigateGames(path: string): void {
  if (window.location.pathname === path) return;
  window.history.pushState({ echatApp: true, tab: 'games' }, '', path);
  window.dispatchEvent(new Event('echat:navigate'));
  window.scrollTo({ top: 0 });
}

function useFirebaseUid(): string {
  const [uid, setUid] = useState(auth.currentUser?.uid || '');
  useEffect(() => onAuthStateChanged(auth, current => setUid(current?.uid || '')), []);
  return uid;
}

const RULES: Record<string, string[]> = {
  ludo: ['Roll a 6 to bring a token out of your yard.', 'Land on an opponent to send it home (not on ★ safe squares).', 'A 6 or a capture gives you another roll.', 'You need the exact number to reach home.', 'First to get all 4 tokens home wins. 30 seconds per move.'],
  chess: ['Standard rules with legal moves only.', 'Castling, en passant and pawn promotion.', 'Checkmate wins; stalemate and repetition are draws.', '2 minutes per move online.'],
  checkers: ['Move diagonally forward on dark squares.', 'Captures are mandatory — keep jumping if you can.', 'Reach the far row to be crowned a king.', 'No pieces or no moves left = loss. 60 seconds per move.'],
  tictactoe: ['Take turns placing X and O.', 'Three in a row wins.', 'A full board with no line is a draw.', '30 seconds per move online.'],
  snake: ['Eat the apples to grow.', "Don't hit the walls or yourself.", 'The snake speeds up as you score.', 'Your best score is saved to your EChat account.']
};

const GameArt: React.FC<{ game: GameMeta; size?: 'lg' | 'md' }> = ({ game, size = 'md' }) => (
  <div className={`relative grid place-items-center overflow-hidden bg-gradient-to-br ${game.gradient} ${size === 'lg' ? 'h-40 sm:h-48' : 'h-28'}`}>
    <span className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, #fff 0 2px, transparent 3px), radial-gradient(circle at 70% 60%, #fff 0 2px, transparent 3px)', backgroundSize: '28px 28px' }} />
    <span className={`relative drop-shadow-[0_6px_10px_rgba(0,0,0,0.35)] ${size === 'lg' ? 'text-7xl' : 'text-5xl'}`} style={{ color: '#fff' }}>{game.emoji}</span>
  </div>
);

function useLiveCounts() {
  const [rooms, setRooms] = useState<GameRoom[]>([]);
  useEffect(() => listenLiveRooms(setRooms), []);
  return useMemo(() => {
    const counts: Record<string, { playing: number; waiting: number }> = {};
    for (const room of rooms) {
      const entry = counts[room.game] || (counts[room.game] = { playing: 0, waiting: 0 });
      if (room.status === 'playing') entry.playing += room.players.filter(player => !player.left).length;
      else entry.waiting += 1;
    }
    return counts;
  }, [rooms]);
}

const Leaderboard: React.FC<{ me: string }> = ({ me }) => {
  const [tab, setTab] = useState<'wins' | 'snakeHigh'>('wins');
  const [rows, setRows] = useState<GameStats[] | null>(null);
  useEffect(() => { setRows(null); return listenLeaderboard(tab, setRows); }, [tab]);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900"><Trophy size={18} className="text-amber-500" />Top players in EChat</h2>
        <div className="flex rounded-full bg-slate-100 p-0.5 text-xs font-bold">
          {(['wins', 'snakeHigh'] as const).map(id => (
            <button key={id} type="button" onClick={() => setTab(id)} aria-pressed={tab === id} className={`min-h-8 rounded-full px-3 ${tab === id ? 'bg-white text-[#1877F2] shadow-sm' : 'text-slate-600'}`}>{id === 'wins' ? 'Wins' : 'Snake'}</button>
          ))}
        </div>
      </div>
      {rows === null ? <p className="py-4 text-center text-sm text-slate-500">Loading…</p>
        : rows.length === 0 ? <p className="py-4 text-center text-sm text-slate-500">No scores yet — be the first!</p>
          : (
            <ol className="space-y-1.5">
              {rows.map((row, index) => (
                <li key={row.uid} className={`flex items-center gap-3 rounded-xl px-2 py-1.5 ${row.uid === me ? 'bg-blue-50' : ''}`}>
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black ${index === 0 ? 'bg-amber-400 text-white' : index === 1 ? 'bg-slate-300 text-slate-800' : index === 2 ? 'bg-orange-300 text-white' : 'bg-slate-100 text-slate-600'}`}>{index + 1}</span>
                  <Avatar name={row.name} src={row.avatar} size={34} />
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">{row.name || 'Player'}</span>
                  <span className="shrink-0 text-right text-xs text-slate-600">
                    {tab === 'wins' ? <><strong className="text-base text-slate-900">{row.wins}</strong> wins<span className="block text-[10px]">{row.losses}L · {row.draws}D</span></> : <><strong className="text-base text-slate-900">{row.snakeHigh}</strong> pts</>}
                  </span>
                </li>
              ))}
            </ol>
          )}
    </section>
  );
};

const JoinByCode: React.FC = () => {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = normalizeCode(code);
    if (value.length !== ROOM_CODE_LENGTH) { setError(`Room codes have ${ROOM_CODE_LENGTH} letters/numbers.`); return; }
    setBusy(true);
    setError('');
    try {
      if (!(await roomExists(value))) { setError('Room not found. Check the code.'); return; }
      navigateGames(`/games/room/${value}`);
    } catch (err) { setError(gameErrorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <label htmlFor="room-code" className="text-sm font-extrabold text-slate-900">Join a friend's game</label>
      <div className="mt-2 flex gap-2">
        <input id="room-code" value={code} onChange={event => setCode(normalizeCode(event.target.value))} placeholder="ROOM CODE" autoComplete="off" autoCapitalize="characters"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 font-mono text-lg font-bold tracking-[0.25em] outline-none focus:border-[#1877F2]" />
        <button type="submit" disabled={busy} className="flex min-h-11 items-center gap-1.5 rounded-xl bg-[#1877F2] px-4 text-sm font-bold text-white disabled:opacity-60"><LogIn size={16} />Join</button>
      </div>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </form>
  );
};

const RoomRow: React.FC<{ room: GameRoom; uid: string; label: string }> = ({ room, uid, label }) => {
  const meta = gameMeta(room.game);
  const host = room.players.find(player => player.uid === room.hostId);
  return (
    <button type="button" onClick={() => navigateGames(`/games/room/${room.id}`)} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-left hover:bg-slate-50">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-2xl text-white ${meta?.gradient}`}>{meta?.emoji}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-slate-900">{meta?.name} · {room.status === 'waiting' ? `${room.players.length}/${room.maxPlayers} players` : room.status === 'playing' ? 'In progress' : room.draw ? 'Draw' : room.winnerIds.includes(uid) ? 'You won' : 'Finished'}</span>
        <span className="block truncate text-xs text-slate-500">{host && host.uid !== uid ? `From ${host.name} · ` : ''}Code {room.id}</span>
      </span>
      <span className="shrink-0 rounded-lg bg-[#1877F2] px-3 py-1.5 text-xs font-bold text-white">{label}</span>
    </button>
  );
};

const GamesHome: React.FC<{ uid: string; me: Me }> = ({ uid, me }) => {
  const counts = useLiveCounts();
  const [invites, setInvites] = useState<GameRoom[]>([]);
  const [mine, setMine] = useState<GameRoom[]>([]);
  const [stats, setStats] = useState<GameStats | null>(null);
  useEffect(() => (uid ? listenInvites(uid, setInvites) : undefined), [uid]);
  useEffect(() => (uid ? listenMyRooms(uid, setMine) : undefined), [uid]);
  useEffect(() => (uid ? listenMyStats(uid, setStats) : undefined), [uid]);
  // Catch up on results from games that ended while this player was away.
  useEffect(() => {
    mine.filter(room => room.status === 'finished' && !room.statsRecorded.includes(uid)).slice(0, 5)
      .forEach(room => { void recordResult(room, me).catch(() => {}); });
  }, [mine, uid, me]);

  const active = mine.filter(room => room.status !== 'finished' && !room.players.find(player => player.uid === uid)?.left);
  const featured = GAME_LIST[0];
  const rest = GAME_LIST.slice(1);
  const countText = (id: string) => {
    const entry = counts[id];
    if (!entry) return '';
    return [entry.playing ? `${entry.playing} playing` : '', entry.waiting ? `${entry.waiting} open room${entry.waiting === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-extrabold text-slate-900"><Gamepad2 className="text-[#1877F2]" />Games</h1>
          <p className="text-sm text-slate-600">Play with friends or the computer</p>
        </div>
        {stats && (
          <div className="text-right text-xs text-slate-600">
            <p><strong className="text-lg text-emerald-600">{stats.wins}</strong> W · <strong className="text-slate-800">{stats.losses}</strong> L · <strong className="text-slate-800">{stats.draws}</strong> D</p>
            <p>{stats.games} online game{stats.games === 1 ? '' : 's'}</p>
          </div>
        )}
      </header>

      {invites.length > 0 && (
        <section className="space-y-2 rounded-2xl border-2 border-[#1877F2] bg-[#E7F0FD] p-3">
          <h2 className="text-sm font-extrabold text-[#1877F2]">🎮 Game invites</h2>
          {invites.map(room => <RoomRow key={room.id} room={room} uid={uid} label="Join" />)}
        </section>
      )}

      {active.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-extrabold text-slate-900">Your games</h2>
          {active.map(room => <RoomRow key={room.id} room={room} uid={uid} label={room.status === 'waiting' ? 'Open' : 'Resume'} />)}
        </section>
      )}

      <button type="button" onClick={() => navigateGames(`/games/${featured.id}`)} className="block w-full overflow-hidden rounded-3xl bg-white text-left shadow-md transition hover:shadow-lg">
        <GameArt game={featured} size="lg" />
        <div className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-lg font-black text-slate-900">{featured.name}<span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold uppercase text-amber-700">Most popular</span></p>
            <p className="text-sm text-slate-600">{featured.tagline}</p>
            <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-600"><Users size={13} />{countText(featured.id) || featured.players}</p>
          </div>
          <span className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-[#1877F2] px-4 text-sm font-bold text-white"><Play size={16} />Play</span>
        </div>
      </button>

      <section className="grid grid-cols-2 gap-3">
        {rest.map(game => (
          <button key={game.id} type="button" onClick={() => navigateGames(`/games/${game.id}`)} className="overflow-hidden rounded-2xl bg-white text-left shadow-sm transition hover:shadow-md">
            <GameArt game={game} />
            <div className="p-3">
              <p className="text-sm font-extrabold text-slate-900">{game.name}</p>
              <p className="line-clamp-1 text-xs text-slate-600">{game.tagline}</p>
              <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-600"><Users size={12} />{countText(game.id) || game.players}</p>
            </div>
          </button>
        ))}
      </section>

      <JoinByCode />
      <Leaderboard me={uid} />
    </div>
  );
};

const GameLobby: React.FC<{ game: GameMeta; me: Me }> = ({ game, me }) => {
  const isLudo = game.id === 'ludo';
  const [seats, setSeats] = useState(isLudo ? 4 : 2);
  const [bots, setBots] = useState(isLudo ? 3 : 1);
  const [level, setLevel] = useState<BotLevel>(() => {
    try { const saved = window.localStorage.getItem('echat_games_level'); return saved === 'easy' || saved === 'hard' ? saved : 'medium'; } catch { return 'medium'; }
  });
  const [seat, setSeat] = useState(0);
  const sides: { label: string; hint?: string; color?: string }[] = isLudo
    ? colorsForPlayers(bots + 1).map((color, index) => ({ label: LUDO_COLORS[color], color: LUDO_HEX[color], hint: index === 0 ? 'goes first' : undefined }))
    : game.id === 'tictactoe' ? [{ label: 'X', hint: 'goes first' }, { label: 'O' }]
      : game.id === 'chess' ? [{ label: 'White', hint: 'goes first' }, { label: 'Black' }]
        : [{ label: 'Red', hint: 'goes first' }, { label: 'Black' }];
  const chooseLevel = (value: BotLevel) => { setLevel(value); try { window.localStorage.setItem('echat_games_level', value); } catch { /* storage blocked */ } };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const id = await createRoom(game.id as GameId, me, seats);
      navigateGames(`/games/room/${id}`);
    } catch (err) { setError(gameErrorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-3xl bg-white shadow-md">
        <GameArt game={game} size="lg" />
        <div className="p-4">
          <h1 className="text-2xl font-black text-slate-900">{game.name}</h1>
          <p className="text-sm text-slate-600">{game.tagline}</p>
          <ul className="mt-3 space-y-1 text-sm text-slate-700">
            {(RULES[game.id] || []).map(rule => <li key={rule} className="flex gap-2"><span className="text-[#1877F2]">•</span>{rule}</li>)}
          </ul>
        </div>
      </div>

      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900"><Globe2 size={18} className="text-[#1877F2]" />Play online with friends</h2>
        {isLudo && (
          <div>
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">Players</p>
            <div className="grid grid-cols-3 gap-2">
              {[2, 3, 4].map(count => (
                <button key={count} type="button" onClick={() => setSeats(count)} aria-pressed={seats === count} className={`min-h-11 rounded-xl border text-sm font-bold ${seats === count ? 'border-[#1877F2] bg-[#E7F0FD] text-[#1877F2]' : 'border-slate-200 text-slate-700'}`}>{count} players</button>
              ))}
            </div>
          </div>
        )}
        <button type="button" disabled={busy} onClick={() => void create()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1877F2] text-sm font-bold text-white disabled:opacity-60"><Users size={17} />{busy ? 'Creating…' : 'Create Game Room'}</button>
        <p className="text-xs text-slate-500">You'll get a room code and can invite friends from your EChat friends list.</p>
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      </section>

      <JoinByCode />

      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900"><Bot size={18} className="text-slate-700" />Play vs Computer</h2>
        {isLudo && (
          <div>
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">Opponents</p>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map(count => (
                <button key={count} type="button" onClick={() => { setBots(count); setSeat(0); }} aria-pressed={bots === count} className={`min-h-11 rounded-xl border text-xs font-bold ${bots === count ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 text-slate-700'}`}>{count} computer{count > 1 ? 's' : ''}</button>
              ))}
            </div>
          </div>
        )}
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">Difficulty</p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Difficulty">
            {BOT_LEVELS.map(item => (
              <button key={item.id} type="button" role="radio" aria-checked={level === item.id} onClick={() => chooseLevel(item.id)}
                className={`min-h-11 rounded-xl border text-sm font-bold ${level === item.id ? (item.id === 'easy' ? 'border-emerald-600 bg-emerald-600 text-white' : item.id === 'medium' ? 'border-amber-500 bg-amber-500 text-white' : 'border-rose-600 bg-rose-600 text-white') : 'border-slate-200 text-slate-700'}`}>{item.label}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">Play as</p>
          <div className={`grid gap-2 ${sides.length > 2 ? 'grid-cols-4' : 'grid-cols-2'}`} role="radiogroup" aria-label="Play as">
            {sides.map((side, index) => (
              <button key={side.label} type="button" role="radio" aria-checked={seat === index} onClick={() => setSeat(index)}
                className={`flex min-h-11 flex-col items-center justify-center rounded-xl border px-1 text-sm font-bold ${seat === index ? 'border-[#1877F2] bg-[#E7F0FD] text-[#1877F2]' : 'border-slate-200 text-slate-700'}`}>
                <span className="flex items-center gap-1.5">{side.color && <span className="h-3 w-3 rounded-full" style={{ background: side.color }} />}{side.label}</span>
                {side.hint && <span className="text-[10px] font-semibold text-slate-500">{side.hint}</span>}
              </button>
            ))}
          </div>
        </div>
        <button type="button" onClick={() => navigateGames(`/games/${game.id}/computer?level=${level}&seat=${Math.min(seat, sides.length - 1)}${isLudo ? `&bots=${bots}` : ''}`)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-800 text-sm font-bold text-white"><Play size={16} />Start</button>
      </section>
    </div>
  );
};

export const Games: React.FC = () => {
  const { user } = useAuth();
  const uid = useFirebaseUid();
  const pathname = usePathname();
  const me = useMemo(() => toMe(uid, user), [uid, user]);
  const [snakeHigh, setSnakeHigh] = useState(() => { try { return Number(window.localStorage.getItem('echat_snake_high') || 0); } catch { return 0; } });
  useEffect(() => (uid ? listenMyStats(uid, stats => setSnakeHigh(current => Math.max(current, stats.snakeHigh))) : undefined), [uid]);

  const onSnakeOver = useCallback((score: number) => {
    setSnakeHigh(current => {
      if (score <= current) return current;
      try { window.localStorage.setItem('echat_snake_high', String(score)); } catch { /* storage blocked */ }
      return score;
    });
    if (uid && score > 0) void saveSnakeScore(me, score).catch(err => console.warn('[EChat games] could not save snake score', err));
  }, [uid, me]);

  // Joining from a shared link: auto-join the room if there's space.
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean); // ['games', ...]
  const roomId = parts[1] === 'room' ? normalizeCode(parts[2] || '') : '';
  useEffect(() => {
    if (!roomId || !uid) return;
    void joinRoom(roomId, me).catch(() => { /* full / started / not found — the room view explains */ });
  }, [roomId, uid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600 shadow-sm">Sign in to play games.</div>;
  if (!uid) return <div className="mx-auto max-w-xl rounded-2xl bg-white p-8 text-center text-sm text-slate-500">Connecting…</div>;

  const gameId = parts[1] && parts[1] !== 'room' ? parts[1] : '';
  const meta = gameId ? gameMeta(gameId) : undefined;
  const computer = parts[2] === 'computer';
  const search = new URLSearchParams(window.location.search);
  const bots = Math.min(3, Math.max(1, Number(search.get('bots') || 1)));
  const levelParam = search.get('level');
  const level: BotLevel = levelParam === 'easy' || levelParam === 'hard' ? levelParam : 'medium';
  const startSeat = Math.max(0, Math.min(3, Number(search.get('seat') || 0) || 0));

  let title = '';
  let body: React.ReactNode;
  let back = '/games';
  if (roomId) {
    title = 'Game room';
    body = <OnlineRoom roomId={roomId} me={me} friendIds={user.friends || []} onExit={() => navigateGames('/games')} />;
  } else if (meta?.id === 'snake') {
    title = 'Snake';
    body = <SnakeGame highScore={snakeHigh} onGameOver={onSnakeOver} />;
  } else if (meta && computer) {
    title = `${meta.name} vs Computer · ${BOT_LEVELS.find(item => item.id === level)?.label}`;
    back = `/games/${meta.id}`;
    body = <LocalGame key={`${meta.id}-${bots}-${level}-${startSeat}`} game={meta.id as GameId} me={{ name: me.name, avatar: me.avatar }} bots={meta.id === 'ludo' ? bots : 1} level={level} startSeat={startSeat} />;
  } else if (meta) {
    title = meta.name;
    body = <GameLobby game={meta} me={me} />;
  } else {
    body = <GamesHome uid={uid} me={me} />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3 pb-24">
      {title && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navigateGames(back)} aria-label="Back" className="grid h-10 w-10 place-items-center rounded-full bg-white shadow-sm hover:bg-slate-50"><ArrowLeft size={20} /></button>
          <h1 className="flex items-center gap-2 text-lg font-extrabold text-slate-900">{title}{roomId && <span className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-500 shadow-sm"><Medal size={12} />{roomId}</span>}</h1>
        </div>
      )}
      {body}
    </div>
  );
};
