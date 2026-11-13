import type { IncomingMessage, ServerResponse } from 'node:http';
import type { App } from 'firebase-admin/app';
import type { CollectionReference, Firestore } from 'firebase-admin/firestore';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { importX509, jwtVerify, type JWTPayload } from 'jose';

export type ApiRequest = IncomingMessage & { body?: any; query?: Record<string, string | string[] | undefined> };
export type ApiResponse = ServerResponse;

const configuredOrigins = (process.env.CORS_ORIGIN || 'https://echat-ivory.vercel.app')
  .split(',')
  .map(origin => origin.trim())
  .filter(origin => origin && origin !== '*');
const vercelOrigin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';

export function applyLiveCors(req: ApiRequest, res: ApiResponse): void {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  if (origin && (configuredOrigins.includes(origin) || origin === vercelOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-firebase-id-token, x-live-auth-token, x-user-id');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function handleLiveOptions(req: ApiRequest, res: ApiResponse): boolean {
  if (req.method !== 'OPTIONS') return false;
  applyLiveCors(req, res);
  res.statusCode = 204;
  res.end();
  return true;
}

const projectId = (process.env.FIREBASE_PROJECT_ID || 'echat-studio-6e215').trim();
const rawCredential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() || '';
let adminApp: App | null = null;
let firestoreInstance: Firestore | null = null;
if (rawCredential) {
  try {
    const parsed = JSON.parse(rawCredential.startsWith('{') ? rawCredential : Buffer.from(rawCredential, 'base64').toString('utf8'));
    if (typeof parsed.private_key === 'string') parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    const [appSdk, firestoreSdk] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/firestore')]);
    const appName = 'echat-vercel-live-service-account';
    adminApp = appSdk.getApps().find(app => app.name === appName) || appSdk.initializeApp({ projectId, credential: appSdk.cert(parsed) }, appName);
    firestoreInstance = firestoreSdk.getFirestore(adminApp, process.env.FIREBASE_DATABASE_ID || 'ai-studio-echat-134f096e-b18d-4bb7-870d-d4f7fa96d17d');
  } catch (error) {
    console.warn('[Vercel Live API] FIREBASE_SERVICE_ACCOUNT_JSON is invalid; Firestore live APIs will return a configuration error.', error instanceof Error ? error.message : error);
  }
} else {
  console.warn('[Vercel Live API] FIREBASE_SERVICE_ACCOUNT_JSON is unset; ADC is disabled and Firestore live APIs are unavailable.');
}

function requireFirestore(): Firestore {
  if (!firestoreInstance) throw Object.assign(new Error('Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON for live stream storage.'), { status: 503, code: 'firebase-admin-not-configured' });
  return firestoreInstance;
}
// Lazy proxies keep missing production secrets from crashing module initialization/build.
const firestore = new Proxy({} as Firestore, {
  get(_target, property) {
    const target = requireFirestore();
    const value = Reflect.get(target, property, target) as unknown;
    return typeof value === 'function' ? value.bind(target) : value;
  }
});
const lives = new Proxy({} as CollectionReference, {
  get(_target, property) {
    const target = requireFirestore().collection('liveStreams');
    const value = Reflect.get(target, property, target) as unknown;
    return typeof value === 'function' ? value.bind(target) : value;
  }
});
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

type FirebaseIdToken = JWTPayload & {
  email?: string;
  email_verified?: boolean;
  name?: string;
  auth_time?: number;
};

let firebaseCerts: { values: Record<string, string>; expiresAt: number } | undefined;

async function getFirebaseCerts(): Promise<Record<string, string>> {
  if (firebaseCerts && firebaseCerts.expiresAt > Date.now()) return firebaseCerts.values;

  const response = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  if (!response.ok) throw Object.assign(new Error('Could not verify the Firebase sign-in token.'), { status: 503, code: 'firebase-certificates-unavailable' });

  const values = await response.json() as Record<string, string>;
  const cacheControl = response.headers.get('cache-control') || '';
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] || 3600);
  firebaseCerts = { values, expiresAt: Date.now() + Math.max(60, maxAge) * 1000 };
  return values;
}

async function verifyFirebaseIdToken(token: string): Promise<FirebaseIdToken & { uid: string }> {
  const peek = JSON.parse(Buffer.from(token.split('.')[0] || '', 'base64url').toString('utf8')) as { kid?: string; alg?: string };
  if (peek.alg !== 'RS256' || !peek.kid) throw Object.assign(new Error('The Firebase sign-in token is invalid.'), { status: 401, code: 'invalid-token' });
  const certificates = await getFirebaseCerts();
  const certificate = certificates[peek.kid];
  if (!certificate) {
    firebaseCerts = undefined;
    throw Object.assign(new Error('The Firebase signing key is no longer valid. Please sign in again.'), { status: 401, code: 'unknown-signing-key' });
  }

  const key = await importX509(certificate, 'RS256');
  const { payload } = await jwtVerify(token, key, {
    algorithms: ['RS256'],
    audience: projectId,
    issuer: `https://securetoken.google.com/${projectId}`
  });
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) {
    throw Object.assign(new Error('The Firebase sign-in token has no valid user.'), { status: 401, code: 'invalid-token-subject' });
  }
  return { ...payload, uid: payload.sub } as FirebaseIdToken & { uid: string };
}

export function sendJson(res: ApiResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

export async function verifyLiveUser(req: ApiRequest): Promise<{ user: LiveUser; decoded: FirebaseIdToken & { uid: string } }> {
  const authorization = getHeader(req, 'authorization').replace(/^Bearer\s+/i, '');
  const token = getHeader(req, 'x-firebase-id-token') || getHeader(req, 'x-live-auth-token') || authorization;
  if (!token) throw Object.assign(new Error('Sign in to use Go Live.'), { status: 401, code: 'missing-token' });

  let decoded: FirebaseIdToken & { uid: string };
  try {
    decoded = await verifyFirebaseIdToken(token);
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) throw error;
    throw Object.assign(new Error('The Firebase sign-in token is invalid or expired. Please sign in again.'), { status: 401, code: 'invalid-token' });
  }
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
