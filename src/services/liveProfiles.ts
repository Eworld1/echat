/**
 * Live author info (Facebook-style). Posts, comments, stories and reels store only who wrote them;
 * the name, picture and verified badge shown on every card come from here, so a name or photo
 * change shows on all old posts instantly, with no refresh.
 *
 * - First use of an id: fetched in one batch from the eChat server (/api/users-public: public fields only).
 * - Changes: the server broadcasts 'user_updated' over the socket -> 'echat:profile-updated' -> here.
 *   Your own edits dispatch the same event, so your cards change the moment you save.
 * - Firestore users/{uid} is private (email, birthday), so it is never read for other people.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { apiUrl } from './apiBase';

export interface LiveProfile { id: string; name?: string; avatar?: string; isVerified?: boolean; isOfficialDeveloper?: boolean; role?: string }

const profiles = new Map<string, LiveProfile>();
const listeners = new Map<string, Set<() => void>>();
const requested = new Map<string, number>();
let queue = new Set<string>();
let timer: number | null = null;
const REFRESH_AFTER_MS = 10 * 60 * 1000;

function emit(id: string) { listeners.get(id)?.forEach(fn => fn()); }

function merge(update: LiveProfile) {
  if (!update?.id) return;
  const current = profiles.get(update.id) || { id: update.id };
  const next: LiveProfile = { ...current };
  if (typeof update.name === 'string' && update.name.trim()) next.name = update.name;
  if (typeof update.avatar === 'string') next.avatar = update.avatar;
  if (typeof update.isVerified === 'boolean') next.isVerified = update.isVerified;
  if (typeof update.isOfficialDeveloper === 'boolean') next.isOfficialDeveloper = update.isOfficialDeveloper;
  if (typeof update.role === 'string') next.role = update.role;
  if (next.name === current.name && next.avatar === current.avatar && next.isVerified === current.isVerified && next.isOfficialDeveloper === current.isOfficialDeveloper && next.role === current.role && profiles.has(update.id)) return;
  profiles.set(update.id, next);
  emit(update.id);
}

async function flush() {
  timer = null;
  const ids = [...queue];
  queue = new Set();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    try {
      const res = await fetch(apiUrl(`/api/users-public?ids=${encodeURIComponent(chunk.join(','))}`));
      if (!res.ok) throw new Error(String(res.status));
      const list = await res.json() as LiveProfile[];
      if (Array.isArray(list)) list.forEach(merge);
    } catch {
      chunk.forEach(id => requested.delete(id)); // try again next time a card needs it
    }
  }
}

function request(id: string) {
  const last = requested.get(id);
  if (last && Date.now() - last < REFRESH_AFTER_MS) return;
  requested.set(id, Date.now());
  queue.add(id);
  if (timer === null) timer = window.setTimeout(() => { void flush(); }, 40);
}

if (typeof window !== 'undefined') {
  window.addEventListener('echat:profile-updated', event => merge((event as CustomEvent<LiveProfile>).detail));
  // Back from the background (missed socket events): refresh what is on screen.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    for (const [id, at] of requested) if (Date.now() - at > 60_000 && listeners.get(id)?.size) { requested.delete(id); request(id); }
  });
}

function subscribe(id: string, fn: () => void) {
  let set = listeners.get(id);
  if (!set) listeners.set(id, set = new Set());
  set.add(fn);
  request(id);
  return () => { set!.delete(fn); };
}

const EMPTY: LiveProfile | undefined = undefined;

/** The latest known profile for one user id (undefined until loaded). */
export function useLiveProfile(id: string | undefined | null): LiveProfile | undefined {
  return useSyncExternalStore(
    fn => (id ? subscribe(id, fn) : () => {}),
    () => (id ? profiles.get(id) : EMPTY),
    () => EMPTY
  );
}

/** Live name/avatar for an author, falling back to the copy saved with the post until it loads. */
export function useAuthor<T extends object>(id: string | undefined | null, saved: T): T & Partial<LiveProfile> {
  return withLive(saved, useLiveProfile(id));
}

/** Live profiles for a list of ids (comments, story rings…): { [id]: profile } re-rendered on any change. */
export function useLiveProfiles(ids: Array<string | undefined | null>): Record<string, LiveProfile> {
  const key = [...new Set(ids.filter((id): id is string => Boolean(id)))].sort().join(',');
  const read = () => Object.fromEntries(key ? key.split(',').flatMap(id => (profiles.has(id) ? [[id, profiles.get(id)!]] : [])) : []);
  const [state, setState] = useState<Record<string, LiveProfile>>(read);
  useEffect(() => {
    const list = key ? key.split(',') : [];
    const update = () => setState(read());
    update();
    const stops = list.map(id => subscribe(id, update));
    return () => stops.forEach(stop => stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/** Overlay a live profile on saved author fields (name/avatar/badge). */
export function withLive<T extends object>(saved: T, live: LiveProfile | undefined): T & Partial<LiveProfile> {
  if (!live) return saved;
  return {
    ...saved,
    ...(live.name ? { name: live.name } : {}),
    ...(live.avatar ? { avatar: live.avatar } : {}),
    ...(typeof live.isVerified === 'boolean' ? { isVerified: live.isVerified } : {}),
    ...(typeof live.isOfficialDeveloper === 'boolean' ? { isOfficialDeveloper: live.isOfficialDeveloper } : {}),
    ...(live.role ? { role: live.role } : {})
  };
}

/** Same list with each item's saved name/photo replaced by the live one (comments, replies…). */
export function useLiveList<T extends object>(list: T[], idKey: keyof T, nameKey: keyof T, avatarKey: keyof T): T[] {
  const live = useLiveProfiles(list.map(item => String(item[idKey] ?? '')));
  return useMemo(() => list.map(item => {
    const profile = live[String(item[idKey] ?? '')];
    if (!profile) return item;
    return { ...item, ...(profile.name ? { [nameKey]: profile.name } : {}), ...(profile.avatar ? { [avatarKey]: profile.avatar } : {}) };
  }), [list, live, idKey, nameKey, avatarKey]);
}

/** For tests and non-React code. */
export const liveProfileStore = { get: (id: string) => profiles.get(id), merge };
