/**
 * "[Name] updated their profile picture" feed posts, Facebook style.
 *
 * Firestore: posts/pp_{uid}_{photoHash}
 *   type: 'profile_picture_update', userId, userName, newPhotoURL, oldPhotoURL, createdAt (ms),
 *   likes: string[] (uids), comments: number   + subcollection posts/{id}/comments
 *
 * The id contains a hash of the picture itself, so uploading the same picture again never creates a
 * second post (the rules also refuse it).
 */
import {
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit,
  arrayUnion, arrayRemove, increment, writeBatch, type Unsubscribe
} from 'firebase/firestore';
import { firestore } from './firebase';
import { assetUrl } from './apiBase';
import { api } from './api';

export const PROFILE_PICTURE_UPDATE = 'profile_picture_update';

export interface ProfilePhotoPost {
  id: string;
  type: typeof PROFILE_PICTURE_UPDATE;
  userId: string;
  userName: string;
  newPhotoURL: string;
  oldPhotoURL: string;
  createdAt: number;
  likes: string[];
  comments: number;
}

export interface ProfilePhotoComment {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  text: string;
  createdAt: number;
}

const posts = () => collection(firestore, 'posts');

function toPost(id: string, data: Record<string, unknown>): ProfilePhotoPost {
  return {
    id,
    type: PROFILE_PICTURE_UPDATE,
    userId: String(data.userId || ''),
    userName: String(data.userName || 'EChat user'),
    newPhotoURL: String(data.newPhotoURL || ''),
    oldPhotoURL: String(data.oldPhotoURL || ''),
    createdAt: Number(data.createdAt) || 0,
    likes: Array.isArray(data.likes) ? data.likes.map(String) : [],
    comments: Math.max(0, Number(data.comments) || 0)
  };
}

async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Fingerprint of a picture: a hash of the image bytes (so re-uploading the same photo matches even
 * though the upload URL is new), or of the URL when the image can't be downloaded.
 */
export async function photoFingerprint(url: string): Promise<string> {
  try {
    const response = await fetch(assetUrl(url), { mode: 'cors', cache: 'force-cache' });
    if (response.ok) return (await sha256Hex(await response.arrayBuffer())).slice(0, 32);
  } catch { /* fall back to the URL */ }
  // Cloudinary adds a version segment (/v1712345/) that changes on every upload of the same file.
  const normalised = url.trim().replace(/\/v\d+\//, '/').split('?')[0];
  return (await sha256Hex(new TextEncoder().encode(normalised))).slice(0, 32);
}

export const profilePhotoPostId = (uid: string, fingerprint: string) => `pp_${uid}_${fingerprint}`;

/**
 * Call when a user's profile picture changes. Creates the public feed post, unless this exact
 * picture was already posted. Returns the post, or null when nothing was created.
 */
export async function onProfilePictureChanged(user: { id: string; name: string }, newPhotoURL: string, oldPhotoURL = ''): Promise<ProfilePhotoPost | null> {
  const fresh = String(newPhotoURL || '').trim();
  if (!user?.id || !/^https:\/\//i.test(fresh) || fresh === String(oldPhotoURL || '').trim()) return null;
  const id = profilePhotoPostId(user.id, await photoFingerprint(fresh));
  const ref = doc(posts(), id);
  const existing = await getDoc(ref).catch(() => null);
  if (existing?.exists()) return null;
  const data = {
    type: PROFILE_PICTURE_UPDATE,
    userId: user.id,
    userName: String(user.name || 'EChat user').slice(0, 100),
    newPhotoURL: fresh.slice(0, 2000),
    oldPhotoURL: /^https?:\/\//i.test(oldPhotoURL || '') ? String(oldPhotoURL).slice(0, 2000) : '',
    createdAt: Date.now(),
    likes: [] as string[],
    comments: 0
  };
  await setDoc(ref, data);
  return toPost(id, data);
}

/** Newest profile-picture posts, live. */
export function listenProfilePhotoPosts(onChange: (items: ProfilePhotoPost[]) => void, max = 20): Unsubscribe {
  const map = (docs: { id: string; data: () => Record<string, unknown> }[]) =>
    docs.map(item => toPost(item.id, item.data())).filter(item => item.newPhotoURL).sort((a, b) => b.createdAt - a.createdAt);
  let fallback: Unsubscribe | null = null;
  const primary = onSnapshot(
    query(posts(), where('type', '==', PROFILE_PICTURE_UPDATE), orderBy('createdAt', 'desc'), limit(max)),
    snapshot => onChange(map(snapshot.docs)),
    error => {
      // Composite index not deployed yet: same data without server-side ordering.
      console.warn('Profile photo posts: falling back to unordered query.', error);
      fallback = onSnapshot(query(posts(), where('type', '==', PROFILE_PICTURE_UPDATE), limit(60)), snapshot => onChange(map(snapshot.docs).slice(0, max)), () => onChange([]));
    }
  );
  return () => { primary(); fallback?.(); };
}

export function listenProfilePhotoPost(id: string, onChange: (item: ProfilePhotoPost | null) => void): Unsubscribe {
  return onSnapshot(doc(posts(), id), snapshot => onChange(snapshot.exists() ? toPost(snapshot.id, snapshot.data()) : null), () => onChange(null));
}

/** The post for the picture a user has now (used by the full-screen viewer for Like / Comment). */
export async function findProfilePhotoPostId(userId: string, photoURL: string): Promise<string | null> {
  if (!userId || !/^https:\/\//i.test(photoURL || '')) return null;
  const id = profilePhotoPostId(userId, await photoFingerprint(photoURL));
  const snapshot = await getDoc(doc(posts(), id)).catch(() => null);
  return snapshot?.exists() ? id : null;
}

export async function setProfilePhotoLike(postId: string, uid: string, liked: boolean): Promise<void> {
  await updateDoc(doc(posts(), postId), { likes: liked ? arrayUnion(uid) : arrayRemove(uid) });
  if (liked) void api.notifyActivity('photo_like', postId);
}

export function listenProfilePhotoComments(postId: string, onChange: (items: ProfilePhotoComment[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(firestore, 'posts', postId, 'comments'), orderBy('createdAt', 'asc'), limit(200)),
    snapshot => onChange(snapshot.docs.map(item => ({ id: item.id, ...(item.data() as Omit<ProfilePhotoComment, 'id'>) }))),
    () => onChange([])
  );
}

export async function addProfilePhotoComment(postId: string, user: { id: string; name: string; avatar?: string }, text: string): Promise<void> {
  const clean = text.trim().slice(0, 1000);
  if (!clean) return;
  const batch = writeBatch(firestore);
  batch.set(doc(collection(firestore, 'posts', postId, 'comments')), {
    userId: user.id,
    userName: String(user.name || 'EChat user').slice(0, 100),
    userAvatar: /^https?:\/\//i.test(user.avatar || '') ? String(user.avatar).slice(0, 2000) : '',
    text: clean,
    createdAt: Date.now()
  });
  batch.update(doc(posts(), postId), { comments: increment(1) });
  await batch.commit();
  void api.notifyActivity('photo_comment', postId);
}

export async function deleteProfilePhotoComment(postId: string, commentId: string): Promise<void> {
  const batch = writeBatch(firestore);
  batch.delete(doc(firestore, 'posts', postId, 'comments', commentId));
  batch.update(doc(posts(), postId), { comments: increment(-1) });
  await batch.commit();
}

export async function deleteProfilePhotoPost(postId: string): Promise<void> {
  await deleteDoc(doc(posts(), postId));
}

export function profilePhotoPostLink(postId: string): string {
  return `${window.location.origin}/post/${encodeURIComponent(postId)}`;
}
