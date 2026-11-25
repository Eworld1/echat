/**
 * Facebook-style author info: cards show the LIVE name/photo (see /api/users-public + the
 * 'user_updated' socket event). Older Firestore documents still carry a copied name/photo from the
 * moment they were created, so whenever someone changes their name or picture we rewrite those
 * copies too (Admin SDK; app users cannot edit other fields of these documents under the rules).
 */
import type { Firestore, Query, DocumentReference, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { User } from './types.js';

export interface PublicProfile { id: string; name: string; avatar: string; isVerified: boolean; isOfficialDeveloper: boolean; role: string }

export function publicProfile(user: User): PublicProfile {
  return {
    id: user.id,
    name: user.name || 'EChat user',
    avatar: user.avatar || '',
    isVerified: user.isVerified === true,
    isOfficialDeveloper: user.isOfficialDeveloper === true,
    role: user.role || 'user'
  };
}

/** Embedded copies are capped at 2000 characters by the Firestore rules; never write a longer avatar. */
const embeddableAvatar = (avatar: string) => (avatar && avatar.length <= 2000 ? avatar : '');

/** Where each Firestore collection keeps the copied author fields. */
const TARGETS = [
  { collection: 'posts', idField: 'userId', nameField: 'userName', avatarField: '' },
  { collection: 'stories', idField: 'userId', nameField: 'userName', avatarField: 'userAvatar' },
  { collection: 'reels', idField: 'creatorId', nameField: 'creatorName', avatarField: 'creatorAvatar' },
  { collection: 'reelComments', idField: 'authorId', nameField: 'authorName', avatarField: 'authorAvatar' },
  { collection: 'storyComments', idField: 'authorId', nameField: 'authorName', avatarField: 'authorAvatar' }
] as const;
const POST_COMMENT = { idField: 'userId', nameField: 'userName', avatarField: 'userAvatar' } as const;

type Fields = { idField: string; nameField: string; avatarField: string };

class Writer {
  private batch;
  private count = 0;
  updated = 0;
  constructor(private readonly fs: Firestore) { this.batch = fs.batch(); }
  async update(ref: DocumentReference, data: Record<string, unknown>) {
    this.batch.update(ref, data);
    this.updated++;
    if (++this.count >= 400) await this.flush();
  }
  async flush() {
    if (!this.count) return;
    await this.batch.commit();
    this.batch = this.fs.batch();
    this.count = 0;
  }
}

function changes(data: Record<string, unknown>, fields: Fields, name: string, avatar: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (name && data[fields.nameField] !== name) out[fields.nameField] = name.slice(0, 100);
  if (fields.avatarField && data[fields.avatarField] !== avatar) out[fields.avatarField] = avatar;
  return Object.keys(out).length ? out : null;
}

async function fixQuery(writer: Writer, query: Query, fields: Fields, name: string, avatar: string) {
  const snapshot = await query.get();
  for (const item of snapshot.docs) {
    const update = changes(item.data(), fields, name, avatar);
    if (update) await writer.update(item.ref, update);
  }
}

/** Rewrite every copied name/photo of one person. Safe to call repeatedly (only changed docs are written). */
export async function refreshEmbeddedProfile(fs: Firestore | null, uid: string, profile: { name: string; avatar: string }): Promise<number> {
  if (!fs || !uid || !profile.name) return 0;
  const name = profile.name.trim().slice(0, 100);
  const avatar = embeddableAvatar(profile.avatar || '');
  const writer = new Writer(fs);
  for (const target of TARGETS) {
    try { await fixQuery(writer, fs.collection(target.collection).where(target.idField, '==', uid), target, name, avatar); }
    catch (error) { console.warn(`[profileSync] ${target.collection}:`, error instanceof Error ? error.message : error); }
  }
  // Comments on "updated their profile picture" posts: posts/{postId}/comments/{id}.
  try {
    const group = await fs.collectionGroup('comments').where('userId', '==', uid).get();
    for (const item of group.docs) {
      if (item.ref.parent.parent?.parent.id !== 'posts') continue;
      const update = changes(item.data(), POST_COMMENT, name, avatar);
      if (update) await writer.update(item.ref, update);
    }
  } catch {
    // No collection-group index: walk the profile-picture posts instead.
    const posts = await fs.collection('posts').where('type', '==', 'profile_picture_update').get().catch(() => null);
    for (const post of posts?.docs || []) {
      await fixQuery(writer, post.ref.collection('comments').where('userId', '==', uid), POST_COMMENT, name, avatar).catch(() => {});
    }
  }
  await writer.flush();
  return writer.updated;
}

/**
 * One-time clean-up of documents created before live author info: every copied name/photo is set
 * to what the person's profile says now. Guarded by meta/migrations so it runs once per project.
 */
export async function migrateEmbeddedProfilesOnce(fs: Firestore | null, lookup: (uid: string) => User | undefined): Promise<void> {
  if (!fs) return;
  const flagRef = fs.collection('meta').doc('migrations');
  const KEY = 'embeddedProfiles_v1';
  try {
    const flag = await flagRef.get();
    if (flag.exists && flag.data()?.[KEY]?.doneAt) return;
    await flagRef.set({ [KEY]: { startedAt: Date.now() } }, { merge: true });
    const writer = new Writer(fs);
    const fix = async (docs: QueryDocumentSnapshot[], fields: Fields) => {
      for (const item of docs) {
        const data = item.data();
        const user = lookup(String(data[fields.idField] || ''));
        if (!user?.name) continue;
        const update = changes(data, fields, user.name, embeddableAvatar(user.avatar || ''));
        if (update) await writer.update(item.ref, update);
      }
    };
    for (const target of TARGETS) {
      const query = target.collection === 'posts' ? fs.collection('posts').where('type', '==', 'profile_picture_update') : fs.collection(target.collection);
      const snapshot = await query.get().catch(() => null);
      if (!snapshot) continue;
      await fix(snapshot.docs, target);
      if (target.collection === 'posts') {
        for (const post of snapshot.docs) {
          const comments = await post.ref.collection('comments').get().catch(() => null);
          if (comments) await fix(comments.docs, POST_COMMENT);
        }
      }
    }
    await writer.flush();
    await flagRef.set({ [KEY]: { doneAt: Date.now(), updated: writer.updated } }, { merge: true });
    console.log(`[profileSync] One-time name/photo clean-up finished: ${writer.updated} documents updated.`);
  } catch (error) {
    console.warn('[profileSync] One-time clean-up failed (will retry next start):', error instanceof Error ? error.message : error);
    await flagRef.set({ [KEY]: null }, { merge: true }).catch(() => {});
  }
}
