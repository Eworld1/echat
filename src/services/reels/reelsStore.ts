import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  deleteDoc,
  type DocumentData,
  type Query,
  type Unsubscribe
} from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { db, storage } from '../firebase';
import { ALL_CATALOG_SOUNDS, type SoundInfo } from './soundCatalog';

/**
 * Reels / Stories / Sounds on Firebase (Firestore + Storage).
 * Security is enforced by firestore.rules and storage.rules: counters only move together with the
 * matching like / comment document, and media uploads are limited to 30 MB per file.
 */

export const MAX_MEDIA_BYTES = 30 * 1024 * 1024;
/** Photos (reels + stories) are capped lower than videos. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_REEL_SECONDS = 90;
export const MAX_STORY_SECONDS = 60;
export const IMAGE_SECONDS = 7;
export const STORY_TTL_MS = 24 * 60 * 60 * 1000;
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export type MediaType = 'video' | 'image';
export type Audience = 'public' | 'friends' | 'only_me';
export type FilterName = 'normal' | 'vivid' | 'warm' | 'cool' | 'bw';
export type PlaybackSpeed = 0.5 | 1 | 1.5 | 2;

export const FILTERS: { id: FilterName; label: string; css: string }[] = [
  { id: 'normal', label: 'Normal', css: 'none' },
  { id: 'vivid', label: 'Vivid', css: 'saturate(1.6) contrast(1.1)' },
  { id: 'warm', label: 'Warm', css: 'sepia(0.3) saturate(1.35) hue-rotate(-12deg)' },
  { id: 'cool', label: 'Cool', css: 'saturate(1.1) hue-rotate(18deg) brightness(1.05)' },
  { id: 'bw', label: 'B&W', css: 'grayscale(1) contrast(1.1)' }
];
export const filterCss = (name?: string) => FILTERS.find(item => item.id === name)?.css || 'none';

export interface Overlay { id: string; kind: 'text' | 'emoji'; text: string; x: number; y: number; color: string; size: number }
export interface TimedEffect { id: string; soundId: string; name: string; url: string; at: number }
export interface StorySticker {
  kind: 'poll' | 'question' | 'slider' | 'music';
  prompt: string;
  options?: string[];
  emoji?: string;
  x: number;
  y: number;
}

/** Non-destructive edits, applied by the player at playback time. */
export interface MediaEdit {
  trimStart: number;
  trimEnd: number;
  speed: PlaybackSpeed;
  filter: FilterName;
  overlays: Overlay[];
  musicVolume: number;
  originalVolume: number;
  soundId: string;
  soundName: string;
  soundArtist: string;
  soundUrl: string;
  effects: TimedEffect[];
}

export interface DuetSource { reelId: string; mediaUrl: string; mediaType: MediaType; creatorName: string; trimStart: number; trimEnd: number }

export interface Reel extends MediaEdit {
  id: string;
  mediaType: MediaType;
  mediaUrl: string;
  coverUrl: string;
  caption: string;
  hashtags: string[];
  location: string;
  taggedUserIds: string[];
  taggedNames: string[];
  audience: Audience;
  allowedViewers: string[];
  duration: number;
  views: number;
  likesCount: number;
  commentsCount: number;
  creatorId: string;
  creatorName: string;
  creatorAvatar: string;
  createdAt: number;
  isStoryAlso: boolean;
  duetOf: DuetSource | null;
  remixOf: string;
}

export interface Story extends MediaEdit {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  mediaUrl: string;
  mediaType: MediaType;
  coverUrl: string;
  stickers: StorySticker[];
  allowedViewers: string[];
  expiresAt: number;
  views: number;
  createdAt: number;
  fromReelId: string;
}

export interface ReelComment {
  id: string;
  reelId: string;
  parentId: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  text: string;
  likesCount: number;
  createdAt: number;
}

export interface SavedSound { soundId: string; name: string; artist: string; audioUrl: string; savedAt: number }

export const DEFAULT_EDIT: MediaEdit = {
  trimStart: 0, trimEnd: 0, speed: 1, filter: 'normal', overlays: [], musicVolume: 0.8, originalVolume: 1,
  soundId: '', soundName: '', soundArtist: '', soundUrl: '', effects: []
};

// ---------------- helpers ----------------

const num = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const str = (value: unknown) => (typeof value === 'string' ? value : '');
const arr = <T,>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);

function toEdit(data: DocumentData): MediaEdit {
  const speed = num(data.speed, 1);
  return {
    trimStart: Math.max(0, num(data.trimStart)),
    trimEnd: Math.max(0, num(data.trimEnd)),
    speed: ([0.5, 1, 1.5, 2].includes(speed) ? speed : 1) as PlaybackSpeed,
    filter: (FILTERS.some(item => item.id === data.filter) ? data.filter : 'normal') as FilterName,
    overlays: arr<Overlay>(data.overlays),
    musicVolume: Math.min(1, Math.max(0, num(data.musicVolume, 0.8))),
    originalVolume: Math.min(1, Math.max(0, num(data.originalVolume, 1))),
    soundId: str(data.soundId),
    soundName: str(data.soundName),
    soundArtist: str(data.soundArtist),
    soundUrl: str(data.soundUrl),
    effects: arr<TimedEffect>(data.effects)
  };
}

export function toReel(id: string, data: DocumentData): Reel {
  return {
    ...toEdit(data),
    id,
    mediaType: data.mediaType === 'image' ? 'image' : 'video',
    mediaUrl: str(data.mediaUrl),
    coverUrl: str(data.coverUrl),
    caption: str(data.caption),
    hashtags: arr<string>(data.hashtags),
    location: str(data.location),
    taggedUserIds: arr<string>(data.taggedUserIds),
    taggedNames: arr<string>(data.taggedNames),
    audience: (['public', 'friends', 'only_me'].includes(data.audience) ? data.audience : 'public') as Audience,
    allowedViewers: arr<string>(data.allowedViewers),
    duration: num(data.duration),
    views: num(data.views),
    likesCount: Math.max(0, num(data.likesCount)),
    commentsCount: Math.max(0, num(data.commentsCount)),
    creatorId: str(data.creatorId),
    creatorName: str(data.creatorName) || 'EChat user',
    creatorAvatar: str(data.creatorAvatar),
    createdAt: num(data.createdAt),
    isStoryAlso: data.isStoryAlso === true,
    duetOf: data.duetOf && typeof data.duetOf === 'object' ? data.duetOf as DuetSource : null,
    remixOf: str(data.remixOf)
  };
}

function toStory(id: string, data: DocumentData): Story {
  return {
    ...toEdit(data),
    id,
    userId: str(data.userId),
    userName: str(data.userName) || 'EChat user',
    userAvatar: str(data.userAvatar),
    mediaUrl: str(data.mediaUrl),
    mediaType: data.mediaType === 'video' ? 'video' : 'image',
    coverUrl: str(data.coverUrl),
    stickers: arr<StorySticker>(data.stickers),
    allowedViewers: arr<string>(data.allowedViewers),
    expiresAt: num(data.expiresAt),
    views: num(data.views),
    createdAt: num(data.createdAt),
    fromReelId: str(data.fromReelId)
  };
}

/** Firestore rejects `undefined`; strip it recursively. */
function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const extractHashtags = (text: string) => Array.from(new Set((text.match(/#[\p{L}\p{N}_]{1,40}/gu) || []).map(tag => tag.toLowerCase()))).slice(0, 20);

/** Runs an indexed query; if the composite index isn't deployed yet, falls back to an unordered query. */
function listenWithFallback(primary: Query, fallback: Query, onDocs: (docs: { id: string; data: DocumentData }[]) => void, onError: (error: Error) => void): Unsubscribe {
  let stop: Unsubscribe = () => {};
  let usingFallback = false;
  const handle = (snapshot: { docs: { id: string; data: () => DocumentData }[] }) => onDocs(snapshot.docs.map(item => ({ id: item.id, data: item.data() })));
  stop = onSnapshot(primary, handle, error => {
    if (!usingFallback && /index|failed-precondition/i.test(`${(error as { code?: string }).code} ${error.message}`)) {
      usingFallback = true;
      console.warn('[Reels] Composite index missing, using fallback query. Deploy firestore.indexes.json for best results.');
      stop = onSnapshot(fallback, handle, onError);
    } else onError(error);
  });
  return () => stop();
}

// ---------------- uploads (Firebase Storage) ----------------

export function validateMediaFile(file: File, kind: 'reel' | 'story'): { mediaType: MediaType } {
  const type = (file.type || '').toLowerCase();
  const isVideo = VIDEO_TYPES.includes(type) || (!type && /\.(mp4|mov|webm)$/i.test(file.name));
  const isImage = IMAGE_TYPES.includes(type) || (!type && /\.(jpe?g|png|webp)$/i.test(file.name));
  if (!isVideo && !isImage) throw new Error('Use an MP4, MOV or WEBM video, or a JPG, PNG or WEBP image.');
  if (isVideo && file.size > MAX_MEDIA_BYTES) throw new Error('Video must be 30MB or less');
  if (isImage && file.size > MAX_IMAGE_BYTES) throw new Error('Image must be 10MB or less');
  void kind;
  return { mediaType: isVideo ? 'video' : 'image' };
}

export interface UploadHandle { promise: Promise<string>; cancel: () => void }

/** Seconds before we check *why* an upload has not sent its first byte yet. */
const FIRST_BYTE_PROBE_MS = 8_000;
/** No progress at all for this long = give up with a clear error + Retry (the SDK would retry for 10 min). */
const STALL_TIMEOUT_MS = 60_000;

const STORAGE_ERROR_TEXT: Record<string, string> = {
  'storage/unauthorized': 'Permission denied - Storage Rules. Sign in again; if it keeps happening, the Storage rules are not deployed yet.',
  'storage/unauthenticated': 'You are signed out of Firebase. Sign in again and retry.',
  'storage/bucket-not-found': 'Storage bucket not found. Firebase Storage is not enabled for this project yet.',
  'storage/project-not-found': 'Firebase project not found. Check the Firebase config.',
  'storage/quota-exceeded': 'Storage is full. Please contact EChat.',
  'storage/retry-limit-exceeded': 'Upload timed out. Check your connection and retry.',
  'storage/invalid-checksum': 'The file got corrupted while uploading. Please retry.',
  'storage/server-file-wrong-size': 'The file got corrupted while uploading. Please retry.',
  'storage/canceled': 'Upload cancelled.'
};

/**
 * Asks the Storage API directly whether the bucket exists. A missing bucket makes the SDK retry silently
 * for ~10 minutes (looks like "stuck at 0%"), so we detect it ourselves. 401/403 = bucket exists.
 */
async function probeBucket(bucket: string): Promise<'missing' | 'ok' | 'offline'> {
  try {
    const response = await fetch(`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?maxResults=1`, { method: 'GET', cache: 'no-store' });
    return response.status === 404 ? 'missing' : 'ok';
  } catch {
    return 'offline';
  }
}

/** Upload straight from the device to Firebase Storage with real progress. Never hangs silently. */
export function uploadMedia(folder: 'reels' | 'stories' | 'covers', uid: string, file: Blob & { name?: string }, onProgress: (percent: number) => void): UploadHandle {
  const extension = (file.name?.split('.').pop() || (file.type.split('/')[1] || 'bin')).replace('quicktime', 'mov').replace('jpeg', 'jpg').slice(0, 5);
  // Some phones give .MOV files an empty type; Storage rules need a real content type.
  const byExtension: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const contentType = file.type || byExtension[extension.toLowerCase()] || 'application/octet-stream';
  const isImage = contentType.startsWith('image/');
  // Size limits are checked BEFORE anything is sent.
  if (isImage && file.size > MAX_IMAGE_BYTES) return { promise: Promise.reject(new Error('Image must be 10MB or less')), cancel: () => {} };
  if (!isImage && file.size > MAX_MEDIA_BYTES) return { promise: Promise.reject(new Error('Video must be 30MB or less')), cancel: () => {} };
  if (!uid) return { promise: Promise.reject(new Error('You are signed out of Firebase. Sign in again and retry.')), cancel: () => {} };

  const bucket = String(storage.app.options.storageBucket || '');
  if (!bucket) {
    console.error('[EChat upload] No storageBucket in the Firebase config (VITE_FIREBASE_STORAGE_BUCKET / firebase-applet-config.json).');
    return { promise: Promise.reject(new Error('Storage bucket not configured. Set VITE_FIREBASE_STORAGE_BUCKET.')), cancel: () => {} };
  }

  const path = `${folder}/${uid}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${extension}`;
  const task = uploadBytesResumable(storageRef(storage, path), file, { contentType, cacheControl: 'public, max-age=31536000' });
  let settled = false;
  let overrideError: Error | null = null;
  let lastBytes = 0;
  let lastProgressAt = Date.now();
  const timers: number[] = [];
  const clearTimers = () => timers.splice(0).forEach(id => window.clearTimeout(id));

  const promise = new Promise<string>((resolve, reject) => {
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(error);
    };

    const abortWith = (message: string, detail: unknown) => {
      if (settled || overrideError) return;
      console.error(`[EChat upload] ${message}`, detail);
      overrideError = new Error(message);
      task.cancel(); // the error handler below rejects with overrideError
    };

    timers.push(window.setTimeout(() => {
      if (settled || lastBytes > 0) return;
      void probeBucket(bucket).then(result => {
        if (result === 'missing') abortWith(`Storage bucket not found ("${bucket}"). Enable Firebase Storage in the Firebase console, then deploy storage.rules.`, { bucket, path });
        else if (result === 'offline' && !navigator.onLine) abortWith('You are offline. Check your connection and retry.', { bucket, path });
      });
    }, FIRST_BYTE_PROBE_MS));

    const watchStall = () => {
      timers.push(window.setTimeout(() => {
        if (settled) return;
        if (Date.now() - lastProgressAt >= STALL_TIMEOUT_MS) abortWith('Upload is not moving. Check your connection and retry.', { bucket, path, bytesTransferred: lastBytes });
        else watchStall();
      }, 5_000));
    };
    watchStall();

    task.on('state_changed',
      snapshot => {
        if (snapshot.bytesTransferred !== lastBytes) { lastBytes = snapshot.bytesTransferred; lastProgressAt = Date.now(); }
        onProgress(snapshot.totalBytes ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100) : 0);
      },
      error => {
        const code = (error as { code?: string }).code || '';
        if (overrideError) { fail(overrideError); return; }
        // Log the REAL error (code + server response) so it can be diagnosed from the browser console.
        if (code !== 'storage/canceled') console.error('[EChat upload] failed', { code, message: error.message, serverResponse: (error as { serverResponse?: string }).serverResponse, bucket, path });
        fail(new Error(STORAGE_ERROR_TEXT[code] || `Upload failed: ${error.message || code || 'unknown error'}`));
      },
      () => {
        clearTimers();
        void getDownloadURL(task.snapshot.ref).then(url => { settled = true; resolve(url); }, error => {
          console.error('[EChat upload] uploaded but could not get the download URL', error);
          fail(new Error(`Upload finished but the link could not be created: ${error instanceof Error ? error.message : 'unknown error'}`));
        });
      });
  });
  return { promise, cancel: () => { if (!settled) task.cancel(); } };
}

// ---------------- reels ----------------

export type NewReel = Omit<Reel, 'id' | 'views' | 'likesCount' | 'commentsCount' | 'createdAt'>;

export async function createReel(input: NewReel): Promise<string> {
  const ref = doc(collection(db, 'reels'));
  await setDoc(ref, clean({ ...input, views: 0, likesCount: 0, commentsCount: 0, createdAt: Date.now() }));
  if (input.soundId) void bumpSoundUse(input.soundId);
  return ref.id;
}

/** Public reels + reels shared with me (friends / only me), merged and de-duplicated by the caller. */
export function listenReels(uid: string, onReels: (reels: Reel[]) => void, onError: (error: Error) => void): Unsubscribe {
  const reels = collection(db, 'reels');
  const buckets: { publicReels: Reel[]; mine: Reel[] } = { publicReels: [], mine: [] };
  const emit = () => onReels([...new Map([...buckets.publicReels, ...buckets.mine].map(reel => [reel.id, reel])).values()].sort((a, b) => b.createdAt - a.createdAt));
  const stopPublic = listenWithFallback(
    query(reels, where('audience', '==', 'public'), orderBy('createdAt', 'desc'), limit(150)),
    query(reels, where('audience', '==', 'public'), limit(300)),
    docs => { buckets.publicReels = docs.map(item => toReel(item.id, item.data)); emit(); },
    onError
  );
  const stopShared = uid ? listenWithFallback(
    query(reels, where('allowedViewers', 'array-contains', uid), orderBy('createdAt', 'desc'), limit(150)),
    query(reels, where('allowedViewers', 'array-contains', uid), limit(300)),
    docs => { buckets.mine = docs.map(item => toReel(item.id, item.data)); emit(); },
    () => { /* private reels are optional */ }
  ) : () => {};
  return () => { stopPublic(); stopShared(); };
}

export async function getReel(id: string): Promise<Reel | null> {
  try {
    const snapshot = await getDoc(doc(db, 'reels', id));
    return snapshot.exists() ? toReel(snapshot.id, snapshot.data()) : null;
  } catch {
    return null;
  }
}

export async function deleteReel(id: string): Promise<void> {
  await deleteDoc(doc(db, 'reels', id));
}

const viewedThisSession = new Set<string>();
export function recordReelView(id: string): void {
  if (viewedThisSession.has(id)) return;
  viewedThisSession.add(id);
  void updateDoc(doc(db, 'reels', id), { views: increment(1) }).catch(() => viewedThisSession.delete(id));
}

// likes
export function listenMyReelLikes(uid: string, onIds: (ids: Set<string>) => void): Unsubscribe {
  if (!uid) { onIds(new Set()); return () => {}; }
  return onSnapshot(query(collection(db, 'reelLikes'), where('userId', '==', uid)), snapshot => onIds(new Set(snapshot.docs.map(item => str(item.data().reelId)))), () => onIds(new Set()));
}
export async function setReelLike(reelId: string, uid: string, liked: boolean): Promise<void> {
  const batch = writeBatch(db);
  const likeRef = doc(db, 'reelLikes', `${reelId}_${uid}`);
  if (liked) batch.set(likeRef, { reelId, userId: uid, createdAt: Date.now() }); else batch.delete(likeRef);
  batch.update(doc(db, 'reels', reelId), { likesCount: increment(liked ? 1 : -1) });
  await batch.commit();
}

// saves
export function listenMyReelSaves(uid: string, onIds: (ids: Set<string>) => void): Unsubscribe {
  if (!uid) { onIds(new Set()); return () => {}; }
  return onSnapshot(query(collection(db, 'reelSaves'), where('userId', '==', uid)), snapshot => onIds(new Set(snapshot.docs.map(item => str(item.data().reelId)))), () => onIds(new Set()));
}
export async function setReelSave(reelId: string, uid: string, saved: boolean): Promise<void> {
  const ref = doc(db, 'reelSaves', `${reelId}_${uid}`);
  if (saved) await setDoc(ref, { reelId, userId: uid, savedAt: Date.now() }); else await deleteDoc(ref);
}

// comments (+ replies + comment likes)
export function listenReelComments(reelId: string, onComments: (comments: ReelComment[]) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'reelComments'), where('reelId', '==', reelId)), snapshot => {
    onComments(snapshot.docs.map(item => {
      const data = item.data();
      return { id: item.id, reelId: str(data.reelId), parentId: str(data.parentId), authorId: str(data.authorId), authorName: str(data.authorName) || 'EChat user', authorAvatar: str(data.authorAvatar), text: str(data.text), likesCount: Math.max(0, num(data.likesCount)), createdAt: num(data.createdAt) };
    }).sort((a, b) => a.createdAt - b.createdAt));
  }, onError);
}
export async function addReelComment(reelId: string, author: { id: string; name: string; avatar: string }, text: string, parentId = ''): Promise<void> {
  const body = text.trim().slice(0, 500);
  if (!body) throw new Error('Write a comment first.');
  const commentRef = doc(collection(db, 'reelComments'));
  const batch = writeBatch(db);
  batch.set(commentRef, { reelId, parentId, authorId: author.id, authorName: author.name.slice(0, 120), authorAvatar: author.avatar.slice(0, 1000), text: body, likesCount: 0, createdAt: Date.now() });
  batch.update(doc(db, 'reels', reelId), { commentsCount: increment(1), lastCommentId: commentRef.id });
  await batch.commit();
}
export function listenMyCommentLikes(uid: string, onIds: (ids: Set<string>) => void): Unsubscribe {
  if (!uid) { onIds(new Set()); return () => {}; }
  return onSnapshot(query(collection(db, 'reelCommentLikes'), where('userId', '==', uid)), snapshot => onIds(new Set(snapshot.docs.map(item => str(item.data().commentId)))), () => onIds(new Set()));
}
export async function setCommentLike(commentId: string, uid: string, liked: boolean): Promise<void> {
  const batch = writeBatch(db);
  const likeRef = doc(db, 'reelCommentLikes', `${commentId}_${uid}`);
  if (liked) batch.set(likeRef, { commentId, userId: uid, createdAt: Date.now() }); else batch.delete(likeRef);
  batch.update(doc(db, 'reelComments', commentId), { likesCount: increment(liked ? 1 : -1) });
  await batch.commit();
}

// ---------------- sounds ----------------

let seedPromise: Promise<void> | null = null;
/** Creates the built-in sounds in Firestore the first time anyone opens the sound library. */
export function ensureSoundsSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      const existing = new Set((await getDocs(collection(db, 'sounds'))).docs.map(item => item.id));
      const missing = ALL_CATALOG_SOUNDS.filter(sound => !existing.has(sound.id));
      for (const sound of missing) {
        await setDoc(doc(db, 'sounds', sound.id), { name: sound.name, artist: sound.artist, audioUrl: sound.audioUrl, useCount: 0, trending: sound.trending, category: sound.category }).catch(() => {});
      }
    })().catch(error => { seedPromise = null; console.warn('[Sounds] Could not seed sounds', error); });
  }
  return seedPromise;
}
export function listenSoundUseCounts(onCounts: (counts: Map<string, number>) => void): Unsubscribe {
  return onSnapshot(collection(db, 'sounds'), snapshot => onCounts(new Map(snapshot.docs.map(item => [item.id, Math.max(0, num(item.data().useCount))]))), () => onCounts(new Map()));
}
export async function bumpSoundUse(soundId: string): Promise<void> {
  if (!ALL_CATALOG_SOUNDS.some(sound => sound.id === soundId)) return;
  await updateDoc(doc(db, 'sounds', soundId), { useCount: increment(1) }).catch(() => {});
}

export function listenSavedSounds(uid: string, onSounds: (sounds: SavedSound[]) => void): Unsubscribe {
  if (!uid) { onSounds([]); return () => {}; }
  return onSnapshot(query(collection(db, 'savedSounds'), where('userId', '==', uid)), snapshot => onSounds(snapshot.docs.map(item => {
    const data = item.data();
    return { soundId: str(data.soundId), name: str(data.name), artist: str(data.artist), audioUrl: str(data.audioUrl), savedAt: num(data.savedAt) };
  }).sort((a, b) => b.savedAt - a.savedAt)), () => onSounds([]));
}
const savedSoundDocId = (uid: string, soundId: string) => `${uid}_${soundId.replace(/[^A-Za-z0-9_-]/g, '')}`;
export async function saveSound(uid: string, sound: Pick<SoundInfo, 'id' | 'name' | 'artist' | 'audioUrl'>): Promise<void> {
  await setDoc(doc(db, 'savedSounds', savedSoundDocId(uid, sound.id)), { userId: uid, soundId: sound.id, name: sound.name.slice(0, 120), artist: sound.artist.slice(0, 120), audioUrl: sound.audioUrl.slice(0, 2000), savedAt: Date.now() });
}
export async function unsaveSound(uid: string, soundId: string): Promise<void> {
  await deleteDoc(doc(db, 'savedSounds', savedSoundDocId(uid, soundId)));
}

/** The "sound" a reel uses: picked music, or the reel's own original audio. */
export function reelSound(reel: Pick<Reel, 'id' | 'soundId' | 'soundName' | 'soundArtist' | 'soundUrl' | 'mediaUrl' | 'mediaType' | 'creatorName'>): SoundInfo | null {
  if (reel.soundId && reel.soundUrl) return { id: reel.soundId, name: reel.soundName || 'Sound', artist: reel.soundArtist || '', audioUrl: reel.soundUrl, category: '', trending: false, kind: reel.soundId.startsWith('orig_') ? 'original' : 'music' };
  if (reel.mediaType === 'video' && reel.mediaUrl) return { id: `orig_${reel.id}`, name: `Original Audio - ${reel.creatorName}`, artist: reel.creatorName, audioUrl: reel.mediaUrl, category: 'Original', trending: false, kind: 'original' };
  return null;
}

// ---------------- stories ----------------

export type NewStory = Omit<Story, 'id' | 'views' | 'createdAt' | 'expiresAt'>;

export async function createStory(input: NewStory): Promise<string> {
  const ref = doc(collection(db, 'stories'));
  const now = Date.now();
  await setDoc(ref, clean({ ...input, views: 0, createdAt: now, expiresAt: now + STORY_TTL_MS }));
  if (input.soundId) void bumpSoundUse(input.soundId);
  return ref.id;
}

export function listenStories(uid: string, onStories: (stories: Story[]) => void, onError: (error: Error) => void): Unsubscribe {
  if (!uid) { onStories([]); return () => {}; }
  const stories = collection(db, 'stories');
  const now = Date.now();
  return listenWithFallback(
    query(stories, where('allowedViewers', 'array-contains', uid), where('expiresAt', '>', now)),
    query(stories, where('allowedViewers', 'array-contains', uid), limit(300)),
    docs => onStories(docs.map(item => toStory(item.id, item.data)).filter(story => story.expiresAt > Date.now()).sort((a, b) => a.createdAt - b.createdAt)),
    onError
  );
}

const storyViewedThisSession = new Set<string>();
export function recordStoryView(id: string): void {
  if (storyViewedThisSession.has(id)) return;
  storyViewedThisSession.add(id);
  void updateDoc(doc(db, 'stories', id), { views: increment(1) }).catch(() => storyViewedThisSession.delete(id));
}
export async function deleteStory(id: string): Promise<void> {
  await deleteDoc(doc(db, 'stories', id));
}

/** Poll / emoji-slider responses on a story (one per viewer per story). */
export async function voteOnStory(story: Pick<Story, 'id' | 'userId'>, uid: string, kind: 'poll' | 'slider', value: number): Promise<void> {
  await setDoc(doc(db, 'storyVotes', `${story.id}_${uid}`), { storyId: story.id, ownerId: story.userId, userId: uid, kind, value, createdAt: Date.now() });
}
export function listenStoryVotes(storyId: string, onVotes: (votes: { userId: string; kind: string; value: number }[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'storyVotes'), where('storyId', '==', storyId)), snapshot => onVotes(snapshot.docs.map(item => ({ userId: str(item.data().userId), kind: str(item.data().kind), value: num(item.data().value) }))), () => onVotes([]));
}

/** Story doc for sharing an existing reel to "My Story". */
export function storyFromReel(reel: Reel, owner: { id: string; name: string; avatar: string; friends: string[] }): NewStory {
  return {
    ...toEdit(reel),
    userId: owner.id,
    userName: owner.name,
    userAvatar: owner.avatar,
    mediaUrl: reel.duetOf ? reel.mediaUrl : reel.mediaUrl,
    mediaType: reel.mediaType,
    coverUrl: reel.coverUrl,
    stickers: [],
    allowedViewers: storyViewers(owner),
    fromReelId: reel.id
  };
}
export const storyViewers = (owner: { id: string; friends: string[] }) => Array.from(new Set([owner.id, ...owner.friends])).slice(0, 2000);
