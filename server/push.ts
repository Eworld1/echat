import { createHash } from 'node:crypto';
import type { Messaging } from 'firebase-admin/messaging';
import { firebaseAdminApp, firestore } from './firebase-admin';

/**
 * Push notifications with Firebase Cloud Messaging (FCM), sent from this server.
 *
 * Messages, friend requests and group posts live in this server's database (not Firestore), so this
 * server is the one place that sees them happen. FCM sending is free on the Spark plan; a Cloud
 * Function would need the Blaze (billing) plan and could not see these events anyway.
 *
 * Device tokens are stored in Firestore at users/{firebaseUid}/tokens/{sha256(token)}.
 * Messages are data-only: public/sw.js draws the notification, so it works when the app is closed.
 */

let messaging: Messaging | null = null;
if (firebaseAdminApp) {
  try {
    const sdk = await import('firebase-admin/messaging');
    messaging = sdk.getMessaging(firebaseAdminApp);
  } catch (error) {
    console.warn('[Push] Firebase Messaging could not start:', error instanceof Error ? error.message : error);
  }
} else {
  console.warn('[Push] FIREBASE_SERVICE_ACCOUNT_JSON is unset; push notifications are disabled.');
}

export const pushReady = () => Boolean(messaging && firestore);

export type PushKind = 'message' | 'friend_request' | 'friend_accept' | 'group_post' | 'activity';

export interface PushPayload {
  kind: PushKind;
  title: string;
  body: string;
  /** Path opened when the notification is tapped, e.g. /messages?chat=<id>. */
  url: string;
  /** Same tag replaces the previous notification (one per chat / per group). */
  tag: string;
  icon?: string;
  /** Unread count shown on the app icon. */
  badge?: number;
}

const TOKEN_PATTERN = /^[\w:.-]{20,4096}$/;
const MAX_TOKENS_PER_USER = 10;
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument'
]);

const tokenId = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 40);
const tokensOf = (uid: string) => firestore!.collection('users').doc(uid).collection('tokens');

export function isValidPushToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

/** Save (or refresh) this device's token for the signed-in user. */
export async function savePushToken(uid: string, token: string, info: { platform?: string; userAgent?: string }): Promise<void> {
  if (!pushReady()) throw new Error('Push notifications are not configured on the server.');
  const now = Date.now();
  const ref = tokensOf(uid).doc(tokenId(token));
  const existing = await ref.get();
  await ref.set({
    token,
    platform: info.platform === 'pwa' ? 'pwa' : 'browser',
    userAgent: String(info.userAgent || '').slice(0, 300),
    createdAt: existing.exists ? existing.get('createdAt') ?? now : now,
    updatedAt: now
  });
  // Keep only the newest few devices per person.
  const all = await tokensOf(uid).orderBy('updatedAt', 'desc').get();
  await Promise.all(all.docs.slice(MAX_TOKENS_PER_USER).map(doc => doc.ref.delete()));
}

/** Forget this device's token (notifications turned off, or logging out). */
export async function removePushToken(uid: string, token: string): Promise<void> {
  if (!pushReady()) return;
  await tokensOf(uid).doc(tokenId(token)).delete();
}

/** Send a push to every device of these users. Never throws: a failed push must not break the request. */
export async function sendPush(uids: string[], payload: PushPayload): Promise<void> {
  if (!pushReady() || uids.length === 0) return;
  const data: Record<string, string> = {
    kind: payload.kind,
    title: payload.title.slice(0, 120),
    body: payload.body.slice(0, 240),
    url: payload.url,
    tag: payload.tag,
    icon: payload.icon || '/logo-192.png',
    ...(payload.badge !== undefined ? { badge: String(payload.badge) } : {})
  };
  await Promise.all([...new Set(uids)].map(async uid => {
    try {
      const snapshot = await tokensOf(uid).get();
      const docs = snapshot.docs.filter(doc => isValidPushToken(doc.get('token')));
      if (docs.length === 0) return;
      const result = await messaging!.sendEachForMulticast({
        tokens: docs.map(doc => doc.get('token') as string),
        data,
        webpush: { headers: { Urgency: 'high', TTL: String(24 * 60 * 60) } }
      });
      await Promise.all(result.responses.map((response, index) => {
        const code = response.error?.code;
        return code && DEAD_TOKEN_CODES.has(code) ? docs[index].ref.delete() : null;
      }));
    } catch (error) {
      console.warn('[Push] Could not send to', uid, error instanceof Error ? error.message : error);
    }
  }));
}
