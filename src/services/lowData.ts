/**
 * Low Data Mode: one switch (Settings → Data & Storage, or the Feed quick toggle) that makes EChat lighter
 * on slow or expensive mobile data. Saved in localStorage so it stays ON after the app is closed.
 *
 * While ON:
 *  - videos / Reels never autoplay (thumbnail + Play + size; 480p copy when tapped)
 *  - live streams wait for "Tap to Join Live"
 *  - photos show a tiny blurred preview first ("Tap to load HD")
 *  - chat photos / videos are not downloaded until tapped
 *  - uploads are shrunk first (photos 800px / 70% JPEG, videos 480p)
 *  - the feed only loads more posts when "Load More" is tapped; background refreshes are reduced
 *
 * Media is on Cloudinary, so lighter copies are just a different URL (no extra server work for EChat).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';

const MODE_KEY = 'echat_low_data_mode';
const SAVED_KEY = 'echat_low_data_saved';
const PROMPT_KEY = 'echat_low_data_prompted_at';
const CHANGE_EVENT = 'echat:low-data-changed';
const SAVED_EVENT = 'echat:low-data-saved';

const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } };

export function isLowDataMode(): boolean {
  return read(MODE_KEY) === '1';
}

export function setLowDataMode(on: boolean): void {
  write(MODE_KEY, on ? '1' : '0');
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Has the person ever chosen ON or OFF themselves? (Then we never auto-suggest again.) */
export function hasLowDataChoice(): boolean {
  return read(MODE_KEY) !== null;
}

const subscribeMode = (onChange: () => void) => {
  const onStorage = (event: StorageEvent) => { if (event.key === MODE_KEY) onChange(); };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(CHANGE_EVENT, onChange); window.removeEventListener('storage', onStorage); };
};

/** [isOn, setOn] – re-renders every screen the moment it changes. */
export function useLowDataMode(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribeMode, isLowDataMode, () => false);
  return [on, setLowDataMode];
}

/* ---------------- network detection ---------------- */

type NetworkInfo = { effectiveType?: string; saveData?: boolean; type?: string; downlink?: number; addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void };
const connection = (): NetworkInfo | undefined => (typeof navigator !== 'undefined' ? (navigator as Navigator & { connection?: NetworkInfo }).connection : undefined);

/** 2G / 3G / "slow-2g", very low bandwidth, or the phone's own Data Saver. Wi-Fi / 4G / unknown → false. */
export function isSlowNetwork(): boolean {
  const info = connection();
  if (!info) return false;
  if (info.type === 'wifi' || info.type === 'ethernet') return false;
  if (info.saveData) return true;
  if (['slow-2g', '2g', '3g'].includes(info.effectiveType || '')) return true;
  return typeof info.downlink === 'number' && info.downlink > 0 && info.downlink < 1;
}

export function onNetworkChange(listener: () => void): () => void {
  const info = connection();
  info?.addEventListener?.('change', listener);
  return () => info?.removeEventListener?.('change', listener);
}

/** Ask at most once every 3 days, and never after the person picked ON/OFF themselves. */
export function shouldSuggestLowData(): boolean {
  if (hasLowDataChoice() || !isSlowNetwork()) return false;
  const last = Number(read(PROMPT_KEY) || 0);
  return Date.now() - last > 3 * 24 * 60 * 60 * 1000;
}
export function markLowDataSuggested(): void { write(PROMPT_KEY, String(Date.now())); }

/* ---------------- "You saved X MB this week" ---------------- */

/** items: short hash of each counted URL → bytes, so reloading the feed never counts the same thing twice. */
interface SavedLedger { week: string; bytes: number; items?: Record<string, number> }

/** Monday (local time) of the current week, e.g. "2026-11-23". */
function weekStart(now = new Date()): string {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

function readLedger(): SavedLedger {
  try {
    const parsed = JSON.parse(read(SAVED_KEY) || 'null') as SavedLedger | null;
    if (parsed && parsed.week === weekStart() && Number.isFinite(parsed.bytes)) return parsed;
  } catch { /* corrupt */ }
  return { week: weekStart(), bytes: 0 };
}

function addToLedger(bytes: number) {
  if (!Number.isFinite(bytes) || bytes === 0) return;
  const ledger = readLedger();
  ledger.bytes = Math.max(0, ledger.bytes + bytes);
  write(SAVED_KEY, JSON.stringify(ledger));
  window.dispatchEvent(new Event(SAVED_EVENT));
}

export function getDataSavedThisWeek(): number { return readLedger().bytes; }

const hashKey = (text: string) => { let h = 5381; for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

function changeItem(key: string, bytes: number | null) {
  const ledger = readLedger();
  const items = ledger.items || {};
  const id = hashKey(key);
  if (bytes === null) {
    if (!(id in items)) return;
    ledger.bytes = Math.max(0, ledger.bytes - items[id]);
    delete items[id];
  } else {
    if (id in items) return; // already counted this week
    items[id] = bytes;
    ledger.bytes += bytes;
    const ids = Object.keys(items);
    if (ids.length > 3000) ids.slice(0, ids.length - 3000).forEach(old => delete items[old]);
  }
  ledger.items = items;
  write(SAVED_KEY, JSON.stringify(ledger));
  window.dispatchEvent(new Event(SAVED_EVENT));
}

/** Something was NOT downloaded because of Low Data Mode (estimate; each item counted once a week). */
export function countSaving(key: string, bytes: number): void {
  if (!isLowDataMode() || !key || !(bytes > 0)) return;
  changeItem(key, Math.round(bytes));
}
/** The person chose to download it after all. */
export function uncountSaving(key: string): void {
  if (key) changeItem(key, null);
}
/** Upload got smaller (original size − compressed size). */
export function countUploadSaving(originalBytes: number, sentBytes: number): void {
  if (isLowDataMode() && originalBytes > sentBytes) addToLedger(originalBytes - sentBytes);
}

export function useDataSavedThisWeek(): number {
  const [bytes, setBytes] = useState(getDataSavedThisWeek);
  useEffect(() => {
    const refresh = () => setBytes(getDataSavedThisWeek());
    window.addEventListener(SAVED_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener(SAVED_EVENT, refresh); window.removeEventListener('focus', refresh); };
  }, []);
  return bytes;
}

export function formatBytes(bytes: number): string {
  if (!(bytes > 0)) return '0 MB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/* ---------------- lighter media URLs (Cloudinary transformations) ---------------- */

const CLOUDINARY = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/(image|video)\/upload\/)(.*)$/;

export function isCloudinaryUrl(url: string): boolean { return CLOUDINARY.test(url || ''); }

function transform(url: string, kind: 'image' | 'video', step: string, extension?: string): string {
  const match = (url || '').match(CLOUDINARY);
  if (!match || match[2] !== kind) return '';
  const rest = extension ? match[3].replace(/\.[a-z0-9]+(\?.*)?$/i, `.${extension}`) : match[3];
  return `${match[1]}${step}/${rest}`;
}

/** ~1-2 KB blurred preview of a photo ('' when the photo isn't on Cloudinary). */
export function blurPreviewUrl(url: string): string {
  return transform(url, 'image', 'c_limit,w_48,q_20,e_blur:300,f_auto');
}

/** Photo shrunk to 800px wide, economy quality (falls back to the original URL). */
export function lightImageUrl(url: string): string {
  return transform(url, 'image', 'c_limit,w_800,q_auto:eco,f_auto') || url;
}

/** 480p, economy-quality copy of a video (falls back to the original URL). */
export function lightVideoUrl(url: string): string {
  return transform(url, 'video', 'c_limit,w_854,h_854,q_auto:eco') || url;
}

/** Small first-frame JPG for a video ('' when it isn't on Cloudinary). */
export function lightVideoPoster(url: string): string {
  return transform(url, 'video', 'so_0,c_limit,w_480,q_auto:low', 'jpg');
}

/* ---------------- file sizes ("2.1 MB") ---------------- */

const sizeCache = new Map<string, Promise<number | null>>();

/** Size of a remote file from a HEAD request (a few hundred bytes, no download). null if unknown. */
export function fetchMediaSize(url: string): Promise<number | null> {
  if (!/^https?:\/\//.test(url || '')) return Promise.resolve(null);
  let pending = sizeCache.get(url);
  if (!pending) {
    pending = fetch(url, { method: 'HEAD', cache: 'force-cache' })
      .then(response => {
        const length = Number(response.headers.get('content-length'));
        return response.ok && length > 0 ? length : null;
      })
      .catch(() => null);
    sizeCache.set(url, pending);
  }
  return pending;
}

/** Size of a remote file, or `known` when the size is already stored (chat attachments). */
export function useMediaSize(url: string, enabled: boolean, known?: number): number | null {
  const [size, setSize] = useState<number | null>(known && known > 0 ? known : null);
  useEffect(() => {
    if (!enabled || (known && known > 0)) return;
    let alive = true;
    void fetchMediaSize(url).then(value => { if (alive) setSize(value); });
    return () => { alive = false; };
  }, [url, enabled, known]);
  return size;
}

/** Items the person chose to load in full this session (stay loaded when the list re-renders). */
const unlocked = new Set<string>();
export const isUnlocked = (key: string) => unlocked.has(key);
export function unlock(key: string): void { unlocked.add(key); uncountSaving(key); }
