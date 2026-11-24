import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { api } from '../services/api';
import type { GameId, Outcome } from './engine';
import { ENGINES } from './registry';

/**
 * Online game rooms on Firestore: gameRooms/{CODE} (+ messages subcollection), gameStats/{uid}.
 * Every move goes through a transaction, so two clients can never apply conflicting moves.
 * Security rules (firestore.rules) restrict writes to room members and tie stats to finished rooms.
 */

export { ENGINES };

export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface RoomPlayer { uid: string; name: string; avatar: string; left?: boolean }

export interface GameRoom {
  id: string;
  game: GameId;
  hostId: string;
  status: RoomStatus;
  maxPlayers: number;
  players: RoomPlayer[];
  playerIds: string[];
  invitedIds: string[];
  state: unknown;
  turnDeadline: number;
  version: number;
  winnerIds: string[];
  draw: boolean;
  endReason: string;
  statsRecorded: string[];
  rematchVotes: string[];
  /** Missed turns per seat (Ludo: removed after 3). */
  missed: number[];
  presence: Record<string, number>;
  round: number;
  createdAt: number;
  updatedAt: number;
}

export interface Me { uid: string; name: string; avatar: string }

/** Player identity for rooms / stats. Only short http(s) avatar URLs are stored (no data: URLs). */
export function toMe(uid: string, user: { name?: string; avatar?: string } | null | undefined): Me {
  const avatar = String(user?.avatar || '');
  return { uid, name: String(user?.name || 'Player').slice(0, 80), avatar: /^https?:\/\//i.test(avatar) && avatar.length <= 900 ? avatar : '' };
}

export const ROOM_CODE_LENGTH = 6;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Extra seconds other players wait before acting for an absent player (clock differences). */
export const TIMEOUT_GRACE_MS = 4000;
const MAX_MISSED_TURNS = 3;

const roomRef = (id: string) => doc(db, 'gameRooms', id);
export const normalizeCode = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);
export const roomLink = (id: string) => `${window.location.origin}/games/room/${id}`;

function newCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

function toRoom(id: string, data: Record<string, unknown>): GameRoom {
  return {
    id,
    game: data.game as GameId,
    hostId: String(data.hostId || ''),
    status: (data.status as RoomStatus) || 'waiting',
    maxPlayers: Number(data.maxPlayers || 2),
    players: Array.isArray(data.players) ? (data.players as RoomPlayer[]) : [],
    playerIds: Array.isArray(data.playerIds) ? (data.playerIds as string[]) : [],
    invitedIds: Array.isArray(data.invitedIds) ? (data.invitedIds as string[]) : [],
    state: data.state ?? null,
    turnDeadline: Number(data.turnDeadline || 0),
    version: Number(data.version || 0),
    winnerIds: Array.isArray(data.winnerIds) ? (data.winnerIds as string[]) : [],
    draw: Boolean(data.draw),
    endReason: String(data.endReason || ''),
    statsRecorded: Array.isArray(data.statsRecorded) ? (data.statsRecorded as string[]) : [],
    rematchVotes: Array.isArray(data.rematchVotes) ? (data.rematchVotes as string[]) : [],
    missed: Array.isArray(data.missed) ? (data.missed as number[]) : [],
    presence: (data.presence as Record<string, number>) || {},
    round: Number(data.round || 1),
    createdAt: Number(data.createdAt || 0),
    updatedAt: Number(data.updatedAt || 0)
  };
}

/** Firestore rejects `undefined`; strip it from engine state before writing. */
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function finishFields(room: GameRoom, result: Outcome) {
  return {
    status: 'finished' as RoomStatus,
    winnerIds: result.winners.map(seat => room.playerIds[seat]).filter(Boolean),
    draw: result.draw,
    endReason: result.reason,
    rematchVotes: [] as string[]
  };
}

export async function createRoom(game: GameId, me: Me, maxPlayers: number): Promise<string> {
  const engine = ENGINES[game];
  const seats = Math.min(engine.maxPlayers, Math.max(engine.minPlayers, Math.round(maxPlayers)));
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newCode();
    const created = await runTransaction(db, async transaction => {
      if ((await transaction.get(roomRef(id))).exists()) return false;
      const now = Date.now();
      transaction.set(roomRef(id), {
        game,
        hostId: me.uid,
        status: 'waiting',
        maxPlayers: seats,
        players: [{ uid: me.uid, name: me.name.slice(0, 80), avatar: me.avatar || '' }],
        playerIds: [me.uid],
        invitedIds: [],
        state: null,
        turnDeadline: 0,
        version: 0,
        winnerIds: [],
        draw: false,
        endReason: '',
        statsRecorded: [],
        rematchVotes: [],
        missed: [],
        presence: { [me.uid]: now },
        round: 1,
        createdAt: now,
        updatedAt: now
      });
      return true;
    });
    if (created) return id;
  }
  throw new Error('Could not create a room. Please try again.');
}

export function listenRoom(id: string, onRoom: (room: GameRoom | null) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(roomRef(id), snapshot => onRoom(snapshot.exists() ? toRoom(snapshot.id, snapshot.data()) : null), onError);
}

export async function joinRoom(id: string, me: Me): Promise<void> {
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(roomRef(id));
    if (!snapshot.exists()) throw new Error('Room not found. Check the code.');
    const room = toRoom(snapshot.id, snapshot.data());
    if (room.playerIds.includes(me.uid)) return;
    if (room.status !== 'waiting') throw new Error('This game has already started.');
    if (room.playerIds.length >= room.maxPlayers) throw new Error('This room is full.');
    transaction.update(roomRef(id), {
      players: [...room.players, { uid: me.uid, name: me.name.slice(0, 80), avatar: me.avatar || '' }],
      playerIds: [...room.playerIds, me.uid],
      version: room.version + 1,
      updatedAt: Date.now()
    });
  });
}

export async function startGame(id: string, me: Me): Promise<void> {
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(roomRef(id));
    if (!snapshot.exists()) throw new Error('Room not found.');
    const room = toRoom(snapshot.id, snapshot.data());
    if (room.hostId !== me.uid) throw new Error('Only the host can start the game.');
    if (room.status !== 'waiting') return;
    const engine = ENGINES[room.game];
    if (room.playerIds.length < engine.minPlayers) throw new Error('Waiting for more players to join.');
    const now = Date.now();
    transaction.update(roomRef(id), {
      status: 'playing',
      state: clean(engine.init(room.playerIds.length)),
      turnDeadline: now + engine.turnSeconds * 1000,
      missed: room.playerIds.map(() => 0),
      version: room.version + 1,
      updatedAt: now
    });
  });
}

/** Applies one move as the signed-in player. Throws a readable error for illegal moves. */
export async function playMove(id: string, me: Me, action: unknown): Promise<void> {
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(roomRef(id));
    if (!snapshot.exists()) throw new Error('Room not found.');
    const room = toRoom(snapshot.id, snapshot.data());
    if (room.status !== 'playing') throw new Error('The game is not running.');
    const engine = ENGINES[room.game];
    const seat = room.playerIds.indexOf(me.uid);
    if (seat < 0 || room.players[seat]?.left) throw new Error('You are not playing in this room.');
    const state = engine.apply(room.state, action, seat);
    const result = engine.outcome(state);
    const missed = [...room.missed];
    missed[seat] = 0;
    const now = Date.now();
    transaction.update(roomRef(id), {
      state: clean(state),
      turnDeadline: now + engine.turnSeconds * 1000,
      missed,
      version: room.version + 1,
      updatedAt: now,
      ...(result ? finishFields(room, result) : {})
    });
  });
}

/**
 * Called when the turn timer has run out. Ludo: auto-roll / auto-move for the player (and after
 * 3 missed turns by an absent player they are removed). Other games: that player loses on time.
 */
/** Returns true when the timeout was applied (false = not due yet / nothing to do). */
export async function claimTimeout(id: string, me: Me): Promise<boolean> {
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(roomRef(id));
    if (!snapshot.exists()) return false;
    const room = toRoom(snapshot.id, snapshot.data());
    if (room.status !== 'playing') return false;
    const engine = ENGINES[room.game];
    const current = engine.current(room.state);
    if (current < 0) return false;
    const mine = room.playerIds[current] === me.uid;
    const now = Date.now();
    if (now < room.turnDeadline + (mine ? 0 : TIMEOUT_GRACE_MS)) return false;
    if (!room.playerIds.includes(me.uid)) return false;
    const auto = engine.autoAction?.(room.state, Math.random) ?? null;
    if (!auto) {
      const name = room.players[current]?.name || 'Player';
      const others = room.playerIds.map((_, seat) => seat).filter(seat => seat !== current);
      transaction.update(roomRef(id), { ...finishFields(room, { winners: others, draw: false, reason: `${name} ran out of time` }), version: room.version + 1, updatedAt: now });
      return true;
    }
    let state = engine.apply(room.state, auto, current);
    const missed = room.playerIds.map((_, seat) => room.missed[seat] || 0);
    if (!mine) missed[current] += 1;
    const players = room.players.map(player => ({ ...player }));
    if (!mine && missed[current] >= MAX_MISSED_TURNS && engine.current(state) >= 0) {
      state = engine.removePlayer(state, current, room.playerIds.length).state;
      players[current].left = true;
    }
    const result = engine.outcome(state);
    transaction.update(roomRef(id), {
      state: clean(state),
      players,
      missed,
      turnDeadline: now + engine.turnSeconds * 1000,
      version: room.version + 1,
      updatedAt: now,
      ...(result ? finishFields(room, result) : {})
    });
    return true;
  });
}

/** Leave: in the lobby you just leave the room; during a game you forfeit. */
export async function leaveRoom(id: string, me: Me): Promise<void> {
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(roomRef(id));
    if (!snapshot.exists()) return;
    const room = toRoom(snapshot.id, snapshot.data());
    const seat = room.playerIds.indexOf(me.uid);
    if (seat < 0) return;
    const now = Date.now();
    if (room.status === 'waiting') {
      const players = room.players.filter(player => player.uid !== me.uid);
      if (!players.length) { transaction.delete(roomRef(id)); return; }
      transaction.update(roomRef(id), {
        players,
        playerIds: players.map(player => player.uid),
        hostId: room.hostId === me.uid ? players[0].uid : room.hostId,
        version: room.version + 1,
        updatedAt: now
      });
      return;
    }
    const players = room.players.map((player, index) => (index === seat ? { ...player, left: true } : player));
    if (room.status === 'finished') {
      transaction.update(roomRef(id), { players, rematchVotes: room.rematchVotes.filter(uid => uid !== me.uid), version: room.version + 1, updatedAt: now });
      return;
    }
    const engine = ENGINES[room.game];
    const { state, outcome } = engine.removePlayer(room.state, seat, room.playerIds.length);
    transaction.update(roomRef(id), {
      players,
      state: clean(state),
      turnDeadline: now + engine.turnSeconds * 1000,
      version: room.version + 1,
      updatedAt: now,
      ...(outcome ? finishFields(room, outcome) : {})
    });
  });
}

/** Votes for a rematch; when every remaining player has voted, a new round starts in the same room. */
export async function voteRematch(id: string, me: Me): Promise<void> {
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(roomRef(id));
    if (!snapshot.exists()) throw new Error('Room not found.');
    const room = toRoom(snapshot.id, snapshot.data());
    if (room.status !== 'finished') return;
    const present = room.players.filter(player => !player.left);
    if (!present.some(player => player.uid === me.uid)) throw new Error('You left this game.');
    const engine = ENGINES[room.game];
    if (present.length < engine.minPlayers) throw new Error('Not enough players left for a rematch.');
    const votes = Array.from(new Set([...room.rematchVotes, me.uid]));
    const now = Date.now();
    if (!present.every(player => votes.includes(player.uid))) {
      transaction.update(roomRef(id), { rematchVotes: votes, version: room.version + 1, updatedAt: now });
      return;
    }
    // Everyone agreed: rotate seats so a different player starts, then begin the next round.
    const players = [...present.slice(1), present[0]].map(({ uid, name, avatar }) => ({ uid, name, avatar }));
    transaction.update(roomRef(id), {
      status: 'playing',
      players,
      playerIds: players.map(player => player.uid),
      hostId: present.some(player => player.uid === room.hostId) ? room.hostId : players[0].uid,
      state: clean(engine.init(players.length)),
      turnDeadline: now + engine.turnSeconds * 1000,
      missed: players.map(() => 0),
      winnerIds: [],
      draw: false,
      endReason: '',
      statsRecorded: [],
      rematchVotes: [],
      round: room.round + 1,
      version: room.version + 1,
      updatedAt: now
    });
  });
}

export async function heartbeat(id: string, uid: string): Promise<void> {
  const now = Date.now();
  await updateDoc(roomRef(id), { [`presence.${uid}`]: now, updatedAt: now });
}

/** Adds friends to the room's invite list and sends each of them an EChat message with the link. */
export async function inviteFriends(room: GameRoom, me: Me, friends: { id: string; name: string }[], gameName: string): Promise<number> {
  const ids = friends.map(friend => friend.id).filter(id => !room.playerIds.includes(id));
  if (!ids.length) return 0;
  await updateDoc(roomRef(room.id), { invitedIds: arrayUnion(...ids), updatedAt: Date.now() });
  const text = `🎮 ${me.name} invited you to play ${gameName} on EChat! Room code ${room.id}. Join: ${roomLink(room.id)}`;
  const results = await Promise.allSettled(ids.map(receiverId => api.sendMessage({ receiverId, text })));
  return results.filter(result => result.status === 'fulfilled').length;
}

// ---------------- lists ----------------

export function listenInvites(uid: string, onRooms: (rooms: GameRoom[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'gameRooms'), where('invitedIds', 'array-contains', uid), limit(30)), snapshot => {
    onRooms(snapshot.docs.map(item => toRoom(item.id, item.data())).filter(room => room.status === 'waiting' && !room.playerIds.includes(uid)).sort((a, b) => b.createdAt - a.createdAt));
  }, () => onRooms([]));
}

export function listenMyRooms(uid: string, onRooms: (rooms: GameRoom[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'gameRooms'), where('playerIds', 'array-contains', uid), limit(60)), snapshot => {
    onRooms(snapshot.docs.map(item => toRoom(item.id, item.data())).sort((a, b) => b.updatedAt - a.updatedAt));
  }, () => onRooms([]));
}

/** Rooms active in the last 5 minutes, for "N playing now" on the game cards. */
export function listenLiveRooms(onRooms: (rooms: GameRoom[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'gameRooms'), where('status', 'in', ['waiting', 'playing']), limit(300)), snapshot => {
    const cutoff = Date.now() - 5 * 60_000;
    onRooms(snapshot.docs.map(item => toRoom(item.id, item.data())).filter(room => room.updatedAt > cutoff));
  }, () => onRooms([]));
}

// ---------------- chat ----------------

export interface RoomMessage { id: string; senderId: string; name: string; text: string; kind: 'text' | 'emoji'; createdAt: number }

export function listenRoomMessages(id: string, onMessages: (messages: RoomMessage[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'gameRooms', id, 'messages'), orderBy('createdAt', 'desc'), limit(60)), snapshot => {
    onMessages(snapshot.docs.map(item => {
      const data = item.data();
      return { id: item.id, senderId: String(data.senderId || ''), name: String(data.name || ''), text: String(data.text || ''), kind: data.kind === 'emoji' ? 'emoji' : 'text', createdAt: Number(data.createdAt || 0) } as RoomMessage;
    }).reverse());
  }, () => onMessages([]));
}

export async function sendRoomMessage(id: string, me: Me, text: string, kind: 'text' | 'emoji'): Promise<void> {
  const value = text.trim().slice(0, 200);
  if (!value) return;
  await addDoc(collection(db, 'gameRooms', id, 'messages'), { senderId: me.uid, name: me.name.slice(0, 80), text: value, kind, createdAt: Date.now() });
}

// ---------------- stats + leaderboard ----------------

export interface GameStats { uid: string; name: string; avatar: string; wins: number; losses: number; draws: number; games: number; snakeHigh: number }

const statsRef = (uid: string) => doc(db, 'gameStats', uid);

function toStats(uid: string, data: Record<string, unknown> | undefined): GameStats {
  return {
    uid,
    name: String(data?.name || ''),
    avatar: String(data?.avatar || ''),
    wins: Number(data?.wins || 0),
    losses: Number(data?.losses || 0),
    draws: Number(data?.draws || 0),
    games: Number(data?.games || 0),
    snakeHigh: Number(data?.snakeHigh || 0)
  };
}

async function ensureStats(me: Me): Promise<void> {
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(statsRef(me.uid));
    if (snapshot.exists()) return;
    transaction.set(statsRef(me.uid), { uid: me.uid, name: me.name.slice(0, 80), avatar: me.avatar || '', wins: 0, losses: 0, draws: 0, games: 0, snakeHigh: 0, lastRoomId: '', updatedAt: Date.now() });
  });
}

export function listenMyStats(uid: string, onStats: (stats: GameStats) => void): Unsubscribe {
  return onSnapshot(statsRef(uid), snapshot => onStats(toStats(uid, snapshot.data())), () => onStats(toStats(uid, undefined)));
}

/** Records the signed-in player's result for a finished room exactly once (rules enforce it). */
export async function recordResult(room: GameRoom, me: Me): Promise<void> {
  if (room.status !== 'finished' || !room.playerIds.includes(me.uid) || room.statsRecorded.includes(me.uid)) return;
  await ensureStats(me);
  const field = room.draw ? 'draws' : room.winnerIds.includes(me.uid) ? 'wins' : 'losses';
  const batch = writeBatch(db);
  batch.update(roomRef(room.id), { statsRecorded: arrayUnion(me.uid) });
  batch.update(statsRef(me.uid), { [field]: increment(1), games: increment(1), lastRoomId: room.id, name: me.name.slice(0, 80), avatar: me.avatar || '', updatedAt: Date.now() });
  await batch.commit();
}

export async function saveSnakeScore(me: Me, score: number): Promise<void> {
  await ensureStats(me);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(statsRef(me.uid));
    const current = Number(snapshot.data()?.snakeHigh || 0);
    if (score <= current) return;
    transaction.update(statsRef(me.uid), { snakeHigh: Math.min(10000, Math.round(score)), name: me.name.slice(0, 80), avatar: me.avatar || '', updatedAt: Date.now() });
  });
}

export function listenLeaderboard(field: 'wins' | 'snakeHigh', onRows: (rows: GameStats[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'gameStats'), orderBy(field, 'desc'), limit(10)), snapshot => {
    onRows(snapshot.docs.map(item => toStats(item.id, item.data())).filter(row => row[field] > 0));
  }, () => onRows([]));
}

export async function roomExists(id: string): Promise<boolean> {
  return (await getDoc(roomRef(id))).exists();
}

export function gameErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code || '';
  if (code === 'permission-denied') return 'Permission denied. Sign in again (and make sure the latest Firestore rules are deployed).';
  if (code === 'unavailable') return 'You appear to be offline. Check your connection.';
  if (code === 'failed-precondition' || code === 'aborted') return 'Someone else moved at the same time. Try again.';
  return error instanceof Error ? error.message : 'Something went wrong.';
}
