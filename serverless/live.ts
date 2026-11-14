import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
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
const databaseId = (process.env.FIREBASE_DATABASE_ID || 'ai-studio-echat-134f096e-b18d-4bb7-870d-d4f7fa96d17d').trim();
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
    firestoreInstance = firestoreSdk.getFirestore(adminApp, databaseId);
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

type StoredLiveProfile = Record<string, any>;
let mongoConnectPromise: Promise<void> | null = null;

async function getMongoUsersCollection() {
  const uri = process.env.MONGO_URI?.trim();
  if (!uri) return null;
  const mongoose = (await import('mongoose')).default;
  if (mongoose.connection.readyState !== 1) {
    if (!mongoConnectPromise) {
      mongoConnectPromise = mongoose.connect(uri, { serverSelectionTimeoutMS: 7000, maxPoolSize: 2 })
        .then(() => undefined)
        .catch(error => { mongoConnectPromise = null; throw error; });
    }
    await mongoConnectPromise;
  }
  const collection = mongoose.connection.db?.collection('echat_users');
  if (!collection) throw new Error('MongoDB echat_users collection is unavailable.');
  return collection;
}

function toTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (value && typeof value === 'object' && 'toMillis' in value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const result = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(result) && result > 0 ? result : 0;
  }
  return 0;
}

function createProfileFields(data: StoredLiveProfile, uid: string, email: string, isDeveloper: boolean): StoredLiveProfile {
  const name = String(data.name || '').trim() || email.split('@')[0] || 'Echat User';
  return {
    id: uid,
    name,
    email,
    avatar: String(data.avatar || data.photoURL || ''),
    coverPhoto: String(data.coverPhoto || ''),
    bio: String(data.bio || 'Excited to be on Echat! 👋'),
    location: String(data.location || 'Global'),
    work: String(data.work || ''),
    education: String(data.education || ''),
    role: isDeveloper ? 'super_admin' : String(data.role || 'user'),
    liveAccess: isDeveloper ? 'approved' : String(data.liveAccess || 'none'),
    isVerified: Boolean(data.isVerified),
    isOfficialDeveloper: isDeveloper || data.isOfficialDeveloper === true,
    isBlocked: !isDeveloper && Boolean(data.isBlocked),
    isOnline: true,
    lastSeen: Date.now(),
    createdAt: toTimestamp(data.createdAt) || Date.now(),
    friends: Array.isArray(data.friends) ? data.friends : [],
    friendRequestsSent: Array.isArray(data.friendRequestsSent) ? data.friendRequestsSent : [],
    friendRequestsReceived: Array.isArray(data.friendRequestsReceived) ? data.friendRequestsReceived : [],
    liveAuthSecret: typeof data.liveAuthSecret === 'string' && data.liveAuthSecret ? data.liveAuthSecret : randomBytes(32).toString('hex')
  };
}

async function findMongoProfile(uid: string, email: string): Promise<{ profile: StoredLiveProfile; matchedUid: string } | null> {
  if (!process.env.MONGO_URI?.trim()) {
    console.warn('[Vercel Live API] Mongo profile lookup skipped: MONGO_URI is not configured.', { tokenUid: uid, database: 'MongoDB', collection: 'echat_users' });
    return null;
  }
  try {
    const collection = await getMongoUsersCollection();
    if (!collection) return null;
    const record = await collection.findOne({ _id: uid } as any)
      || await collection.findOne({ id: uid } as any)
      || (email ? await collection.findOne({ email } as any) : null);
    if (!record) return null;
    const profile = record as StoredLiveProfile;
    const matchedUid = String(profile.id || profile._id || '');
    console.info('[Vercel Live API] Mongo profile lookup', { tokenUid: uid, matchedUid: matchedUid || null, uidMatches: matchedUid === uid, database: 'MongoDB', collection: 'echat_users' });
    return { profile, matchedUid };
  } catch (error) {
    console.error('[Vercel Live API] Mongo profile lookup failed', { tokenUid: uid, database: 'MongoDB', collection: 'echat_users', code: (error as { code?: string })?.code || null, message: error instanceof Error ? error.message : 'unknown error' });
    return null;
  }
}

async function mirrorProfileToMongo(profile: StoredLiveProfile): Promise<void> {
  if (!process.env.MONGO_URI?.trim()) {
    console.warn('[Vercel Live API] Mongo profile mirror skipped: MONGO_URI is not configured.', { uid: profile.id, collection: 'echat_users' });
    return;
  }
  try {
    const collection = await getMongoUsersCollection();
    if (!collection) return;
    const existing = await collection.findOne({ _id: profile.id } as any) || await collection.findOne({ id: profile.id } as any);
    if (existing) return;
    await collection.replaceOne({ _id: profile.id } as any, { ...profile, _id: profile.id }, { upsert: true });
    console.info('[Vercel Live API] Mongo profile created', { uid: profile.id, collection: 'echat_users' });
  } catch (error) {
    console.error('[Vercel Live API] Mongo profile mirror failed', { uid: profile.id, collection: 'echat_users', code: (error as { code?: string })?.code || null, message: error instanceof Error ? error.message : 'unknown error' });
  }
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

  const users = firestore.collection('users');
  const searchedUid = decoded.uid;
  let snapshot = await users.doc(searchedUid).get();
  let data: StoredLiveProfile = snapshot.exists ? snapshot.data() || {} : {};
  if (!snapshot.exists) {
    console.warn('[Vercel Live API] Firestore profile lookup missed; bootstrapping profile', {
      tokenUid: decoded.uid,
      searchedUid,
      database: 'Firestore',
      projectId,
      databaseId
    });

    let source: StoredLiveProfile = {};
    let sourceUid = '';
    let sourceDatabase = 'Firebase ID token';
    const mongoMatch = await findMongoProfile(decoded.uid, email);
    if (mongoMatch) {
      source = mongoMatch.profile;
      sourceUid = mongoMatch.matchedUid;
      sourceDatabase = 'MongoDB echat_users';
    } else if (process.env.MONGO_URI?.trim()) {
      console.info('[Vercel Live API] Mongo profile lookup missed', { tokenUid: decoded.uid, searchedUid: decoded.uid, database: 'MongoDB', collection: 'echat_users' });
    }

    if (!sourceUid && email) {
      try {
        const emailMatch = await users.where('email', '==', email).limit(1).get();
        const match = emailMatch.docs[0];
        if (match) {
          source = match.data();
          sourceUid = String(source.id || match.id);
          sourceDatabase = `Firestore ${databaseId}`;
          console.info('[Vercel Live API] Firestore email fallback', { tokenUid: decoded.uid, matchedUid: sourceUid, uidMatches: sourceUid === decoded.uid, database: 'Firestore', projectId, databaseId });
        }
      } catch (error) {
        console.warn('[Vercel Live API] Firestore email fallback failed', { tokenUid: decoded.uid, searchedUid, database: 'Firestore', projectId, databaseId, code: (error as { code?: string })?.code || null });
      }
    }

    const exactUidMatch = sourceUid === decoded.uid;
    if (sourceUid && !exactUidMatch) {
      console.warn('[Vercel Live API] Profile UID mismatch; copying public profile fields only', {
        tokenUid: decoded.uid,
        searchedUid,
        matchedUid: sourceUid,
        sourceDatabase,
        targetDatabase: `Firestore ${databaseId}`
      });
    }
    const safeSource = exactUidMatch
      ? source
      : {
          name: source.name,
          avatar: source.avatar || source.photoURL,
          coverPhoto: source.coverPhoto,
          bio: source.bio,
          location: source.location
        };
    const profile = createProfileFields({
      ...safeSource,
      name: safeSource.name || decoded.name,
      avatar: safeSource.avatar || (decoded as FirebaseIdToken & { picture?: string }).picture || '',
      email,
      ...(developer ? { role: 'super_admin', liveAccess: 'approved', isOfficialDeveloper: true, isVerified: true, isBlocked: false } : {}),
      ...(!exactUidMatch && !developer ? { role: 'user', liveAccess: 'none', isBlocked: false, createdAt: Date.now() } : {})
    }, decoded.uid, email, developer);
    await users.doc(decoded.uid).set(profile, { merge: true });
    snapshot = await users.doc(decoded.uid).get();
    data = snapshot.exists ? snapshot.data() || profile : profile;
    console.info('[Vercel Live API] Firestore profile created', { tokenUid: decoded.uid, searchedUid, createdUid: decoded.uid, database: 'Firestore', projectId, databaseId, sourceDatabase });
  }

  data = createProfileFields(data, decoded.uid, email, developer);
  await mirrorProfileToMongo(data);
  const createdAt = toTimestamp(data.createdAt);
  const authCreated = decoded.auth_time ? decoded.auth_time * 1000 : 0;
  return {
    decoded,
    user: {
      uid: decoded.uid,
      email,
      name: String(data.name || decoded.name || (developer ? 'Echat Developer' : 'Echat User')),
      avatar: String(data.avatar || (decoded as FirebaseIdToken & { picture?: string }).picture || ''),
      role: developer ? 'super_admin' : String(data.role || 'user'),
      liveAccess: developer ? 'approved' : String(data.liveAccess || 'none'),
      isVerified: Boolean(data.isVerified),
      isBlocked: !developer && Boolean(data.isBlocked),
      createdAt: createdAt || authCreated
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
