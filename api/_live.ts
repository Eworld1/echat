import type { IncomingMessage, ServerResponse } from 'node:http';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

export type ApiRequest = IncomingMessage & { body?: any; query?: Record<string, string | string[] | undefined> };
export type ApiResponse = ServerResponse;

const projectId = (process.env.FIREBASE_PROJECT_ID || 'echat-studio-6e215').trim();
const rawCredential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
let serviceCredential: ReturnType<typeof cert> | undefined;
if (rawCredential) {
  try {
    const parsed = JSON.parse(rawCredential.startsWith('{') ? rawCredential : Buffer.from(rawCredential, 'base64').toString('utf8'));
    if (typeof parsed.private_key === 'string') parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    serviceCredential = cert(parsed);
  } catch (error) {
    console.error('[Vercel Live API] Invalid FIREBASE_SERVICE_ACCOUNT_JSON', error);
  }
}

const adminApp = getApps()[0] || initializeApp({ projectId, ...(serviceCredential ? { credential: serviceCredential } : {}) });
const auth = getAuth(adminApp);
const firestore = getFirestore(adminApp, process.env.FIREBASE_DATABASE_ID || 'ai-studio-echat-134f096e-b18d-4bb7-870d-d4f7fa96d17d');
const lives = firestore.collection('liveStreams');
const liveKitUrl = (process.env.LIVEKIT_URL || '').trim();
const liveKitApiKey = (process.env.LIVEKIT_API_KEY || '').trim();
const liveKitApiSecret = (process.env.LIVEKIT_API_SECRET || '').trim();

export interface LiveUser {
  uid: string;
  email: string;
  name: string;
  avatar: string;
  role: string;
  liveAccess: string;
  isVerified: boolean;
  isBlocked: boolean;
  createdAt: number;
}

function getHeader(req: ApiRequest, key: string): string {
  const value = req.headers[key.toLowerCase()];
  return Array.isArray(value) ? value[0] || '' : value || '';
}

export function sendJson(res: ApiResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

export async function verifyLiveUser(req: ApiRequest): Promise<{ user: LiveUser; decoded: Awaited<ReturnType<typeof auth.verifyIdToken>> }> {
  const authorization = getHeader(req, 'authorization').replace(/^Bearer\s+/i, '');
  const token = getHeader(req, 'x-firebase-id-token') || getHeader(req, 'x-live-auth-token') || authorization;
  if (!token) throw Object.assign(new Error('Sign in to use Go Live.'), { status: 401, code: 'missing-token' });

  const decoded = await auth.verifyIdToken(token, true);
  const email = String(decoded.email || '').trim().toLowerCase();
  const developerUid = String(process.env.SUPER_ADMIN_UID || process.env.VITE_SUPER_ADMIN_UID || '').trim();
  const developerEmail = String(process.env.SUPER_ADMIN_EMAIL || process.env.VITE_SUPER_ADMIN_EMAIL || 'eldermoses89@gmail.com').trim().toLowerCase();
  const developer = Boolean((developerUid && decoded.uid === developerUid) || (email && email === developerEmail && decoded.email_verified));

  if (developer) {
    return {
      decoded,
      user: {
        uid: decoded.uid,
        email,
        name: String(decoded.name || 'Echat Developer'),
        avatar: '',
        role: 'super_admin',
        liveAccess: 'approved',
        isVerified: true,
        isBlocked: false,
        createdAt: 0
      }
    };
  }

  const snapshot = await firestore.collection('users').doc(decoded.uid).get();
  const data = snapshot.exists ? snapshot.data() || {} : {};
  if (!snapshot.exists && !developer) throw Object.assign(new Error('Your Echat profile was not found.'), { status: 403, code: 'profile-not-found' });
  const created = data.createdAt;
  const createdAt = typeof created === 'number' ? created : typeof created?.toMillis === 'function' ? created.toMillis() : 0;
  const authCreated = Date.parse(decoded.auth_time ? new Date(decoded.auth_time * 1000).toISOString() : '');
  return {
    decoded,
    user: {
      uid: decoded.uid,
      email,
      name: String(data.name || decoded.name || (developer ? 'Echat Developer' : 'Echat User')),
      avatar: String(data.avatar || ''),
      role: String(data.role || 'user'),
      liveAccess: String(data.liveAccess || 'none'),
      isVerified: Boolean(data.isVerified),
      isBlocked: Boolean(data.isBlocked),
      createdAt: createdAt || (Number.isFinite(authCreated) ? authCreated : 0)
    }
  };
}

export function canStartLive(user: LiveUser): boolean {
  if (user.isBlocked || user.liveAccess === 'blocked') return false;
  if (user.role === 'super_admin' || user.role === 'developer' || user.role === 'admin') return true;
  if (user.liveAccess === 'approved') return true;
  return user.createdAt > 0 && Date.now() - user.createdAt >= 60 * 24 * 60 * 60 * 1000;
}

export function requireLiveKit(): { url: string; rooms: RoomServiceClient; apiKey: string; apiSecret: string } {
  if (!liveKitUrl || !liveKitApiKey || !liveKitApiSecret) {
    throw Object.assign(new Error('Live video is not configured. Add LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET to Vercel Production.'), { status: 503, code: 'livekit-not-configured' });
  }
  const apiHost = liveKitUrl.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
  return { url: liveKitUrl, rooms: new RoomServiceClient(apiHost, liveKitApiKey, liveKitApiSecret), apiKey: liveKitApiKey, apiSecret: liveKitApiSecret };
}

export async function createRoomToken(user: LiveUser, roomName: string, canPublish: boolean): Promise<string> {
  const lk = requireLiveKit();
  const token = new AccessToken(lk.apiKey, lk.apiSecret, { identity: user.uid, name: user.name, ttl: '2h' });
  token.addGrant({ roomJoin: true, room: roomName, canPublish, canSubscribe: true, canPublishData: true });
  return token.toJwt();
}

export async function handleError(res: ApiResponse, error: unknown, label: string): Promise<void> {
  const value = error as { status?: number; code?: string; message?: string };
  const status = Number.isInteger(value?.status) ? value.status! : 500;
  const code = value?.code || 'internal-error';
  console.error(`[Vercel Live API] ${label}`, { status, code, error: error instanceof Error ? error.stack || error.message : error });
  sendJson(res, status, { error: value?.message || 'The live request failed.', code });
}

export { firestore, lives, liveKitUrl };
