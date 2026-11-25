import { gradientCover, initialsAvatar } from './server/avatar.js';
import fs from 'fs';
import http from 'http';
import path from 'path';
import crypto from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import express, { Request, Response } from 'express';
import { db, hashPassword } from './server/db.js';
import { SocketManager } from './server/socket.js';
import { firebaseProjectId, firestore, getFirebaseAdminAuth } from './server/firebase-admin.js';
import { verifyFirebaseIdToken } from './server/firebase-token.js';
import { cleanNotificationText, messagePreview } from './server/messagePreview.js';
import type { DirectMessageRecord } from './server/persistence.js';
import type { Message } from './server/types.js';
import { isValidPushToken, pushReady, removePushToken, savePushToken, sendPush, type PushPayload } from './server/push.js';
import { RESPONSE_TIMING, VerificationError, completeReset, completeSignup, completeVerify, normalizeEmail, sendResetCode, sendSignupCode, sendVerifyCode, verificationStatus } from './server/verification.js';
import { migrateEmbeddedProfilesOnce, publicProfile, refreshEmbeddedProfile } from './server/profileSync.js';
import { resolveLiveCreatedAt } from './serverless/live-age.js';
import { describeLiveKitError, getOrCreateLiveStreamIngress, resetLiveStreamIngress } from './serverless/live-stream-key.js';

const isProd = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
server.requestTimeout = 10 * 60 * 1000;
server.headersTimeout = 10 * 60 * 1000 + 10_000;
const socketManager = new SocketManager(server);

// ----------------- CORS -----------------
// CORS_ORIGIN: comma-separated allowed origins; the production frontend is always included.
const CORS_ORIGINS = Array.from(new Set([
  'https://echat-ivory.vercel.app',
  ...(process.env.CORS_ORIGIN ?? '').split(',').map(o => o.trim()).filter(Boolean)
]));
app.use((req: Request, res: Response, next) => {
  const origin = req.headers.origin;
  const allowAny = CORS_ORIGINS.includes('*');
  if (origin && (allowAny || CORS_ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', allowAny ? '*' : origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  // x-page-id is sent by the client when acting as a Page. It must be allowed
  // for cross-origin requests (including the Reel chunk upload preflight).
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id, x-developer-key, x-page-id, x-live-auth-token, x-firebase-id-token');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '3mb' })); // 2 MB binary payload plus base64 and JSON overhead
app.use(express.urlencoded({ extended: true, limit: '3mb' }));

// Brute-force protection for login / register / password reset (30 tries per 15 min per IP).
const authHits = new Map<string, { count: number; reset: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of authHits) if (v.reset < now) authHits.delete(k);
}, 10 * 60 * 1000).unref();
const authRateLimit = (req: Request, res: Response, next: express.NextFunction) => {
  const key = `${req.baseUrl}:${req.ip || 'unknown'}`;
  const now = Date.now();
  const rec = authHits.get(key);
  if (!rec || rec.reset < now) {
    authHits.set(key, { count: 1, reset: now + 15 * 60 * 1000 });
    return next();
  }
  rec.count++;
  if (rec.count > 30) return res.status(429).json({ error: 'Too many attempts. Please try again in 15 minutes.' });
  next();
};
app.use('/api/auth', authRateLimit);
app.use('/api/admin/claim', authRateLimit);

// ----------------- STATIC UPLOADS -----------------
// Stored under data/ so a single persistent disk keeps both the database and uploads.
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), 'data', 'uploads'));
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const REEL_UPLOADS_DIR = path.resolve(process.env.REEL_TEMP_DIR || path.join(process.cwd(), 'data', 'reel-uploads'));
fs.mkdirSync(REEL_UPLOADS_DIR, { recursive: true });
// If a file is missing on disk (host wiped it), restore it from durable storage, then serve it.
app.get('/uploads/:name', async (req: Request, res: Response, next) => {
  try {
    const name = req.params.name;
    if (!/^[a-f0-9-]{36}\.(jpg|png|webp|gif|mp4|mov|webm|ogg|mp3|m4a|pdf|doc|docx)$/.test(name)) return next();
    const target = path.join(UPLOADS_DIR, name);
    if (fs.existsSync(target)) return next(); // normal case: express.static below serves it
    const stored = await db.getStoredFile(name);
    if (!stored) return next();
    fs.writeFileSync(target, stored.data); // cache on disk again
    res.setHeader('Content-Type', stored.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.send(stored.data);
  } catch (e) {
    next(e);
  }
});
app.use('/uploads', express.static(UPLOADS_DIR, {
  maxAge: '7d',
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')
}));

const UPLOAD_MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-quicktime': 'mov',
  'video/mov': 'mov',
  'video/x-m4v': 'mp4',
  'video/webm': 'webm',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx'
};
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_REEL_SIZE_BYTES = Math.min(2, Math.max(1, Number(process.env.MAX_REEL_SIZE_MB) || 2)) * 1024 * 1024;
const REEL_SMALL_CHUNK_SIZE = 1 * 1024 * 1024;
const REEL_LARGE_CHUNK_SIZE = 2 * 1024 * 1024;

interface ReelUploadSession {
  id: string;
  userId: string;
  fileName: string;
  mimeType: string;
  extension: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  receivedChunks: number[];
  createdAt: number;
  completedUrl?: string;
}

function reelUploadPath(id: string, suffix: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid upload ID');
  return path.join(REEL_UPLOADS_DIR, `${id}.${suffix}`);
}

async function readReelUpload(id: string): Promise<ReelUploadSession | null> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  try { return JSON.parse(await fs.promises.readFile(reelUploadPath(id, 'json'), 'utf8')) as ReelUploadSession; }
  catch { return null; }
}

async function saveReelUpload(session: ReelUploadSession) {
  const temp = reelUploadPath(session.id, 'json.tmp');
  await fs.promises.writeFile(temp, JSON.stringify(session));
  await fs.promises.rename(temp, reelUploadPath(session.id, 'json'));
}

async function pruneReelUploads() {
  try {
    const names = await fs.promises.readdir(REEL_UPLOADS_DIR);
    for (const name of names.filter(item => item.endsWith('.json'))) {
      const id = name.slice(0, -5);
      const session = await readReelUpload(id);
      if (!session || Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
        await fs.promises.rm(reelUploadPath(id, 'json'), { force: true });
        await fs.promises.rm(reelUploadPath(id, 'part'), { force: true });
      }
    }
  } catch (error) { console.warn('[Echat] Could not prune incomplete Reel uploads:', error); }
}
void pruneReelUploads();
setInterval(() => void pruneReelUploads(), 60 * 60 * 1000).unref();

app.get('/api/health', (_req: Request, res: Response) => {
  const storage = db.healthStatus;
  res.status(storage.state === 'degraded' ? 503 : 200).json({
    status: storage.state === 'degraded' ? 'degraded' : 'ok',
    ...(storage.state === 'degraded' ? { message: 'Database unavailable; using local storage. Data may not persist across restarts.' } : {}),
    uptime: process.uptime(),
    storage: db.persistenceStats ?? storage.state
  });
});

app.get('/api/calls/ice-config', async (req: Request, res: Response) => {
  if (!getAuthUser(req)) return res.status(401).json({ error: 'Not authenticated' });
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return res.status(503).json({ error: 'TURN credentials are not configured on the server' });
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Tokens.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ Ttl: '3600' })
    });
    const payload = await response.json() as { ice_servers?: RTCIceServer[]; message?: string };
    if (!response.ok || !Array.isArray(payload.ice_servers) || payload.ice_servers.length === 0) {
      return res.status(502).json({ error: 'Could not create temporary TURN credentials' });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ iceServers: payload.ice_servers });
  } catch {
    res.status(502).json({ error: 'TURN credential service is unavailable' });
  }
});

app.get('/api/site-config', (_req: Request, res: Response) => {
  const { welcomeTitle, welcomeSubtitle, welcomeBgImage, welcomeLogo, primaryButtonText, secondaryText, appName } = db.getSiteConfig();
  res.json({ welcomeTitle, welcomeSubtitle, welcomeBgImage, welcomeLogo, primaryButtonText, secondaryText, appName });
});

const linkPreviewCache = new Map<string, { expiresAt: number; value: Record<string, string> }>();
function isPrivateIp(address: string): boolean {
  const ip = address.toLowerCase().replace(/^::ffff:/, '');
  if (ip.includes('.')) {
    const octets = ip.split('.').map(Number);
    if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true;
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  return ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:') || ip.startsWith('ff');
}

async function isPublicHostname(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return !isPrivateIp(host);
  try {
    const resolved = await lookup(host, { all: true, verbatim: true });
    return resolved.length > 0 && resolved.every(item => !isPrivateIp(item.address));
  } catch { return false; }
}

app.post('/api/link-preview', async (req: Request, res: Response) => {
  const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  let target: URL;
  try { target = new URL(rawUrl); } catch { return res.status(400).json({ error: 'Invalid link URL' }); }
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || !await isPublicHostname(host) || target.port && !['80', '443'].includes(target.port)) {
    return res.status(400).json({ error: 'Link previews only support public HTTP or HTTPS pages' });
  }
  const cached = linkPreviewCache.get(target.href);
  if (cached && cached.expiresAt > Date.now()) return res.json(cached.value);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(target.href)}&meta=true`, { signal: controller.signal });
      if (!response.ok) throw new Error('Metadata provider unavailable');
      const body = await response.json() as { data?: { title?: string; description?: string; image?: { url?: string }; logo?: { url?: string } } };
      const data = body.data || {};
      const result: Record<string, string> = {
        url: target.href,
        domain: target.hostname.replace(/^www\./, ''),
        ...(typeof data.title === 'string' && { title: data.title.slice(0, 180) }),
        ...(typeof data.description === 'string' && { description: data.description.slice(0, 300) }),
        ...(typeof data.image?.url === 'string' && /^https:\/\//.test(data.image.url) && { image: data.image.url }),
        ...(typeof data.logo?.url === 'string' && /^https:\/\//.test(data.logo.url) && { favicon: data.logo.url })
      };
      linkPreviewCache.set(target.href, { value: result, expiresAt: Date.now() + 60 * 60 * 1000 });
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.json(result);
    } finally { clearTimeout(timer); }
  } catch {
    return res.status(502).json({ error: 'Could not fetch link preview' });
  }
});

app.put('/api/admin/site-config', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser || !isAdminUser(authUser)) return res.status(403).json({ error: 'Administrator access required' });
  const updates: Record<string, string> = {};
  for (const [key, limit] of [['welcomeTitle', 90], ['welcomeSubtitle', 280], ['primaryButtonText', 36], ['secondaryText', 280], ['appName', 48]] as const) {
    if (req.body[key] !== undefined) {
      if (typeof req.body[key] !== 'string') return res.status(400).json({ error: `Invalid ${key}` });
      updates[key] = req.body[key].trim().slice(0, limit);
    }
  }
  if (req.body.welcomeBgImage !== undefined) {
    const value = typeof req.body.welcomeBgImage === 'string' ? req.body.welcomeBgImage.trim() : '';
    if (value && !/^https:\/\//i.test(value) && !value.startsWith('/uploads/')) return res.status(400).json({ error: 'Background must be an HTTPS image URL or uploaded image' });
    updates.welcomeBgImage = value;
  }
  res.json(db.updateSiteConfig(updates));
});

// Upload a file (sent as a base64 data URL). Returns a server-relative URL.
app.post('/api/upload', async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

    const { dataUrl } = req.body as { dataUrl?: unknown };
    if (typeof dataUrl !== 'string') return res.status(400).json({ error: 'dataUrl is required' });

    const match = /^data:([a-z0-9.+/-]+)(?:;[^;,]+)*;base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
    if (!match) return res.status(400).json({ error: 'Invalid file data' });

    const ext = UPLOAD_MIME_EXT[match[1].toLowerCase()];
    if (!ext) return res.status(415).json({ error: 'Unsupported file type' });

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ error: 'File is empty or larger than 2 MB' });
    }

    const fileName = `${crypto.randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, fileName), buffer);
    try {
      await db.putFile(fileName, match[1].toLowerCase(), buffer); // durable copy (MongoDB), if configured
    } catch (err) {
      console.error('[Echat] Could not store upload durably (kept on local disk only):', err);
    }
    res.status(201).json({ url: `/uploads/${fileName}` });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Upload failed' });
  }
});

// Reels use resumable raw chunks; the full upload is capped at 2 MB by MAX_REEL_SIZE_BYTES.
app.post('/api/reels/upload/init', async (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  const fileName = typeof req.body?.fileName === 'string' ? path.basename(req.body.fileName).slice(0, 180) : 'reel-video';
  const mimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType.toLowerCase().split(';')[0] : '';
  const size = Number(req.body?.size);
  const extension = UPLOAD_MIME_EXT[mimeType];
  if (!extension || !mimeType.startsWith('video/')) return res.status(415).json({ error: 'Video format not supported - use MP4 / MOV / WebM.' });
  if (!Number.isSafeInteger(size) || size <= 0) return res.status(400).json({ error: 'Please select a video.' });
  if (size > MAX_REEL_SIZE_BYTES) return res.status(413).json({ error: 'Video too large - Max 2 MB. Please compress or trim your video.' });
  const id = crypto.randomUUID();
  const session: ReelUploadSession = {
    id, userId: authUser.id, fileName, mimeType, extension, size,
    chunkSize: size < 50 * 1024 * 1024 ? REEL_SMALL_CHUNK_SIZE : REEL_LARGE_CHUNK_SIZE,
    totalChunks: Math.ceil(size / (size < 50 * 1024 * 1024 ? REEL_SMALL_CHUNK_SIZE : REEL_LARGE_CHUNK_SIZE)), receivedChunks: [], createdAt: Date.now()
  };
  try {
    const handle = await fs.promises.open(reelUploadPath(id, 'part'), 'w');
    await handle.truncate(size);
    await handle.close();
    await saveReelUpload(session);
    res.status(201).json({ uploadId: id, chunkSize: session.chunkSize, totalChunks: session.totalChunks });
  } catch (error) {
    await fs.promises.rm(reelUploadPath(id, 'part'), { force: true });
    console.error('[Echat] Could not initialize Reel upload:', error);
    res.status(500).json({ error: 'Could not prepare the Reel upload. Please retry.' });
  }
});

app.get('/api/reels/upload/:uploadId', async (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  const session = await readReelUpload(req.params.uploadId);
  if (!session || session.userId !== authUser.id) return res.status(404).json({ error: 'Upload session expired. Retry the Reel upload.' });
  res.json({ uploadId: session.id, fileName: session.fileName, mimeType: session.mimeType, size: session.size, chunkSize: session.chunkSize, totalChunks: session.totalChunks, receivedChunks: session.receivedChunks, completedUrl: session.completedUrl });
});

// Keep the raw limit at 5MB so uploads already started with the prior 5MB chunk size can still resume.
app.put('/api/reels/upload/:uploadId/chunk/:index', express.raw({ type: 'application/octet-stream', limit: '5mb' }), async (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  const session = await readReelUpload(req.params.uploadId);
  if (!session || session.userId !== authUser.id) return res.status(404).json({ error: 'Upload session expired. Retry the Reel upload.' });
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= session.totalChunks || !Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'Invalid video chunk.' });
  const offset = index * session.chunkSize;
  const expectedLength = Math.min(session.chunkSize, session.size - offset);
  if (req.body.length !== expectedLength) return res.status(400).json({ error: 'Video chunk was incomplete. Retry this upload chunk.' });
  try {
    const handle = await fs.promises.open(reelUploadPath(session.id, 'part'), 'r+');
    try {
      let written = 0;
      while (written < req.body.length) {
        const result = await handle.write(req.body, written, req.body.length - written, offset + written);
        if (result.bytesWritten <= 0) throw new Error('No progress while writing Reel chunk');
        written += result.bytesWritten;
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (!session.receivedChunks.includes(index)) session.receivedChunks.push(index);
    await saveReelUpload(session);
    res.json({ received: index, complete: session.receivedChunks.length === session.totalChunks });
  } catch (error) {
    console.error('[Echat] Could not store Reel upload chunk:', error);
    res.status(500).json({ error: 'Could not store this video chunk. Tap Retry to resume.' });
  }
});

app.post('/api/reels/upload/:uploadId/complete', async (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  const session = await readReelUpload(req.params.uploadId);
  if (!session || session.userId !== authUser.id) return res.status(404).json({ error: 'Upload session expired. Retry the Reel upload.' });
  if (session.completedUrl) return res.json({ url: session.completedUrl, size: session.size, mimeType: session.mimeType, fileName: path.basename(session.completedUrl) });
  if (session.receivedChunks.length !== session.totalChunks) return res.status(409).json({ error: 'Some video chunks are missing. Tap Retry to resume.' });
  const fileName = `${crypto.randomUUID()}.${session.extension}`;
  const destination = path.join(UPLOADS_DIR, fileName);
  try {
    await fs.promises.rename(reelUploadPath(session.id, 'part'), destination);
    if (session.size <= 12 * 1024 * 1024) {
      await db.putFile(fileName, session.mimeType, await fs.promises.readFile(destination)).catch(error => console.warn('[Echat] Could not store small Reel in database; kept on persistent disk:', error));
    }
    session.completedUrl = `/uploads/${fileName}`;
    await saveReelUpload(session);
    res.status(201).json({ url: session.completedUrl, size: session.size, mimeType: session.mimeType, fileName });
  } catch (error) {
    console.error('[Echat] Could not finalize Reel upload:', error);
    res.status(500).json({ error: 'Reel upload could not be finalized. Tap Retry to resume.' });
  }
});

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'eldermoses89@gmail.com').toLowerCase().trim();
const SUPER_ADMIN_UID = (process.env.SUPER_ADMIN_UID || process.env.VITE_SUPER_ADMIN_UID || '').trim();
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || process.env.VITE_SUPER_ADMIN_EMAIL || ADMIN_EMAIL).toLowerCase().trim();

function isDeveloperUser(user: any): boolean {
  return Boolean(user && (user.role === 'developer' || user.role === 'super_admin'));
}

function isAdminUser(user: any): boolean {
  return Boolean(user && (user.role === 'developer' || user.role === 'super_admin' || user.role === 'admin' || user.isAdmin === true));
}

const LIVE_AUTO_APPROVAL_DAYS = 60;
const LIVE_DAY_MS = 24 * 60 * 60 * 1000;
function isSuperAdminLiveUser(user: any): boolean {
  return Boolean(user && (['developer', 'super_admin', 'admin', 'owner'].includes(user.role) || user.isAdmin === true || user.canApproveLive === true));
}

function liveAccountAgeDays(user: any): number {
  const createdAt = Number(user?.createdAt);
  return Number.isFinite(createdAt) && createdAt > 0 ? Math.max(0, (Date.now() - createdAt) / LIVE_DAY_MS) : 0;
}

async function syncLiveProfileToFirestore(user: any): Promise<void> {
  if (!user?.id || !firestore) return;
  const ref = firestore.collection('users').doc(user.firebaseUid || user.id);
  try {
    const snapshot = await ref.get();
    if (!snapshot.exists) return;
    const data = snapshot.data() || {};
    const fields = {
      role: user.role,
      liveAccess: user.liveAccess || 'none',
      createdAt: user.createdAt,
      isOfficialDeveloper: user.isOfficialDeveloper === true,
      canApproveLive: user.canApproveLive === true,
      isBlocked: user.isBlocked === true
    };
    if (!Object.entries(fields).every(([key, value]) => data[key] === value)) await ref.set(fields, { merge: true });
  } catch (error) {
    console.warn('[Echat] Could not sync server live eligibility to Firestore:', error instanceof Error ? error.message : error);
  }
}

function autoApproveMatureLiveUser(user: any): boolean {
  if (!user || db.getLiveAccessMode() !== 'sixty_days_plus' || isSuperAdminLiveUser(user) || user.liveAccess === 'blocked' || user.liveAccess === 'approved' || liveAccountAgeDays(user) < LIVE_AUTO_APPROVAL_DAYS) return false;
  const pending = db.getLiveRequests().find(item => item.userId === user.id && item.status === 'pending');
  if (pending) db.reviewLiveRequest(pending.id, 'approved', 'system:auto-60-days');
  else {
    db.updateUser(user.id, { liveAccess: 'approved' });
    user.liveAccess = 'approved';
  }
  syncLiveProfileToFirestore(db.getUserById(user.id));
  return true;
}

function canStartLive(user: any): boolean {
  if (!user) return false;
  if (isSuperAdminLiveUser(user)) return true;
  if (user.liveAccess === 'blocked') return false;
  const mode = db.getLiveAccessMode();
  if (mode === 'everyone') return true;
  if (mode === 'admins_creators_only') return user.role === 'admin' || user.role === 'creator';
  if (mode === 'sixty_days_plus') return user.liveAccess === 'approved' || liveAccountAgeDays(user) >= LIVE_AUTO_APPROVAL_DAYS;
  return user.liveAccess === 'approved';
}

/** Constant-time string comparison (avoids leaking the secret through timing). */
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Helper to extract authenticated user from header
function getAuthUser(req: Request) {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return null;
  if (userId === 'user_admin_elder') return null;
  let user = db.getUserById(userId);
  if (!user && userId.trim()) {
    // Never grant developer rights here: the admin account is created only through /api/auth/register.
    const isDev = false;
    user = db.createUser({
      id: userId,
      name: 'User',
      email: `${userId}@echat.local`,
      dob: '2000-01-01',
      avatar: initialsAvatar('User'),
      coverPhoto: gradientCover('User'),
      bio: 'Echat member',
      location: 'Global',
      work: '',
      education: '',
      role: isDev ? 'developer' : 'user'
    });
  }
  return user || null;
}

function createLiveAuthToken(user: { id: string; liveAuthSecret?: string }): string {
  const secret = user.liveAuthSecret || crypto.randomBytes(32).toString('hex');
  if (!user.liveAuthSecret) db.updateUser(user.id, { liveAuthSecret: secret });
  return crypto.createHmac('sha256', secret).update(user.id).digest('hex');
}

function getLiveAuthUser(req: Request) {
  const userId = req.headers['x-user-id'];
  const user = typeof userId === 'string' ? db.getUserById(userId) : undefined;
  const suppliedToken = req.headers['x-live-auth-token'];
  if (!user || (user.isBlocked && !isSuperAdminLiveUser(user)) || typeof suppliedToken !== 'string' || !user.liveAuthSecret) return null;
  const expectedToken = crypto.createHmac('sha256', user.liveAuthSecret).update(user.id).digest('hex');
  if (!safeEqual(suppliedToken, expectedToken)) return null;
  return user;
}

// ----------------- AUTH ROUTES -----------------
// Copies the real profile (name, photo...) onto an auto-created placeholder account.
// Only placeholders can be synced; email, role and password are never changed here.
app.post('/api/auth/sync-profile', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
    if (!authUser.email.endsWith('@echat.local')) return res.json({ user: db.sanitizeUser(authUser, authUser.id), synced: false });

    const { name, avatar, coverPhoto, bio, location } = req.body as Record<string, unknown>;
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (cleanName.length < 2 || cleanName.length > 60) return res.status(400).json({ error: 'Valid name required' });
    const reserved = ['echat official', 'super admin', 'developer', 'moderator', 'system admin', 'verified staff', 'official admin'];
    if (reserved.some(kw => cleanName.toLowerCase().includes(kw))) return res.status(400).json({ error: 'Prohibited name' });

    const updated = db.updateUser(authUser.id, {
      name: cleanName,
      ...(typeof avatar === 'string' && avatar && { avatar }),
      ...(typeof coverPhoto === 'string' && coverPhoto && { coverPhoto }),
      ...(typeof bio === 'string' && { bio }),
      ...(typeof location === 'string' && { location })
    });
    if (!updated) return res.status(404).json({ error: 'User not found' });
    const sanitized = db.sanitizeUser(updated);
    socketManager.broadcast({ type: 'user_updated', user: sanitized });
    res.json({ user: sanitized, synced: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/register', (req: Request, res: Response) => {
  try {
    const { name, email, password, dob, avatar, bio, location, termsAccepted } = req.body;
    if (req.body?.id === 'user_admin_elder' || (typeof name === 'string' && /^elder moses\s*\(test\)$/i.test(name.trim()))) {
      return res.status(410).json({ error: 'This legacy demo account was removed.' });
    }
    if (!name || !email || !password || !dob) {
      return res.status(400).json({ error: 'Name, email, password, and Date of Birth are required' });
    }

    // Task 4: User cannot create account without checking Terms & Conditions
    if (!termsAccepted) {
      return res.status(400).json({ error: 'You must read and agree to the EChat Terms & Conditions to create an account.' });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Task 4: Anti-impersonation protection for developer email
    if (cleanEmail === ADMIN_EMAIL) {
      const existingAdmin = db.getUserByEmail(ADMIN_EMAIL);
      if (existingAdmin) {
        return res.status(400).json({ error: 'Reserved administrator email: Registration is restricted.' });
      }
    }

    // Task 4: Prevent users from claiming to be developer or staff
    const reservedKeywords = ['echat official', 'super admin', 'developer', 'moderator', 'system admin', 'verified staff', 'official admin'];
    const lowerName = name.toLowerCase().trim();
    if (reservedKeywords.some(kw => lowerName.includes(kw))) {
      return res.status(400).json({ error: 'Prohibited Name: Impersonating EChat staff or developers violates Terms & Conditions.' });
    }

    const birthDate = new Date(dob);
    if (isNaN(birthDate.getTime())) {
      return res.status(400).json({ error: 'Please enter a valid Date of Birth' });
    }

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    if (age < 18) {
      return res.status(400).json({ error: 'You must be at least 18 years old to create an account on Echat.' });
    }

    const existing = db.getUserByEmail(cleanEmail);
    if (existing) {
      // Only the real owner (correct password) may re-enter an existing account.
      if (existing.passwordHash && existing.passwordHash === hashPassword(password)) {
        return res.json({ user: db.sanitizeUser(existing), token: existing.id, liveAuthToken: createLiveAuthToken(existing) });
      }
      return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
    }

    if (cleanEmail === ADMIN_EMAIL) {
      const secret = process.env.ADMIN_BOOTSTRAP_PASSWORD;
      if (!secret || typeof password !== 'string' || !safeEqual(password, secret)) {
        return res.status(403).json({ error: 'Reserved administrator email: setup password required.' });
      }
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const isDev = cleanEmail === ADMIN_EMAIL;

    // A placeholder (auto-created, generic-name) account with this id already exists:
    // upgrade it with the real details instead of creating a duplicate that would never be read.
    const placeholder = typeof req.body.id === 'string' ? db.getUserById(req.body.id) : undefined;
    if (placeholder && placeholder.email.endsWith('@echat.local')) {
      const upgraded = db.updateUser(placeholder.id, {
        name: name.trim(),
        email: cleanEmail,
        dob,
        passwordHash: hashPassword(password),
        ...(avatar && { avatar }),
        ...(bio && { bio }),
        ...(location && { location }),
        ...(isDev && { role: 'developer' as const, isVerified: true, isOfficialDeveloper: true })
      });
      if (upgraded) return res.json({ user: db.sanitizeUser(upgraded), token: upgraded.id, liveAuthToken: createLiveAuthToken(upgraded) });
    }

    if (typeof req.body.id === 'string' && db.getUserById(req.body.id)) {
      return res.status(409).json({ error: 'This account already exists. Please log in.' });
    }

    const user = db.createUser({
      id: req.body.id,
      name: name.trim(),
      email: cleanEmail,
      password,
      dob,
      avatar,
      coverPhoto: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?auto=format&fit=crop&w=1400&q=80',
      bio: bio || 'Excited to be on Echat! 👋',
      location: location || 'Global',
      work: '',
      education: '',
      role: isDev ? 'developer' : 'user'
    });

    res.json({
      user: db.sanitizeUser(user, user.id),
      token: user.id,
      liveAuthToken: createLiveAuthToken(user)
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Registration failed' });
  }
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = db.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.isBlocked) {
      return res.status(403).json({ error: 'Your account has been suspended by an administrator.' });
    }

    const inputHash = hashPassword(password);
    if (user.passwordHash !== inputHash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    res.json({
      user: db.sanitizeUser(user, user.id),
      token: user.id,
      liveAuthToken: createLiveAuthToken(user)
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Login failed' });
  }
});

// ----------------- VERIFICATION CODES (sign-up, verify email, forgot password) -----------------
// 6-digit codes emailed by server/verification.ts. The old "reset token" endpoints are gone:
// codes are never returned to the browser.
const verifyRoute = (handler: (req: Request) => Promise<Record<string, unknown> | void>) => async (req: Request, res: Response) => {
  try {
    res.json({ success: true, ...RESPONSE_TIMING, ...(await handler(req) || {}) });
  } catch (error) {
    if (error instanceof VerificationError) {
      if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
      return res.status(error.status).json({ error: error.message, code: error.code, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) });
    }
    console.error('[verification] failed:', error instanceof Error ? error.message : error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

async function verifiedTokenUid(req: Request): Promise<string> {
  const token = String(req.body?.idToken || req.get('x-firebase-id-token') || '');
  if (!token) throw new VerificationError('Please sign in again.', 401, 'signed-out');
  try { return (await verifyFirebaseIdToken(token, firebaseProjectId)).uid; }
  catch { throw new VerificationError('Your sign-in expired. Please sign in again.', 401, 'signed-out'); }
}

app.use('/api/verify', authRateLimit);
// ----------------- PUSH NOTIFICATIONS (FCM) -----------------
// The device token is tied to the Firebase account proven by the ID token (never to a header id),
// so nobody can register their phone to receive someone else's notifications.
const pushUidOf = (userId: string) => { const found = db.getUserById(userId); return found?.firebaseUid || found?.id || userId; };
const unreadBadge = (userId: string) => db.getNotifications(userId).filter(n => !n.read).length;
const pushIcon = (avatar?: string) => (avatar && /^https:\/\//.test(avatar) ? avatar : undefined);
function pushTo(userIds: string[], payload: Omit<PushPayload, 'badge'>) {
  for (const userId of new Set(userIds)) {
    void sendPush([pushUidOf(userId)], { ...payload, badge: unreadBadge(userId) });
  }
}
const pushRoute = (handler: (uid: string, token: string, req: Request) => Promise<void>) => async (req: Request, res: Response) => {
  try {
    const uid = await verifiedTokenUid(req);
    const token = req.body?.token;
    if (!isValidPushToken(token)) return res.status(400).json({ error: 'Invalid notification token.' });
    await handler(uid, token, req);
    res.json({ success: true });
  } catch (error) {
    const status = error instanceof VerificationError ? error.status : 503;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Could not update notifications.' });
  }
};
app.get('/api/push/status', (_req: Request, res: Response) => res.json({ ready: pushReady() }));

// ----------------- VERIFIED SESSIONS (private data) -----------------
// x-user-id alone can be typed by anyone, so private routes (DMs, notifications, unread counts) and the
// live socket also need the Firebase ID token of that same account. DMs stay between the 2 people.
const verifiedTokens = new Map<string, { uid: string; email?: string; emailVerified: boolean; exp: number }>();
async function verifyIdTokenCached(token: string) {
  const hit = verifiedTokens.get(token);
  if (hit && hit.exp > Date.now()) return hit;
  const decoded = await verifyFirebaseIdToken(token, firebaseProjectId);
  const value = { uid: String(decoded.uid), email: typeof decoded.email === 'string' ? decoded.email : undefined, emailVerified: decoded.email_verified === true, exp: Math.min(Number(decoded.exp || 0) * 1000, Date.now() + 30 * 60 * 1000) };
  if (verifiedTokens.size > 5000) verifiedTokens.clear();
  verifiedTokens.set(token, value);
  return value;
}
/** True when the token's Firebase account is this eChat user (links older accounts by verified email once). */
async function tokenOwnsUser(userId: string, token: string): Promise<boolean> {
  if (!token) return false;
  const user = db.getUserById(userId);
  if (!user) return false;
  let decoded;
  try { decoded = await verifyIdTokenCached(token); } catch { return false; }
  if (user.id === decoded.uid || user.firebaseUid === decoded.uid) return true;
  if (!user.firebaseUid && decoded.emailVerified && decoded.email && user.email?.toLowerCase() === decoded.email.toLowerCase() && !db.getUserByFirebaseUid(decoded.uid)) {
    db.updateUser(user.id, { firebaseUid: decoded.uid });
    return true;
  }
  return false;
}
const PRIVATE_PREFIXES = ['/api/dm', '/api/messages', '/api/conversations', '/api/notifications', '/api/unread'];
app.use(PRIVATE_PREFIXES, async (req: Request, res: Response, next: express.NextFunction) => {
  if (req.method === 'OPTIONS') return next();
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  if (await tokenOwnsUser(authUser.id, String(req.get('x-firebase-id-token') || ''))) return next();
  return res.status(401).json({ error: 'Your session expired. Please log in again.', code: 'session-expired' });
});
socketManager.authVerifier = tokenOwnsUser;

// ----------------- UNREAD COUNTS (live badges) -----------------
// Kept on the user's own Firestore profile (users/{uid}.unread) so the app's Firestore listener updates
// the red badges instantly, and also sent over the socket. Recomputed (debounced) whenever messages or
// notifications change.
async function computeUnread(userId: string) {
  const dms = await db.listDirectMessagesForUser(userId).catch(() => []);
  const dmUnread = dms.filter(m => m.senderId !== userId && !(m as { readAt?: number | null }).readAt && visibleDm(userId, m)).length;
  return {
    messages: dmUnread + db.countUnreadLegacyMessages(userId),
    notifications: db.getNotifications(userId).filter(n => !n.read && n.type !== 'message').length
  };
}
const unreadTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastUnread = new Map<string, string>();
function syncUnread(userId: string | undefined) {
  if (!userId) return;
  clearTimeout(unreadTimers.get(userId));
  unreadTimers.set(userId, setTimeout(async () => {
    unreadTimers.delete(userId);
    try {
      const counts = await computeUnread(userId);
      socketManager.sendToUser(userId, { type: 'unread_counts', ...counts });
      const key = `${counts.messages}/${counts.notifications}`;
      if (lastUnread.get(userId) === key || !firestore) return;
      lastUnread.set(userId, key);
      await firestore.collection('users').doc(pushUidOf(userId)).update({ unread: { ...counts, updatedAt: Date.now() } }).catch(() => {});
    } catch (error) {
      console.warn('[Unread] Could not update counts for', userId, error instanceof Error ? error.message : error);
    }
  }, 400));
}
// Every place that changes messages or notifications goes through these db methods.
{
  const addNotification = db.addNotification.bind(db);
  db.addNotification = notif => { const created = addNotification(notif); syncUnread(notif.userId); return created; };
  const upsertMessageNotification = db.upsertMessageNotification.bind(db);
  db.upsertMessageNotification = (userId, actorId, message) => { const created = upsertMessageNotification(userId, actorId, message); syncUnread(userId); return created; };
  const markNotificationsRead = db.markNotificationsRead.bind(db);
  db.markNotificationsRead = (userId, exceptTypes) => { markNotificationsRead(userId, exceptTypes); syncUnread(userId); };
  const markMessageNotificationsRead = db.markMessageNotificationsRead.bind(db);
  db.markMessageNotificationsRead = (userId, actorId) => { markMessageNotificationsRead(userId, actorId); syncUnread(userId); };
  const markConversationSeen = db.markConversationSeen.bind(db);
  db.markConversationSeen = (viewerId, partnerId) => { markConversationSeen(viewerId, partnerId); syncUnread(viewerId); };
  const addMessage = db.addMessage.bind(db);
  db.addMessage = msg => { const created = addMessage(msg); syncUnread(msg.receiverId); return created; };
  const insertDirectMessage = db.insertDirectMessage.bind(db);
  db.insertDirectMessage = async message => { await insertDirectMessage(message); syncUnread((message as { receiverId?: string }).receiverId); };
  const markDirectMessagesRead = db.markDirectMessagesRead.bind(db);
  db.markDirectMessagesRead = async (senderId, receiverId, readAt) => { await markDirectMessagesRead(senderId, receiverId, readAt); syncUnread(receiverId); };
}
app.get('/api/unread', async (req: Request, res: Response) => {
  const authUser = getAuthUser(req)!;
  res.json(await computeUnread(authUser.id));
});
app.post('/api/push/token', pushRoute((uid, token, req) => savePushToken(uid, token, { platform: req.body?.platform, userAgent: req.get('user-agent') })));
app.post('/api/push/token/remove', pushRoute((uid, token) => removePushToken(uid, token)));

app.get('/api/verify/status', (_req: Request, res: Response) => {
  const status = verificationStatus();
  res.json({ ready: status.ready, email: status.email, firebaseAdmin: status.firebaseAdmin });
});
app.post('/api/verify/signup/send', verifyRoute(async req => { await sendSignupCode(req.body?.email); }));
app.post('/api/verify/signup/confirm', verifyRoute(async req => {
  const email = normalizeEmail(req.body?.email);
  // An old account that only exists on this server keeps its id (and so its posts and friends)
  // when it verifies, if the password matches.
  const legacy = db.getUserByEmail(email);
  const legacyUid = legacy && typeof req.body?.password === 'string' && legacy.passwordHash === hashPassword(req.body.password) ? legacy.id : undefined;
  const { uid } = await completeSignup(email, req.body?.code, req.body?.password, req.body?.name, legacyUid);
  return { uid };
}));
app.post('/api/verify/email/send', verifyRoute(async req => { await sendVerifyCode(await verifiedTokenUid(req)); }));
app.post('/api/verify/email/confirm', verifyRoute(async req => { await completeVerify(await verifiedTokenUid(req), req.body?.code); }));
app.post('/api/verify/reset/send', verifyRoute(async req => {
  await sendResetCode(req.body?.email, email => Boolean(db.getUserByEmail(email)));
  return { message: 'If this account exists, we sent a code.' };
}));
app.post('/api/verify/reset/confirm', verifyRoute(async req => {
  const { email } = await completeReset(req.body?.email, req.body?.code, req.body?.newPassword);
  const legacy = db.getUserByEmail(email);
  if (legacy) db.updateUser(legacy.id, { passwordHash: hashPassword(String(req.body.newPassword)) });
  return { message: 'Your password has been changed. Log in with your new password.' };
}));
// Old token endpoints: removed for security.
app.post(['/api/auth/forgot-password', '/api/auth/reset-password'], (_req: Request, res: Response) => {
  res.status(410).json({ error: 'Please update eChat and use "Forgot password?" again.' });
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (user.isBlocked) return res.status(403).json({ error: 'Account suspended' });
  res.json({ user: db.sanitizeUser(user, user.id) });
});

// Quick switcher to effortlessly test multiple personas
app.post('/api/auth/quick-switch', (req: Request, res: Response) => {
  if (!isDeveloperUser(getAuthUser(req))) {
    return res.status(403).json({ error: 'Account switching is restricted to administrators.' });
  }
  const { userId } = req.body;
  const user = db.getUserById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  // Account switching does not make the requester the data subject for privacy filtering.
  res.json({ user: db.sanitizeUser(user, getAuthUser(req)?.id), token: user.id });
});

// ----------------- USERS ROUTES -----------------
app.get('/api/users', (req: Request, res: Response) => {
  const viewer = getAuthUser(req);
  const users = db.getUsers().map(u => db.sanitizeUser(u, viewer?.id));
  res.json(users);
});

/** A Firestore uid -> the server's user record (ids are the Firebase uid; older accounts keep it in firebaseUid). */
function lookupProfileOwner(uid: string) {
  return uid ? db.getUserById(uid) || db.getUsers().find(u => u.firebaseUid === uid) : undefined;
}

// Live author info for cards (posts, comments, stories, reels): only public fields, never email/dob.
app.get('/api/users-public', (req: Request, res: Response) => {
  const ids = String(req.query.ids || '').split(',').map(id => id.trim()).filter(id => /^[A-Za-z0-9_-]{1,128}$/.test(id)).slice(0, 100);
  const out = ids.map(id => {
    const user = lookupProfileOwner(id);
    return user ? { ...publicProfile(user), id } : null;
  }).filter(Boolean);
  res.setHeader('Cache-Control', 'no-store');
  res.json(out);
});

app.get('/api/users/:id', (req: Request, res: Response) => {
  const user = db.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Get user's posts (only those the person looking at this profile is allowed to see)
  const viewer = getAuthUser(req);
  const posts = db.getUserPosts(user.id, viewer?.id).map(p => populatePost(p));
  const reels = db.getUserReels(user.id, viewer?.id).map(p => populatePost(p));

  // Get friends details
  const friends = user.friends
    .map(fId => db.getUserById(fId))
    .filter(Boolean)
    .map(f => db.sanitizeUser(f!, viewer?.id));

  res.json({
    user: db.sanitizeUser(user, viewer?.id),
    posts,
    reels,
    friends
  });
});

app.get('/api/users/:id/posts', (req: Request, res: Response) => {
  const viewer = getAuthUser(req);
  const visiblePosts = db.getUserPosts(req.params.id, viewer?.id).map(populatePost);
  res.json(visiblePosts);
});

app.get('/api/users/:id/reels', (req: Request, res: Response) => {
  const viewer = getAuthUser(req);
  const visibleReels = db.getUserReels(req.params.id, viewer?.id).map(populatePost);
  res.json(visibleReels);
});

app.put('/api/users/:id', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser || (authUser.id !== req.params.id && !isDeveloperUser(authUser))) {
    return res.status(403).json({ error: 'Unauthorized to update this profile' });
  }

  const { name, bio, location, work, education, avatar, coverPhoto, dob, dobVisibility, birthdayReminderEnabled, reelsAutoplay, reelsWifiOnly, privacySettings, blockedUsers, v2 } = req.body;

  if (dob !== undefined && dob !== '') {
    if (typeof dob !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return res.status(400).json({ error: 'Please enter a valid date of birth' });
    const birthDate = new Date(`${dob}T00:00:00`);
    let age = new Date().getFullYear() - birthDate.getFullYear();
    const monthDelta = new Date().getMonth() - birthDate.getMonth();
    if (monthDelta < 0 || (monthDelta === 0 && new Date().getDate() < birthDate.getDate())) age--;
    if (Number.isNaN(birthDate.getTime()) || age < 18) return res.status(400).json({ error: 'Date of birth must be valid and at least 18 years ago' });
  }

  // Privacy settings: accept only known keys with known values.
  const cleanPrivacy: Record<string, unknown> | undefined =
    privacySettings && typeof privacySettings === 'object'
      ? {
          ...(['public', 'friends', 'only_me'].includes(privacySettings.postVisibility) && { postVisibility: privacySettings.postVisibility }),
          ...(['public', 'friends', 'only_me', 'month_day_only'].includes(privacySettings.dobVisibility) && { dobVisibility: privacySettings.dobVisibility }),
          ...(['everyone', 'friends', 'nobody'].includes(privacySettings.whoCanCallMe) && { whoCanCallMe: privacySettings.whoCanCallMe }),
          ...(typeof privacySettings.twoFactorAuth === 'boolean' && { twoFactorAuth: privacySettings.twoFactorAuth })
        }
      : undefined;
  const cleanBlocked: string[] | undefined = Array.isArray(blockedUsers)
    ? blockedUsers.filter((id: unknown): id is string => typeof id === 'string').slice(0, 500)
    : undefined;
  const cleanV2: Record<string, unknown> | undefined = v2 && typeof v2 === 'object' && !Array.isArray(v2)
    ? {
        ...(typeof v2.avatarMode === 'string' && ['photo', 'avatar'].includes(v2.avatarMode) && { avatarMode: v2.avatarMode }),
        ...(typeof v2.realAvatar === 'string' && v2.realAvatar.length <= 1_000_000 && { realAvatar: v2.realAvatar }),
        ...(v2.avatarConfig && typeof v2.avatarConfig === 'object' && { avatarConfig: v2.avatarConfig }),
        ...(typeof v2.profileTheme === 'string' && /^#[0-9a-f]{6}$/i.test(v2.profileTheme) && { profileTheme: v2.profileTheme }),
        ...(typeof v2.profileBanner === 'string' && v2.profileBanner.length <= 1_000_000 && { profileBanner: v2.profileBanner }),
        ...(typeof v2.profileMusic === 'string' && { profileMusic: String(v2.profileMusic).slice(0, 120) }),
        ...(typeof v2.mood === 'string' && { mood: String(v2.mood).slice(0, 60) }),
        ...(Array.isArray(v2.topFriends) && { topFriends: v2.topFriends.filter((id: unknown): id is string => typeof id === 'string').slice(0, 8) }),
        ...(['whatsapp', 'whatsappEnabled', 'whatsappDisplay', 'whatsappAutoReplyTemplate'].reduce((out, key) => {
          if (key in v2) out[key] = v2[key];
          return out;
        }, {} as Record<string, unknown>))
      }
    : undefined;

  // Task 4: Anti-impersonation protection for normal users updating profile
  if (!isDeveloperUser(authUser) && name) {
    const reservedKeywords = ['echat official', 'super admin', 'developer', 'moderator', 'system admin', 'verified staff', 'official admin'];
    const lowerName = String(name).toLowerCase().trim();
    if (reservedKeywords.some(kw => lowerName.includes(kw))) {
      return res.status(400).json({ error: 'Prohibited Name: Impersonating EChat staff or developers violates Terms & Conditions.' });
    }
  }

  const before = db.getUserById(req.params.id);
  const previousName = before?.name, previousAvatar = before?.avatar;
  const updated = db.updateUser(req.params.id, {
    ...(name && { name: String(name).trim() }),
    ...(dob !== undefined && { dob }),
    ...(['public', 'friends', 'only_me', 'month_day_only'].includes(dobVisibility) && { dobVisibility }),
    ...(typeof birthdayReminderEnabled === 'boolean' && { birthdayReminderEnabled }),
    ...(typeof reelsAutoplay === 'boolean' && { reelsAutoplay }),
    ...(typeof reelsWifiOnly === 'boolean' && { reelsWifiOnly }),
    ...(bio !== undefined && { bio }),
    ...(location !== undefined && { location }),
    ...(work !== undefined && { work }),
    ...(education !== undefined && { education }),
    ...(avatar && { avatar }),
    ...(coverPhoto && { coverPhoto }),
    ...(cleanPrivacy && { privacySettings: { ...(db.getUserById(req.params.id)?.privacySettings || {}), ...cleanPrivacy } }),
    ...(cleanBlocked && { blockedUsers: cleanBlocked }),
    ...(cleanV2 && { v2: { ...(db.getUserById(req.params.id)?.v2 || {}), ...cleanV2 } })
  });

  if (!updated) return res.status(404).json({ error: 'User not found' });
  const sanitized = db.sanitizeUser(updated);

  // Name or photo changed: refresh every copy saved in older posts/comments/stories/reels (Facebook-style).
  if (updated.name !== previousName || updated.avatar !== previousAvatar) {
    db.refreshEmbeddedAuthor(updated.id, updated.name, updated.avatar || '');
    const uid = updated.firebaseUid || updated.id;
    const profile = { name: updated.name, avatar: updated.avatar || '' };
    void (async () => {
      if (firestore) await firestore.collection('users').doc(uid).update(profile).catch(() => {});
      const count = await refreshEmbeddedProfile(firestore, uid, profile);
      if (count) console.info(`[profileSync] Updated ${count} older documents for ${uid}.`);
    })().catch(error => console.warn('[profileSync] refresh failed:', error instanceof Error ? error.message : error));
  }

  // Broadcast instant real-time update
  if (isDeveloperUser(updated)) {
    socketManager.broadcast({
      type: 'developer_profile_updated',
      user: sanitized
    });
  } else {
    socketManager.broadcast({
      type: 'user_updated',
      user: sanitized
    });
  }

  res.json(db.sanitizeUser(updated, authUser.id));
});


// ----------------- FRIENDS ROUTES -----------------
app.post('/api/friends/request', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  const { toUserId } = req.body;
  if (db.isBlockedBetween(authUser.id, String(toUserId))) {
    return res.status(403).json({ error: 'You cannot send a friend request to this person.' });
  }

  const success = db.sendFriendRequest(authUser.id, toUserId);
  if (!success) return res.status(400).json({ error: 'Cannot send friend request' });

  // Broadcast notification to recipient
  socketManager.sendToUser(toUserId, {
    type: 'new_notification',
    message: `${authUser.name} sent you a friend request.`
  });
  pushTo([String(toUserId)], { kind: 'friend_request', title: 'New friend request', body: `${authUser.name} sent you a friend request.`, url: '/friends', tag: `friend-${authUser.id}`, icon: pushIcon(authUser.avatar) });

  res.json({ success: true });
});

app.post('/api/friends/accept', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  const { fromUserId } = req.body;

  const success = db.acceptFriendRequest(authUser.id, fromUserId);
  if (!success) return res.status(400).json({ error: 'Cannot accept friend request' });

  socketManager.sendToUser(fromUserId, {
    type: 'new_notification',
    message: `${authUser.name} accepted your friend request.`
  });
  pushTo([String(fromUserId)], { kind: 'friend_accept', title: 'Friend request accepted', body: `${authUser.name} accepted your friend request.`, url: `/profile?user=${encodeURIComponent(authUser.id)}`, tag: `friend-${authUser.id}`, icon: pushIcon(authUser.avatar) });

  res.json({ success: true });
});

app.post('/api/friends/reject', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  const { fromUserId } = req.body;

  const success = db.rejectFriendRequest(authUser.id, fromUserId);
  res.json({ success });
});

app.post('/api/friends/unfriend', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  const { friendId } = req.body;

  const success = db.unfriend(authUser.id, friendId);
  res.json({ success });
});

// ----------------- POSTS ROUTES -----------------
/** Shared guard + audit helper for the admin console. */
function requireDeveloper(req: Request, res: Response) {
  const authUser = getAuthUser(req);
  if (!isDeveloperUser(authUser)) {
    res.status(403).json({ error: 'Access denied: Master Developer credentials required' });
    return null;
  }
  return authUser!;
}

function audit(actor: any, action: string, target?: { type?: string; id?: string; name?: string }, details?: string) {
  db.addAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action,
    targetType: target?.type,
    targetId: target?.id,
    targetName: target?.name,
    details
  });
}

function populateNotification(n: any) {
  const actor = db.getUserById(n.actorId);
  return { ...n, message: cleanNotificationText(String(n.message || '')), actor: actor ? db.sanitizeUser(actor) : null };
}

function populatePost(post: any) {
  const author = db.getUserById(post.authorId);
  const pageIdentity = post.pageId ? db.getPageById(post.pageId) : null;
  const populatedComments = post.comments.map((c: any) => {
    const cAuthor = db.getUserById(c.authorId);
    return {
      ...c,
      author: cAuthor ? db.sanitizeUser(cAuthor) : { name: 'Former User', avatar: '' }
    };
  });

  // People tagged in the post
  const taggedUsers = (post.taggedUserIds || [])
    .map((id: string) => db.getUserById(id))
    .filter(Boolean)
    .map((u: any) => ({ id: u.id, name: u.name, avatar: u.avatar }));

  // The original post, when this one is a re-share (only public originals are embedded)
  let sharedPost: any = null;
  if (post.sharedPostId) {
    const orig = db.getPostById(post.sharedPostId);
    if (orig && orig.privacy === 'public') {
      const oa = db.getUserById(orig.authorId);
      sharedPost = {
        id: orig.id,
        content: orig.content,
        mediaUrl: orig.mediaUrl,
        mediaType: orig.mediaType,
        createdAt: orig.createdAt,
        author: oa ? db.sanitizeUser(oa) : { id: orig.authorId, name: 'Former User', avatar: '' }
      };
    }
  }

  // The list of viewer ids stays on the server; clients only get the count (viewsCount).
  const { views: _viewerIds, ...publicPost } = post;
  return {
    ...publicPost,
    author: pageIdentity ? { id: post.authorId, name: pageIdentity.name, avatar: pageIdentity.avatar || '', isVerified: true, isPage: true, pageId: pageIdentity.id } : author ? db.sanitizeUser(author) : { name: 'Former User', avatar: '' },
    comments: populatedComments,
    taggedUsers,
    sharedPost
  };
}

// ----------------- GLOBAL SEARCH ROUTE -----------------
app.get('/api/search', (req: Request, res: Response) => {
  try {
    const query = String(req.query.q || '').trim().toLowerCase();
    if (!query) {
      return res.json({ users: [], posts: [] });
    }

    const authUser = getAuthUser(req);
    const isDev = authUser?.role === 'developer';

    // 1. Search Users
    const users = db.getUsers(isDev)
      .filter(u => {
        const nameMatch = u.name.toLowerCase().includes(query);
        const emailMatch = u.email.toLowerCase().includes(query);
        const bioMatch = Boolean(u.bio && u.bio.toLowerCase().includes(query));
        const locMatch = Boolean(u.location && u.location.toLowerCase().includes(query));
        const workMatch = Boolean(u.work && u.work.toLowerCase().includes(query));
        const eduMatch = Boolean(u.education && u.education.toLowerCase().includes(query));
        return nameMatch || emailMatch || bioMatch || locMatch || workMatch || eduMatch;
      })
      .slice(0, 15)
      .map(u => db.sanitizeUser(u));

    // 2. Search Posts (text content, feelings, author names)
    const rawPosts = db.getPosts(authUser?.id);
    const matchedPosts = rawPosts
      .filter(p => {
        const author = db.getUserById(p.authorId);
        const authorName = author ? author.name.toLowerCase() : '';
        const contentMatch = (p.content || '').toLowerCase().includes(query);
        const feelingMatch = Boolean(p.feeling && p.feeling.toLowerCase().includes(query));
        const authorMatch = authorName.includes(query);
        return contentMatch || feelingMatch || authorMatch;
      })
      .slice(0, 15)
      .map(p => populatePost(p));

    res.json({
      users,
      posts: matchedPosts
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ----------------- LINK PREVIEWS (WhatsApp / Facebook / X crawlers) -----------------
// Public, read-only summaries used by the Vercel /post/:id and /u/:id preview pages.
// Only public posts are described; nothing private (email, phone, friends-only text) is returned.
function previewAbsolute(req: Request, url: string): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${req.protocol === 'http' && req.get('x-forwarded-proto') !== 'https' ? 'http' : 'https'}://${req.get('host')}${url}`;
  return '';
}
function previewText(text: string, max: number): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
app.get('/api/preview/post/:id', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  const id = String(req.params.id || '');
  // "[Name] updated their profile picture" posts live in Firestore: pp_<uid>_<hash>.
  const photoPost = id.match(/^pp_([^_]+)_/);
  if (photoPost) {
    const owner = db.getUserById(photoPost[1]);
    if (!owner) return res.status(404).json({ error: 'Post not found' });
    return res.json({ kind: 'post', title: `${owner.name} updated their profile picture`, description: `See ${owner.name}'s new profile picture on eChat.`, image: previewAbsolute(req, owner.avatar), author: owner.name });
  }
  const post = db.getPostById(id);
  if (!post || post.privacy !== 'public') return res.status(404).json({ error: 'Post not found' });
  const author = db.getUserById(post.authorId);
  const page = post.pageId ? db.getPageById(post.pageId) : null;
  const name = page?.name || author?.name || 'eChat user';
  const images = [post.mediaType === 'video' ? post.thumbnailUrl : post.mediaUrl, ...(Array.isArray(post.mediaUrls) ? post.mediaUrls : []), post.thumbnailUrl]
    .filter((url): url is string => typeof url === 'string' && Boolean(url) && !/\.(mp4|mov|webm|m4v)(\?|$)/i.test(url));
  const firstLine = previewText(String(post.content || '').split('\n').find(line => line.trim()) || '', 200);
  res.json({
    kind: 'post',
    title: firstLine ? `${name} on eChat: "${previewText(firstLine, 70)}"` : `${name} shared a ${post.mediaType === 'video' ? 'video' : post.mediaType === 'image' ? 'photo' : 'post'} on eChat`,
    description: firstLine || `See ${name}'s post on eChat.`,
    image: previewAbsolute(req, images[0] || author?.avatar || ''),
    author: name,
    video: post.mediaType === 'video'
  });
});
app.get('/api/preview/user/:id', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  const user = db.getUserById(String(req.params.id || ''));
  if (!user || (user as { isBlocked?: boolean }).isBlocked) return res.status(404).json({ error: 'User not found' });
  res.json({ kind: 'user', title: `${user.name} | eChat`, description: previewText(user.bio || '', 200) || `${user.name} is on eChat. Chat, stream and connect.`, image: previewAbsolute(req, user.avatar), author: user.name });
});

app.get('/api/posts', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  const pageSize = 10;
  const rawCursor = typeof req.query.cursor === 'string' ? req.query.cursor : '';
  let cursor: { createdAt: number; id: string } | null = null;
  if (rawCursor) {
    try {
      const decoded = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8')) as Partial<{ createdAt: number; id: string }>;
      if (!Number.isFinite(decoded.createdAt) || typeof decoded.id !== 'string') throw new Error('invalid cursor');
      cursor = { createdAt: Number(decoded.createdAt), id: decoded.id };
    } catch {
      return res.status(400).json({ error: 'Invalid feed cursor. Refresh the feed and try again.' });
    }
  }
  const rawPosts = db.getPosts(authUser?.id).filter(post => !cursor || post.createdAt < cursor.createdAt || (post.createdAt === cursor.createdAt && post.id.localeCompare(cursor.id) < 0));
  const page = rawPosts.slice(0, pageSize);
  const last = page[page.length - 1];
  const nextCursor = last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64url') : null;
  res.json({ posts: page.map(populatePost), nextCursor });
});

app.get('/api/reels', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const authUser = getAuthUser(req);
  const limit = 20;
  const rawReels = db.getReels(authUser?.id)
    .filter(post => post.privacy === 'public');
  const rawCursor = typeof req.query.cursor === 'string' ? req.query.cursor : '';
  let cursor: { createdAt: number; id: string } | null = null;
  if (rawCursor) {
    try {
      const decoded = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8')) as Partial<{ createdAt: number; id: string }>;
      if (!Number.isFinite(decoded.createdAt) || typeof decoded.id !== 'string') throw new Error('invalid cursor');
      cursor = { createdAt: Number(decoded.createdAt), id: decoded.id };
    } catch {
      return res.status(400).json({ error: 'Invalid Reels cursor. Refresh the feed and try again.' });
    }
  }
  const remaining = cursor
    ? rawReels.filter(post => post.createdAt < cursor!.createdAt || (post.createdAt === cursor!.createdAt && post.id.localeCompare(cursor!.id) < 0))
    : rawReels;
  const page = remaining.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64url') : null;
  res.json({ reels: page.map(post => populatePost(post)), nextCursor });
});

app.get('/api/dashboard', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  const identityPageId = String(req.get('x-page-id') || '');
  const identityPage = identityPageId ? db.getPageById(identityPageId) : null;
  if (identityPageId && identityPage?.ownerId !== authUser.id) return res.status(403).json({ error: 'You do not manage this Page' });
  const allUserPosts = db.getPosts(authUser.id).filter(post => post.authorId === authUser.id && (identityPage ? post.pageId === identityPage.id : !post.pageId));
  const posts = allUserPosts.filter(post => post.type === 'post');
  const reels = allUserPosts.filter(post => post.type === 'reel');
  const viewsByDay = Array.from({ length: 30 }, (_, index) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (29 - index));
    const start = day.getTime();
    const end = start + 24 * 60 * 60 * 1000;
    return { date: day.toISOString().slice(0, 10), views: allUserPosts.reduce((sum, post) => sum + (post.viewRecords || []).filter(record => record.viewedAt >= start && record.viewedAt < end).length, 0) };
  });
  const user = db.getUserById(authUser.id);
  const ranked = [...posts].sort((a, b) => (b.viewsCount || 0) - (a.viewsCount || 0));
  res.json({
    stats: {
      views: allUserPosts.reduce((sum, post) => sum + (post.viewsCount || 0), 0),
      likes: allUserPosts.reduce((sum, post) => sum + post.reactions.length, 0),
      comments: allUserPosts.reduce((sum, post) => sum + post.comments.length, 0),
    followers: identityPage ? identityPage.followers.length : user?.friends?.length || 0,
      posts: posts.length
    },
    viewsByDay,
    posts: ranked.map(populatePost),
    reels: reels.sort((a, b) => (b.viewsCount || 0) - (a.viewsCount || 0)).map(populatePost)
  });
});

app.post('/api/posts/:id/view', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  const post = db.recordPostView(req.params.id, authUser.id);
  if (!post || !db.canViewPost(post, authUser.id)) return res.status(404).json({ error: 'Post not found' });
  res.json({ viewsCount: post.viewsCount || 0 });
});

app.get('/api/posts/:id/viewers', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  const post = db.getPostById(req.params.id);
  if (!post || post.authorId !== authUser.id) return res.status(404).json({ error: 'Post not found' });
  const viewers = db.getPostViewRecords(post.id).map(record => {
    const viewer = db.getUserById(record.userId);
    return viewer ? { id: viewer.id, name: viewer.name, avatar: viewer.avatar, viewedAt: record.viewedAt } : null;
  }).filter((viewer): viewer is NonNullable<typeof viewer> => Boolean(viewer));
  res.json(viewers);
});

app.post('/api/posts', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

  const { content, mediaUrl, mediaType, feeling, privacy, taggedUserIds, type, thumbnailUrl, mediaDuration, mediaSize } = req.body;
  const v2 = req.body.v2 && typeof req.body.v2 === 'object' ? req.body.v2 : undefined;
  const requestedMediaUrls = Array.isArray(req.body.mediaUrls) ? req.body.mediaUrls : [];
  if (requestedMediaUrls.length > 12) return res.status(400).json({ error: 'A post can include at most 12 images' });
  const validMediaUrls: string[] = [];
  for (const url of requestedMediaUrls as unknown[]) {
    if (typeof url === 'string' && (/^https:\/\//i.test(url) || url.startsWith('/uploads/'))) validMediaUrls.push(url);
  }
  const mediaUrls: string[] = Array.from(new Set<string>(validMediaUrls)).slice(0, 12);
  const primaryMediaUrl: string | undefined = mediaUrls[0] || (typeof mediaUrl === 'string' ? mediaUrl : undefined);
  if (!content && !primaryMediaUrl) {
    return res.status(400).json({ error: 'Post must contain text or media' });
  }
  const safePrivacy = privacy === 'friends' || privacy === 'only_me' ? privacy : 'public';
  const safeThumbnail = typeof thumbnailUrl === 'string' && (/^https:\/\//i.test(thumbnailUrl) || thumbnailUrl.startsWith('/uploads/')) ? thumbnailUrl : undefined;
  const safeDuration = Number.isFinite(Number(mediaDuration)) && Number(mediaDuration) >= 0 ? Math.min(60 * 60 * 24, Number(mediaDuration)) : undefined;
  const safeMediaSize = Number.isSafeInteger(Number(mediaSize)) && Number(mediaSize) > 0 && Number(mediaSize) <= 250 * 1024 * 1024 ? Number(mediaSize) : undefined;
  const requestedPageId = String(req.get('x-page-id') || '');
  const actingPage = requestedPageId ? db.getPageById(requestedPageId) : null;
  if (requestedPageId && actingPage?.ownerId !== authUser.id) return res.status(403).json({ error: 'You do not manage this Page' });

  // Only your own friends can be tagged (max 20, no duplicates, nobody who blocked you)
  const cleanTaggedIds: string[] = Array.isArray(taggedUserIds)
    ? [...new Set(taggedUserIds.filter((id: unknown): id is string => typeof id === 'string'))]
        .filter(id => id !== authUser.id && authUser.friends.includes(id) && !db.isBlockedBetween(authUser.id, id))
        .slice(0, 20)
    : [];

  const requestedType = type === 'reel' && mediaType === 'video' ? 'reel' : 'post';
  const post = db.createPost(
    authUser.id,
    content || '',
    primaryMediaUrl,
    mediaType,
    feeling,
    safePrivacy,
    { taggedUserIds: cleanTaggedIds, mediaUrls, images: mediaType === 'image' ? mediaUrls : undefined, imagesCount: mediaType === 'image' ? mediaUrls.length || (primaryMediaUrl ? 1 : 0) : undefined, v2: v2 ? { feeling: typeof v2.feeling === 'string' ? v2.feeling.slice(0, 80) : undefined, privacy: safePrivacy } : undefined, type: requestedType, isReel: requestedType === 'reel', thumbnailUrl: safeThumbnail, mediaDuration: safeDuration, mediaSize: safeMediaSize }
  );
  if (actingPage) db.assignPostPageIdentity(post.id, actingPage.id);

  // Tell each tagged friend (not for private "only me" posts)
  if (safePrivacy !== 'only_me') {
    for (const uid of cleanTaggedIds) {
      const n = db.addNotification({
        userId: uid,
        actorId: authUser.id,
        type: 'post_tag',
        message: `${authUser.name} tagged you in a post`,
        targetId: post.id,
        read: false
      });
      socketManager.sendToUser(uid, { type: 'new_notification', notification: populateNotification(n) });
    }
  }

  if (safePrivacy === 'public' || safePrivacy === 'friends') {
    for (const uid of authUser.friends.filter(id => !cleanTaggedIds.includes(id) && !db.isBlockedBetween(authUser.id, id))) {
      const notification = db.addNotification({
        userId: uid,
        actorId: authUser.id,
        type: 'post_new',
        message: `${authUser.name} shared a new post`,
        targetId: post.id,
        read: false
      });
      socketManager.sendToUser(uid, { type: 'new_notification', notification: populateNotification(notification) });
    }
  }

  const populated = populatePost(post);
  // Real-time push only for posts everyone may see; private ones reach just the people allowed to.
  if (safePrivacy === 'public') {
    socketManager.broadcast({ type: 'new_post', post: populated });
  } else {
    const audience = safePrivacy === 'friends' ? [authUser.id, ...authUser.friends] : [authUser.id];
    audience.forEach(uid => socketManager.sendToUser(uid, { type: 'new_post', post: populated }));
  }

  res.json(populated);
});

app.post('/api/posts/:id/react', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

  const { type } = req.body;
  const before = db.getPostById(req.params.id);
  const hadReaction = Boolean(before?.reactions.some(reaction => reaction.userId === authUser.id));
  const post = db.toggleReaction(req.params.id, authUser.id, type || 'like');
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const populated = populatePost(post);
  socketManager.broadcast({ type: 'post_updated', post: populated });
  if (!hadReaction && post.authorId !== authUser.id) {
    const notification = db.addNotification({ userId: post.authorId, actorId: authUser.id, type: 'post_reaction', message: `${authUser.name} liked your post`, targetId: post.id, read: false });
    socketManager.sendToUser(post.authorId, { type: 'new_notification', notification: populateNotification(notification) });
  }

  res.json(populated);
});

app.post('/api/posts/:id/comment', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Comment content cannot be empty' });
  }

  const result = db.addComment(req.params.id, authUser.id, content.trim());
  if (!result) return res.status(404).json({ error: 'Post not found' });

  const populated = populatePost(result.post);
  socketManager.broadcast({ type: 'post_updated', post: populated });
  if (result.post.authorId !== authUser.id) {
    const notification = db.addNotification({ userId: result.post.authorId, actorId: authUser.id, type: 'post_comment', message: `${authUser.name} commented on your post`, targetId: result.post.id, read: false });
    socketManager.sendToUser(result.post.authorId, { type: 'new_notification', notification: populateNotification(notification) });
  }

  res.json(populated);
});

app.post('/api/posts/:id/share', (req: Request, res: Response) => {
  try {
    const original = db.getPostById(req.params.id);
    if (!original) return res.status(404).json({ error: 'Post not found' });
    const { toTimeline, comment, privacy } = (req.body ?? {}) as { toTimeline?: unknown; comment?: unknown; privacy?: unknown };

    // Share onto your own timeline: creates a new post that embeds the original
    if (toTimeline === true) {
      const authUser = getAuthUser(req);
      if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
      if (!db.canViewPost(original, authUser.id)) return res.status(404).json({ error: 'Post not found' });
      if (original.privacy !== 'public' && original.authorId !== authUser.id) {
        return res.status(403).json({ error: 'Only public posts can be shared to your timeline.' });
      }

      const rootId = original.sharedPostId ?? original.id; // re-sharing a share points to the real original
      const root = db.getPostById(rootId);
      if (!root) return res.status(404).json({ error: 'The original post is no longer available.' });

      const text = typeof comment === 'string' ? comment.trim().slice(0, 2000) : '';
      const sharedPrivacy = privacy === 'friends' || privacy === 'only_me' ? privacy : 'public';
      const shared = db.createPost(authUser.id, text, undefined, undefined, undefined, sharedPrivacy, { sharedPostId: rootId });
      db.sharePost(rootId);

      const populatedShared = populatePost(shared);
      if (sharedPrivacy === 'public') {
        socketManager.broadcast({ type: 'new_post', post: populatedShared });
      } else {
        const audience = sharedPrivacy === 'friends' ? [authUser.id, ...authUser.friends] : [authUser.id];
        audience.forEach(uid => socketManager.sendToUser(uid, { type: 'new_post', post: populatedShared }));
      }
      socketManager.broadcast({ type: 'post_updated', post: populatePost(db.getPostById(rootId)!) });

      if (root.authorId !== authUser.id && sharedPrivacy === 'public') {
        const n = db.addNotification({
          userId: root.authorId,
          actorId: authUser.id,
          type: 'post_share',
          message: `${authUser.name} shared your post`,
          targetId: shared.id,
          read: false
        });
        socketManager.sendToUser(root.authorId, { type: 'new_notification', notification: populateNotification(n) });
      }
      return res.status(201).json({ success: true, post: populatedShared, sharesCount: db.getPostById(rootId)?.sharesCount });
    }

    // Shared outside Echat (WhatsApp, Facebook...): just count it
    db.sharePost(req.params.id);
    const post = db.getPostById(req.params.id);
    if (post) socketManager.broadcast({ type: 'post_updated', post: populatePost(post) });
    res.json({ success: true, sharesCount: post?.sharesCount });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/posts/:id/report', (req: Request, res: Response) => {
  const { reason } = req.body;
  const success = db.reportPost(req.params.id, reason || 'Inappropriate content');
  res.json({ success, message: 'Report submitted for review.' });
});

app.put('/api/posts/:id', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

    const { content, privacy, feeling } = req.body as { content?: unknown; privacy?: unknown; feeling?: unknown };
    const existing = db.getPostById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Post not found' });
    if (existing.authorId !== authUser.id) return res.status(403).json({ error: 'You can only edit your own posts' });

    const newContent = typeof content === 'string' ? content.trim() : undefined;
    if (newContent !== undefined && !newContent && !existing.mediaUrl) {
      return res.status(400).json({ error: 'A post needs text or a photo/video' });
    }

    const updated = db.updatePost(req.params.id, authUser.id, {
      ...(newContent !== undefined && { content: newContent }),
      ...((privacy === 'public' || privacy === 'friends' || privacy === 'only_me') && { privacy }),
      ...(typeof feeling === 'string' && { feeling })
    });
    if (!updated) return res.status(403).json({ error: 'Cannot edit this post' });

    const populated = populatePost(updated);
    socketManager.broadcast({ type: 'post_updated', post: populated });
    res.json(populated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ----------------- SAVED POSTS & TRENDING -----------------
app.post('/api/posts/:id/save', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
    const result = db.toggleSavedPost(authUser.id, req.params.id);
    if (!result) return res.status(404).json({ error: 'Post not found' });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/saved', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
    res.json(db.getSavedPosts(authUser.id).map(p => populatePost(p)));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/trending', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    res.json(db.getTrendingTags(8, authUser?.id));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/posts/:id', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

  const before = db.getPostById(req.params.id);
  const success = db.deletePost(req.params.id, authUser.id);
  if (!success) return res.status(403).json({ error: 'Failed or not authorized to delete post' });
  if (before && before.authorId !== authUser.id && isDeveloperUser(authUser)) {
    audit(authUser, 'post.delete', { type: 'post', id: before.id, name: db.getUserById(before.authorId)?.name }, (before.content || '').slice(0, 100));
  }

  socketManager.broadcast({ type: 'post_deleted', postId: req.params.id });
  res.json({ success: true });
});

// ----------------- STORIES (24H STATUS) ROUTES -----------------
app.get('/api/stories', (req: Request, res: Response) => {
  const me = getAuthUser(req);
  const stories = db.getActiveStories();
  const populated = stories.map(s => {
    const author = db.getUserById(s.authorId);
    // Only the story owner sees who viewed it (names and photos). Everyone else gets just
    // their own entry, which is enough for the "already seen" ring on the stories bar.
    const viewers = me && me.id === s.authorId
      ? s.viewers.map(v => {
          const viewer = db.getUserById(v.userId);
          return { ...v, user: viewer ? { id: viewer.id, name: viewer.name, avatar: viewer.avatar } : null };
        })
      : s.viewers.filter(v => me && v.userId === me.id);
    return {
      ...s,
      viewers,
      author: author ? db.sanitizeUser(author) : { name: 'User', avatar: '' }
    };
  });
  res.json(populated);
});

app.post('/api/stories', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

  const { type, mediaUrl, text, backgroundGradient } = req.body;
  const story = db.createStory(authUser.id, type || 'image', mediaUrl, text, backgroundGradient);

  const populated = {
    ...story,
    author: db.sanitizeUser(authUser)
  };

  socketManager.broadcast({ type: 'story_created', story: populated });
  res.json(populated);
});

app.post('/api/stories/:id/view', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

  const story = db.getStoryById(req.params.id);
  if (!story || story.authorId !== authUser.id) db.viewStory(req.params.id, authUser.id);
  const updated = db.getStoryById(req.params.id);
  res.json({ success: true, story: updated ? {
    ...updated,
    author: db.sanitizeUser(db.getUserById(updated.authorId)!),
    viewers: updated.authorId === authUser.id ? updated.viewers.map(v => {
      const viewer = db.getUserById(v.userId);
      return { ...v, user: viewer ? { id: viewer.id, name: viewer.name, avatar: viewer.avatar } : null };
    }) : []
  } : null });
});

// ----------------- MESSAGES / CHAT ROUTES -----------------
// Isolated 1-on-1 DM routes. These use the dedicated Mongo collection and never touch
// the legacy `messages` array or its write-through persistence.
/**
 * Messages from the older chat store (story replies, missed calls, Marketplace orders, game invites)
 * shown in the Messages page too, so every unread message can be opened and the badge can reach 0.
 */
function legacyAsDirect(m: Message): DirectMessageRecord {
  const missed = /^__echat_missed_call__:(audio|video)$/.exec(m.text || '');
  return {
    _id: m.id,
    senderId: m.senderId,
    receiverId: m.receiverId,
    text: missed ? `[CALL]Missed ${missed[1] === 'video' ? 'video' : 'voice'} call` : (m.text || ''),
    ...(m.mediaUrl ? { mediaUrl: m.mediaUrl, mediaType: m.mediaType } : {}),
    ...(m.audioDuration !== undefined ? { audioDuration: m.audioDuration } : {}),
    ...(m.attachments?.length ? { attachments: m.attachments } : {}),
    createdAt: m.createdAt,
    readAt: m.status === 'seen' ? m.createdAt : null,
    ...(m.editedAt ? { editedAt: m.editedAt } : {}),
    ...(m.deletedForEveryone ? { deletedForEveryone: true } : {}),
    ...(m.replyTo ? { replyTo: m.replyTo } : {})
  } as DirectMessageRecord;
}

// ----- Chat actions: edit, delete for everyone / for me, clear chat (only for me), reply -----
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const MEDIA_TEXT = /^(\[(VOICE|AUDIO|IMAGE|VIDEO|FILE|CALL|SIGNAL)\]|data:|__echat_missed_call__)/;
/** Hidden for this viewer? ("Delete for me", or older than their "Clear chat"). */
function visibleDm(viewerId: string, m: DirectMessageRecord): boolean {
  const partnerId = m.senderId === viewerId ? m.receiverId : m.senderId;
  return !(m.deletedFor || []).includes(viewerId) && Number(m.createdAt) > db.chatClearedAt(viewerId, partnerId);
}
/** What the app receives: deleted-for-everyone messages carry no content; nobody sees who hid what. */
function presentDm(m: DirectMessageRecord): DirectMessageRecord {
  const { deletedFor: _hidden, ...rest } = m;
  void _hidden;
  if (!m.deletedForEveryone) return rest as DirectMessageRecord;
  return { _id: m._id, senderId: m.senderId, receiverId: m.receiverId, text: '', createdAt: m.createdAt, readAt: m.readAt, deletedForEveryone: true, ...(m.deletedAt ? { deletedAt: m.deletedAt } : {}) };
}
type FoundMessage = { store: 'dm' | 'legacy'; message: DirectMessageRecord };
async function findChatMessage(id: string): Promise<FoundMessage | null> {
  if (!/^[\w-]{1,80}$/.test(id)) return null;
  const legacy = id.startsWith('msg_') ? db.getLegacyMessage(id) : undefined;
  if (legacy) return { store: 'legacy', message: { ...legacyAsDirect(legacy), deletedFor: legacy.deletedFor } };
  const dm = await db.getDirectMessage(id);
  return dm ? { store: 'dm', message: dm } : null;
}
async function reloadChatMessage(found: FoundMessage): Promise<DirectMessageRecord | null> {
  return (await findChatMessage(found.message._id))?.message || null;
}
function emitMessageUpdate(message: DirectMessageRecord) {
  const payload = { type: 'direct_message_updated', message: presentDm(message) };
  socketManager.sendToUser(message.senderId, payload);
  socketManager.sendToUser(message.receiverId, payload);
}

app.patch('/api/dm/message/:id', async (req: Request, res: Response) => {
  const authUser = getAuthUser(req)!;
  const found = await findChatMessage(String(req.params.id));
  if (!found || !visibleDm(authUser.id, found.message)) return res.status(404).json({ error: 'Message not found' });
  const message = found.message;
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (message.senderId !== authUser.id) return res.status(403).json({ error: 'You can only edit your own messages.' });
  if (message.deletedForEveryone) return res.status(400).json({ error: 'This message was deleted.' });
  if (!message.text || MEDIA_TEXT.test(message.text) || message.mediaUrl || message.attachments?.length) return res.status(400).json({ error: 'Only text messages can be edited.' });
  if (Date.now() - Number(message.createdAt) > EDIT_WINDOW_MS) return res.status(400).json({ error: 'Messages can only be edited for 15 minutes after sending.' });
  if (!text || text.length > 2000 || MEDIA_TEXT.test(text)) return res.status(400).json({ error: 'Type the new message (up to 2000 characters).' });
  if (text === message.text) return res.json(presentDm(message));
  const editedAt = Date.now();
  if (found.store === 'dm') await db.updateDirectMessage(message._id, { set: { text, editedAt } });
  else db.updateLegacyMessage(message._id, { text, editedAt });
  const updated = await reloadChatMessage(found);
  if (!updated) return res.status(404).json({ error: 'Message not found' });
  emitMessageUpdate(updated);
  res.json(presentDm(updated));
});

app.post('/api/dm/message/:id/delete', async (req: Request, res: Response) => {
  const authUser = getAuthUser(req)!;
  const scope = req.body?.scope === 'everyone' ? 'everyone' : 'me';
  const found = await findChatMessage(String(req.params.id));
  const message = found?.message;
  if (!found || !message || (message.senderId !== authUser.id && message.receiverId !== authUser.id) || !visibleDm(authUser.id, message)) return res.status(404).json({ error: 'Message not found' });
  if (scope === 'everyone') {
    if (message.senderId !== authUser.id) return res.status(403).json({ error: 'You can only delete your own messages for everyone.' });
    if (!message.deletedForEveryone) {
      const deletedAt = Date.now();
      const wipe: (keyof DirectMessageRecord)[] = ['mediaUrl', 'mediaType', 'attachments', 'audioDuration', 'replyTo', 'editedAt'];
      if (found.store === 'dm') await db.updateDirectMessage(message._id, { set: { deletedForEveryone: true, deletedAt, text: '' }, unset: wipe });
      else db.updateLegacyMessage(message._id, { deletedForEveryone: true, text: '' }, ['mediaUrl', 'mediaType', 'attachments', 'audioDuration', 'replyTo', 'editedAt', 'editHistory']);
    }
    const updated = await reloadChatMessage(found);
    if (updated) emitMessageUpdate(updated);
    syncUnread(message.receiverId);
    return res.json({ success: true, message: updated ? presentDm(updated) : null });
  }
  if (found.store === 'dm') await db.updateDirectMessage(message._id, { addDeletedFor: authUser.id });
  else db.deleteMessageForUser(message._id, authUser.id);
  socketManager.sendToUser(authUser.id, { type: 'direct_message_hidden', id: message._id });
  syncUnread(authUser.id);
  res.json({ success: true });
});

app.post('/api/dm/:userId/clear', async (req: Request, res: Response) => {
  const authUser = getAuthUser(req)!;
  const partnerId = String(req.params.userId || '');
  if (!db.getUserById(partnerId)) return res.status(404).json({ error: 'User not found' });
  const now = Date.now();
  db.clearChatFor(authUser.id, partnerId, now);
  // Nothing hidden may stay "unread", or the badge would get stuck.
  await db.markDirectMessagesRead(partnerId, authUser.id, now).catch(() => {});
  db.markConversationSeen(authUser.id, partnerId);
  db.markMessageNotificationsRead(authUser.id, partnerId);
  socketManager.sendToUser(authUser.id, { type: 'dm_chat_cleared', partnerId, clearedAt: now });
  res.json({ success: true, clearedAt: now });
});

app.get('/api/dm/conversations', async (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const messages = [...await db.listDirectMessagesForUser(authUser.id), ...db.listLegacyMessagesForUser(authUser.id).map(legacyAsDirect)]
      .filter(message => visibleDm(authUser.id, message)).map(presentDm);
    const latestByPartner = new Map<string, typeof messages[number]>();
    for (const message of messages) {
      const partnerId = message.senderId === authUser.id ? message.receiverId : message.senderId;
      const current = latestByPartner.get(partnerId);
      if (!current || message.createdAt > current.createdAt) latestByPartner.set(partnerId, message);
    }
    const conversations = [...latestByPartner.entries()].map(([partnerId, lastMessage]) => {
      const partner = db.getUserById(partnerId);
      if (!partner) return null;
      return {
        user: db.sanitizeUser(partner, authUser.id),
        lastMessage,
        unreadCount: messages.filter(message => message.senderId === partnerId && message.receiverId === authUser.id && message.readAt === null).length
      };
    }).filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((a, b) => b.lastMessage.createdAt - a.lastMessage.createdAt);
    return res.json({ conversations });
  } catch (error) {
    console.error('[DM] Could not list conversations:', error);
    return res.status(503).json({ error: 'Direct messaging storage is unavailable' });
  }
});

app.get('/api/dm/:userId', async (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  const otherUserId = String(req.params.userId || '');
  if (otherUserId !== authUser.id && !db.getUserById(otherUserId)) return res.status(404).json({ error: 'User not found' });
  try {
    const merged = [...await db.listDirectMessagesBetween(authUser.id, otherUserId), ...db.getConversation(authUser.id, otherUserId).map(legacyAsDirect)]
      .filter(message => visibleDm(authUser.id, message)).map(presentDm);
    return res.json(merged.sort((a, b) => Number(a.createdAt) - Number(b.createdAt)));
  } catch (error) {
    console.error('[DM] Could not load conversation:', error);
    return res.status(503).json({ error: 'Direct messaging storage is unavailable' });
  }
});

app.post('/api/dm/:userId/read', async (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  const senderId = String(req.params.userId || '');
  if (!db.getUserById(senderId)) return res.status(404).json({ error: 'User not found' });
  try {
    const readAt = Date.now();
    // Opening a chat reads EVERYTHING from that person, in both chat stores, so the badge goes to 0.
    await db.markDirectMessagesRead(senderId, authUser.id, readAt);
    db.markConversationSeen(authUser.id, senderId);
    db.markMessageNotificationsRead(authUser.id, senderId);
    socketManager.sendToUser(senderId, {
      type: 'direct_messages_read',
      readerId: authUser.id,
      senderId,
      readAt
    });
    return res.json({ success: true });
  } catch (error) {
    console.error('[DM] Could not mark conversation read:', error);
    return res.status(503).json({ error: 'Direct messaging storage is unavailable' });
  }
});

app.post('/api/dm/:userId', async (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  const receiverId = String(req.params.userId || '');
  const rawText = typeof req.body?.text === 'string' ? req.body.text : '';
  const trimmedText = rawText.trim();
  let text = trimmedText;
  let mediaUrl = typeof req.body?.mediaUrl === 'string' ? req.body.mediaUrl : '';
  let mediaType = typeof req.body?.mediaType === 'string' ? req.body.mediaType : '';
  const audioDuration = typeof req.body?.audioDuration === 'number' ? req.body.audioDuration : undefined;
  const rawAttachments: unknown[] = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
  if (rawAttachments.length > 10) return res.status(400).json({ error: 'Attach up to 10 files per message' });
  const attachments: { url: string; name: string; mimeType: string; size: number }[] = [];
  for (const value of rawAttachments) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return res.status(400).json({ error: 'One or more attachments are invalid' });
    }
    const attachment = value as Record<string, unknown>;
    const { url, name, mimeType, size } = attachment;
    if (
      typeof url !== 'string' ||
      (!/^https:\/\//i.test(url) && !url.startsWith('/uploads/')) ||
      typeof name !== 'string' ||
      typeof mimeType !== 'string' ||
      typeof size !== 'number' ||
      !Number.isFinite(size) ||
      size < 0
    ) return res.status(400).json({ error: 'One or more attachments are invalid' });
    attachments.push({
      url,
      name: name.slice(0, 180),
      mimeType: mimeType.slice(0, 120),
      size
    });
  }
  if (!mediaUrl && trimmedText.startsWith('data:')) {
    mediaUrl = trimmedText;
    text = typeof req.body?.caption === 'string' ? req.body.caption.trim() : '';
    if (!mediaType) {
      if (trimmedText.startsWith('data:audio')) mediaType = 'audio';
      else if (trimmedText.startsWith('data:image')) mediaType = 'image';
      else if (trimmedText.startsWith('data:video')) mediaType = 'video';
      else mediaType = 'file';
    }
  }
  if (!text && !mediaUrl && attachments.length === 0) return res.status(400).json({ error: 'Message text or an attachment is required' });
  if (text && !text.startsWith('data:') && !text.startsWith('[') && text.length > 2000) return res.status(400).json({ error: 'Message must be 2000 characters or fewer' });
  if (mediaUrl.length > 15000000) return res.status(413).json({ error: 'File is too large' });
  if (!db.getUserById(receiverId)) return res.status(404).json({ error: 'Recipient not found' });
  if (receiverId === authUser.id) return res.status(400).json({ error: 'You cannot message yourself' });
  // Swipe-to-reply: quote must be a message in THIS chat that the sender can still see.
  let replyTo: DirectMessageRecord['replyTo'];
  if (typeof req.body?.replyToId === 'string' && req.body.replyToId) {
    const quoted = (await findChatMessage(req.body.replyToId))?.message;
    const sameChat = quoted && ((quoted.senderId === authUser.id && quoted.receiverId === receiverId) || (quoted.senderId === receiverId && quoted.receiverId === authUser.id));
    if (quoted && sameChat && visibleDm(authUser.id, quoted)) {
      replyTo = { id: quoted._id, senderId: quoted.senderId, senderName: db.getUserById(quoted.senderId)?.name || 'EChat user', preview: messagePreview(quoted) };
    }
  }
  const message = {
    _id: crypto.randomUUID(),
    senderId: authUser.id,
    receiverId,
    ...(replyTo ? { replyTo } : {}),
    text,
    ...(mediaUrl ? { mediaUrl, mediaType } : {}),
    ...(audioDuration !== undefined ? { audioDuration } : {}),
    ...(attachments.length ? { attachments } : {}),
    createdAt: Date.now(),
    readAt: null
  };
  try {
    await db.insertDirectMessage(message);
    const receiver = db.getUserById(receiverId);
    if (receiver) {
      socketManager.sendToUser(authUser.id, {
        type: 'direct_message',
        message,
        partner: db.sanitizeUser(receiver, authUser.id)
      });
      socketManager.sendToUser(receiverId, {
        type: 'direct_message',
        message,
        partner: db.sanitizeUser(authUser, receiverId)
      });
      // Never base64 in a notification: voice -> "🎤 Voice message", photo -> "📷 Photo", text -> 50 chars.
      const preview = messagePreview({ text, mediaType, mediaUrl, attachments });
      const notif = db.upsertMessageNotification(receiverId, authUser.id, `${authUser.name}: ${preview}`);
      socketManager.sendToUser(receiverId, { type: 'new_notification', notification: populateNotification(notif) });
      pushTo([receiverId], { kind: 'message', title: authUser.name, body: preview, url: `/messages?chat=${encodeURIComponent(authUser.id)}`, tag: `chat-${authUser.id}`, icon: pushIcon(authUser.avatar) });
    }
    return res.status(201).json(message);
  } catch (error) {
    console.error('[DM] Could not send message:', error);
    return res.status(503).json({ error: 'Direct messaging storage is unavailable' });
  }
});

app.get('/api/conversations', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  res.json(db.getConversationPartners(authUser.id));
});

app.get('/api/messages/:partnerId', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

  const messages = db.getConversation(authUser.id, req.params.partnerId);
  res.json(messages);
});

app.post('/api/messages', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

  const { receiverId, text, mediaUrl, mediaType, audioDuration } = req.body;
  const inputAttachments = Array.isArray(req.body.attachments) ? req.body.attachments : [];
  if (inputAttachments.length > 10) return res.status(400).json({ error: 'Attach up to 10 files per message' });
  const attachments = inputAttachments.filter((file: any) => file && typeof file.url === 'string' && (/^https:\/\//i.test(file.url) || file.url.startsWith('/uploads/')) && typeof file.name === 'string' && typeof file.mimeType === 'string' && Number.isFinite(file.size) && file.size >= 0).slice(0, 10);
  if (!receiverId || (!text && !mediaUrl && attachments.length === 0)) {
    return res.status(400).json({ error: 'Recipient and message content required' });
  }

  const receiver = db.getUserById(receiverId);
  if (!receiver) return res.status(404).json({ error: 'Recipient not found' });
  if (db.isBlockedBetween(authUser.id, receiverId)) {
    return res.status(403).json({ error: 'You cannot message this person.' });
  }
  const status = receiver.isOnline ? 'delivered' : 'sent';

  const message = db.addMessage({
    senderId: authUser.id,
    receiverId,
    text,
    mediaUrl,
    mediaType,
    audioDuration,
    attachments,
    ...(req.body.v2_market_order && typeof req.body.v2_market_order === 'object' ? { v2_market_order: req.body.v2_market_order } : {}),
    status
  });

  // Real-time dispatch via WebSocket
  socketManager.sendToUser(receiverId, {
    type: 'new_message',
    message
  });

  socketManager.sendToUser(authUser.id, {
    type: 'message_sent',
    message
  });

  // Bell notification for the recipient (one rolling entry per sender), pushed live
  const what = messagePreview({ text, mediaType, mediaUrl, attachments });
  const notif = db.upsertMessageNotification(receiverId, authUser.id, `${authUser.name}: ${what}`);
  socketManager.sendToUser(receiverId, { type: 'new_notification', notification: populateNotification(notif) });
  // Push to the phone too (works with eChat closed). One notification per chat: newer ones replace it.
  pushTo([receiverId], { kind: 'message', title: authUser.name, body: what, url: `/messages?chat=${encodeURIComponent(authUser.id)}`, tag: `chat-${authUser.id}`, icon: pushIcon(authUser.avatar) });

  res.json(message);
});

app.delete('/api/messages/:id', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  if (!db.deleteMessageForUser(req.params.id, authUser.id)) return res.status(404).json({ error: 'Message not found' });
  socketManager.sendToUser(authUser.id, { type: 'message_deleted', messageId: req.params.id, userId: authUser.id });
  res.json({ success: true, messageId: req.params.id });
});

app.put('/api/messages/:id', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text || text.length > 4000) return res.status(400).json({ error: 'Message text must be 1 to 4000 characters' });
  const current = db.getConversationPartners(authUser.id).flatMap(partnerId => db.getConversation(authUser.id, partnerId)).find(message => message.id === req.params.id);
  if (!current || current.senderId !== authUser.id) return res.status(404).json({ error: 'Message not found' });
  if (!current.text || current.mediaUrl || current.mediaType || current.attachments?.length) return res.status(400).json({ error: 'Only text messages can be edited' });
  if (Date.now() - current.createdAt > 15 * 60 * 1000) return res.status(403).json({ error: 'Messages can only be edited within 15 minutes' });
  const updated = db.editMessage(current.id, authUser.id, text);
  if (!updated) return res.status(403).json({ error: 'This message can no longer be edited' });
  const visibleMessage = { ...updated };
  delete visibleMessage.editHistory;
  socketManager.sendToUser(updated.senderId, { type: 'message_updated', event: 'message-edited', message: visibleMessage });
  socketManager.sendToUser(updated.receiverId, { type: 'message_updated', event: 'message-edited', message: visibleMessage });
  res.json(visibleMessage);
});

app.post('/api/messages/seen', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

  const { partnerId } = req.body;
  db.markConversationSeen(authUser.id, partnerId);
  void db.markDirectMessagesRead(String(partnerId), authUser.id, Date.now()).catch(() => {});
  db.markMessageNotificationsRead(authUser.id, partnerId);

  socketManager.sendToUser(partnerId, {
    type: 'messages_seen',
    viewerId: authUser.id
  });

  res.json({ success: true });
});

// ----------------- NOTIFICATIONS ROUTES -----------------
function birthdayParts(dob: string, year: number) {
  const [month, day] = dob.slice(5).split('-').map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return month === 2 && day === 29 && !leapYear ? { month: 2, day: 28 } : { month, day };
}

function birthdayDayDistance(dob: string, today: Date) {
  const year = today.getUTCFullYear();
  const todayUtc = Date.UTC(year, today.getUTCMonth(), today.getUTCDate());
  let { month, day } = birthdayParts(dob, year);
  let target = Date.UTC(year, month - 1, day);
  if (target < todayUtc) {
    ({ month, day } = birthdayParts(dob, year + 1));
    target = Date.UTC(year + 1, month - 1, day);
  }
  return Math.round((target - todayUtc) / 86_400_000);
}

function runBirthdayReminders() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Freetown', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const value = (key: string) => parts.find(part => part.type === key)?.value || '';
  if (value('hour') !== '00' || value('minute') !== '01') return;
  const dayKey = `${value('year')}-${value('month')}-${value('day')}`;
  if (lastBirthdayReminderRun === dayKey) return;
  lastBirthdayReminderRun = dayKey;
  const today = new Date(`${dayKey}T00:00:00Z`);
  const year = today.getUTCFullYear();
  for (const birthdayUser of db.getUsers()) {
    if (!birthdayUser.dob || birthdayUser.dobVisibility === 'only_me') continue;
    const days = birthdayDayDistance(birthdayUser.dob, today);
    if (days !== 0 && days !== 1) continue;
    for (const friendId of birthdayUser.friends) {
      const friend = db.getUserById(friendId);
      if (!friend || !friend.friends.includes(birthdayUser.id) || friend.birthdayReminderEnabled === false) continue;
      const type = days === 0 ? 'birthday_today' : 'birthday_reminder';
      const targetId = `birthday:${birthdayUser.id}:${year}:${type}`;
      if (db.getNotifications(friend.id).some(item => item.actorId === birthdayUser.id && item.targetId === targetId)) continue;
      const message = days === 0 ? `Today is ${birthdayUser.name}'s birthday! Wish them a Happy Birthday 🎂` : `Tomorrow is ${birthdayUser.name}'s birthday! Send them a birthday wish.`;
      const notification = db.addNotification({ userId: friend.id, actorId: birthdayUser.id, type, targetId, message, read: false });
      socketManager.sendToUser(friend.id, { type: 'new_notification', notification: { ...notification, actor: db.sanitizeUser(birthdayUser, friend.id) } });
    }
  }
}

let lastBirthdayReminderRun = '';
setInterval(runBirthdayReminders, 60_000).unref();

app.get('/api/birthdays', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  const today = new Date();
  const friends = authUser.friends.flatMap(friendId => {
    const friend = db.getUserById(friendId);
    if (!friend || !friend.friends.includes(authUser.id) || !friend.dob || friend.dobVisibility === 'only_me') return [];
    const days = birthdayDayDistance(friend.dob, today);
    if (days < 0 || days > 7) return [];
    const canShowAge = friend.dobVisibility !== 'month_day_only';
    const birthYear = Number(friend.dob.slice(0, 4));
    const birthday = birthdayParts(friend.dob, today.getUTCFullYear());
    const turns = canShowAge ? today.getUTCFullYear() - birthYear + (days > 300 ? 1 : 0) : undefined;
    return [{ user: db.sanitizeUser(friend, authUser.id), daysUntil: days, ...(turns !== undefined && { turns }), monthDay: `${String(birthday.month).padStart(2, '0')}-${String(birthday.day).padStart(2, '0')}` }];
  }).sort((a, b) => a.daysUntil - b.daysUntil);
  res.json(friends);
});

app.get('/api/notifications', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.json([]);

  const notifs = db.getNotifications(authUser.id).map(n => {
    const actor = db.getUserById(n.actorId);
    return {
      ...n,
      message: cleanNotificationText(n.message), // older ones may contain voice/photo base64
      actor: actor ? db.sanitizeUser(actor) : null
    };
  });
  res.json(notifs);
});

app.post('/api/notifications/read', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.json({ success: true });

  // Message notifications are cleared when the chat is opened, so the bell can skip them.
  const except = req.body?.exceptMessages === true ? ['message'] : [];
  db.markNotificationsRead(authUser.id, except);
  res.json({ success: true });
});

/**
 * Likes / comments that live in Firestore (Marketplace items, profile pictures) report here so the owner
 * gets a notification. The server checks in Firestore that the like or comment really exists.
 */
const notifyRate = new Map<string, number[]>();
app.post('/api/notifications/notify', async (req: Request, res: Response) => {
  const authUser = getAuthUser(req)!;
  const kind = String(req.body?.kind || '');
  const targetId = String(req.body?.targetId || '');
  if (!['market_like', 'photo_like', 'photo_comment'].includes(kind) || !/^[\w-]{1,200}$/.test(targetId)) return res.status(400).json({ error: 'Invalid notification.' });
  if (!firestore) return res.json({ success: false });
  const recent = (notifyRate.get(authUser.id) || []).filter(at => Date.now() - at < 60_000);
  if (recent.length >= 30) return res.status(429).json({ error: 'Too many actions. Slow down a little.' });
  notifyRate.set(authUser.id, [...recent, Date.now()]);
  try {
    const actorUid = (await verifyIdTokenCached(String(req.get('x-firebase-id-token')))).uid;
    let ownerId = '';
    let type: 'market_like' | 'post_reaction' | 'post_comment';
    let message: string;
    let link: string;
    if (kind === 'market_like') {
      const [favorite, listing] = await Promise.all([
        firestore.collection('marketFavorites').doc(`${actorUid}_${targetId}`).get(),
        firestore.collection('echat_v2_market_listings').doc(targetId).get()
      ]);
      if (!favorite.exists || !listing.exists) return res.json({ success: false });
      ownerId = String(listing.get('sellerId') || '');
      type = 'market_like';
      message = `${authUser.name} liked your Marketplace item "${String(listing.get('title') || 'item').slice(0, 60)}"`;
      link = `/marketplace/listing/${encodeURIComponent(targetId)}`;
    } else {
      const post = await firestore.collection('posts').doc(targetId).get();
      if (!post.exists) return res.json({ success: false });
      ownerId = String(post.get('userId') || '');
      link = `/post/${encodeURIComponent(targetId)}`;
      if (kind === 'photo_like') {
        if (!(post.get('likes') || []).includes(actorUid)) return res.json({ success: false });
        type = 'post_reaction';
        message = `${authUser.name} liked your profile picture`;
      } else {
        const comment = await firestore.collection('posts').doc(targetId).collection('comments').where('userId', '==', actorUid).orderBy('createdAt', 'desc').limit(1).get()
          .catch(() => firestore!.collection('posts').doc(targetId).collection('comments').where('userId', '==', actorUid).limit(1).get());
        if (comment.empty) return res.json({ success: false });
        type = 'post_comment';
        const text = String(comment.docs[0].get('text') || '').slice(0, 80);
        message = `${authUser.name} commented on your profile picture${text ? `: "${text}"` : ''}`;
      }
    }
    const owner = db.getUserById(ownerId) || db.getUserByFirebaseUid(ownerId);
    if (!owner || owner.id === authUser.id || db.isBlockedBetween(owner.id, authUser.id)) return res.json({ success: false });
    // One "liked" notification per person per item (unliking and liking again doesn't spam).
    if (type !== 'post_comment' && db.getNotifications(owner.id).some(n => n.actorId === authUser.id && n.type === type && n.targetId === targetId)) return res.json({ success: true });
    const notification = db.addNotification({ userId: owner.id, actorId: authUser.id, type, targetId, link, message, read: false });
    socketManager.sendToUser(owner.id, { type: 'new_notification', notification: populateNotification(notification) });
    pushTo([owner.id], { kind: 'activity', title: 'eChat', body: message, url: link, tag: `${type}-${targetId}`, icon: pushIcon(authUser.avatar) });
    res.json({ success: true });
  } catch (error) {
    console.warn('[Notify] Could not create notification:', error instanceof Error ? error.message : error);
    res.status(503).json({ error: 'Could not send the notification.' });
  }
});

// ----------------- ADMIN / DEVELOPER ROUTES (100% GATED TO DEVELOPER) -----------------
// Lets the owner become admin by proving they know the server-side setup secret.
app.post('/api/admin/claim', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

    const secret = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if (!secret) {
      return res.status(503).json({ error: 'Admin setup is not configured. Set ADMIN_BOOTSTRAP_PASSWORD on the server.' });
    }
    const { setupPassword } = req.body as { setupPassword?: unknown };
    if (typeof setupPassword !== 'string' || !safeEqual(setupPassword, secret)) {
      return res.status(403).json({ error: 'Incorrect setup password.' });
    }

    const claimed = db.claimAdmin(authUser.id, ADMIN_EMAIL);
    if (!claimed) return res.status(404).json({ error: 'User not found' });
    console.info(`[Echat] Admin access claimed by user ${authUser.id}`);
    audit(claimed, 'admin.claim', { type: 'user', id: claimed.id, name: claimed.name });
    res.json({ user: db.sanitizeUser(claimed) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/stats', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!isAdminUser(authUser)) {
    return res.status(403).json({ error: 'Administrator access required' });
  }

  const stats = db.getAdminStats(socketManager.getActiveCount());
  res.json(stats);
});

app.get('/api/admin/analytics', (req: Request, res: Response) => {
  if (!requireDeveloper(req, res)) return;
  res.json(db.getAnalytics(Number(req.query.days) || 14));
});

app.get('/api/admin/system', (req: Request, res: Response) => {
  if (!requireDeveloper(req, res)) return;
  const mem = process.memoryUsage();
  const stats = db.getAdminStats(socketManager.getActiveCount());
  res.json({
    serverTime: Date.now(),
    uptimeSeconds: stats.uptimeSeconds,
    nodeVersion: process.version,
    memoryMB: Math.round(mem.rss / 1048576),
    heapMB: Math.round(mem.heapUsed / 1048576),
    storage: db.persistenceStats ?? 'local-file',
    onlineUsers: stats.onlineUsers,
    activeSockets: stats.activeSockets,
    environment: isProd ? 'production' : 'development'
  });
});

app.get('/api/admin/audit', (req: Request, res: Response) => {
  if (!requireDeveloper(req, res)) return;
  res.json(db.getAuditLogs(Number(req.query.limit) || 200));
});

app.post('/api/admin/announce', (req: Request, res: Response) => {
  try {
    const admin = requireDeveloper(req, res);
    if (!admin) return;
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (message.length < 3 || message.length > 500) {
      return res.status(400).json({ error: 'Announcement must be 3 to 500 characters' });
    }
    const created = db.createAnnouncement(admin.id, message);
    created.forEach(n => socketManager.sendToUser(n.userId, { type: 'new_notification', notification: populateNotification(n) }));
    audit(admin, 'announcement.send', undefined, `${created.length} people: ${message.slice(0, 120)}`);
    res.json({ success: true, sent: created.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/users/:id/verify', (req: Request, res: Response) => {
  const admin = requireDeveloper(req, res);
  if (!admin) return;
  const updated = db.toggleVerified(req.params.id);
  if (!updated) return res.status(404).json({ error: 'User not found' });
  audit(admin, updated.isVerified ? 'user.verify' : 'user.unverify', { type: 'user', id: updated.id, name: updated.name });
  res.json(db.sanitizeUser(updated));
});

app.get('/api/admin/users', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!isAdminUser(authUser)) {
    return res.status(403).json({ error: 'Administrator access required' });
  }

  const postCounts = new Map<string, number>();
  db.getPosts(authUser!.id).forEach(p => postCounts.set(p.authorId, (postCounts.get(p.authorId) ?? 0) + 1));
  const users = db.getUsers(true).map(u => ({ ...db.sanitizeUser(u), postsCount: postCounts.get(u.id) ?? 0 }));
  res.json(users);
});

app.post('/api/admin/users/:id/toggle-block', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!isAdminUser(authUser)) {
    return res.status(403).json({ error: 'Administrator access required' });
  }

  const target = db.getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.role === 'developer' || isDeveloperUser(target)) {
    return res.status(400).json({ error: 'Cannot block super developer account' });
  }

  const updated = db.updateUser(target.id, { isBlocked: !target.isBlocked });
  audit(authUser!, updated!.isBlocked ? 'user.block' : 'user.unblock', { type: 'user', id: target.id, name: target.name });
  res.json(db.sanitizeUser(updated!));
});

app.get('/api/admin/reports', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!isAdminUser(authUser)) {
    return res.status(403).json({ error: 'Administrator access required' });
  }

  const reportedPosts = db.getReportedPosts().map(p => populatePost(p));
  res.json(reportedPosts);
});

app.post('/api/admin/reports/:postId/dismiss', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!isAdminUser(authUser)) {
    return res.status(403).json({ error: 'Administrator access required' });
  }

  db.dismissReport(req.params.postId);
  audit(authUser!, 'report.dismiss', { type: 'post', id: req.params.postId });
  res.json({ success: true });
});

// Task 2: Developer Profile Controls from within console
app.post('/api/admin/developer-profile', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser || !isDeveloperUser(authUser)) {
    return res.status(403).json({ error: 'Access denied: Master Developer credentials required' });
  }

  const { name, avatar, bio, location, work, education, coverPhoto } = req.body;
  const updated = db.updateUser(authUser.id, {
    ...(name && { name: String(name).trim() }),
    ...(avatar && { avatar }),
    ...(bio !== undefined && { bio }),
    ...(location !== undefined && { location }),
    ...(work !== undefined && { work }),
    ...(education !== undefined && { education }),
    ...(coverPhoto && { coverPhoto })
  });

  if (!updated) return res.status(404).json({ error: 'Developer account not found' });
  const sanitized = db.sanitizeUser(updated);

  // Broadcast to all active sockets so chat list, posts, headers update instantly everywhere!
  socketManager.broadcast({
    type: 'developer_profile_updated',
    user: sanitized
  });

  res.json({ success: true, user: sanitized });
});

// Task 5: Only developer can verify their own account from console
app.post('/api/admin/verify-self', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser || !isDeveloperUser(authUser)) {
    return res.status(403).json({ error: 'Access denied: Master Developer credentials required' });
  }

  const updated = db.updateUser(authUser.id, {
    isVerified: true,
    isOfficialDeveloper: true
  });

  const sanitized = db.sanitizeUser(updated!);
  socketManager.broadcast({
    type: 'developer_profile_updated',
    user: sanitized
  });

  res.json({ success: true, user: sanitized });
});

// Task 5: Boost Account feature (users can boost/follow the developer account)
app.post('/api/users/:id/boost', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

  const targetId = req.params.id;
  const targetUser = db.getUserById(targetId);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  // Only the developer account can receive boosts
  if (!isDeveloperUser(targetUser)) {
    return res.status(400).json({ error: 'Boosts are exclusively for the Official Developer account' });
  }

  const result = db.boostUser(targetId, authUser.id);
  if (!result) return res.status(400).json({ error: 'Failed to boost user' });

  if (result.hasBoosted) {
    db.addNotification({
      userId: targetId,
      actorId: authUser.id,
      type: 'post_reaction',
      message: `${authUser.name} boosted your developer account! 🚀`,
      read: false
    });

    socketManager.sendToUser(targetId, {
      type: 'new_notification',
      message: `${authUser.name} boosted your developer account! 🚀`
    });
  }

  socketManager.broadcast({
    type: 'user_boosted',
    userId: targetId,
    boostsCount: result.user.boostsCount || 0
  });

  res.json({
    success: true,
    hasBoosted: result.hasBoosted,
    boostsCount: result.user.boostsCount || 0
  });
});

// ----------------- GO-LIVE SYSTEM (GATED) -----------------
app.post('/api/live/auth', async (req: Request, res: Response) => {
  const firebaseIdToken = req.get('x-firebase-id-token');
  if (!firebaseIdToken) return res.status(401).json({ error: 'Firebase sign-in is required.' });
  try {
    const decoded = await verifyFirebaseIdToken(firebaseIdToken, firebaseProjectId);
    const email = String(decoded.email || '').toLowerCase().trim();
    if (!email) return res.status(403).json({ error: 'The Firebase account has no email associated with it.' });

    // The configured developer identity is trusted from the verified Firebase ID token and
    // deliberately bypasses local mirror / Firestore reads, which may be unavailable or denied.
    const developerByUid = Boolean(SUPER_ADMIN_UID && decoded.uid === SUPER_ADMIN_UID);
    const developerByEmail = Boolean(SUPER_ADMIN_EMAIL && email === SUPER_ADMIN_EMAIL && decoded.email_verified === true);
    if (developerByUid || developerByEmail) {
      let developer = db.getUserById(decoded.uid);
      if (!developer) {
        developer = db.createUser({
          id: decoded.uid,
          name: String(decoded.name || 'Echat Developer'),
          email,
          dob: '2000-01-01',
          avatar: initialsAvatar(String(decoded.name || 'Echat Developer')),
          coverPhoto: gradientCover('Echat Developer'),
          bio: 'Echat developer',
          location: 'Global',
          work: '',
          education: '',
          role: 'developer',
          liveAccess: 'approved'
        });
      }
      developer = db.updateUser(decoded.uid, {
        email,
        role: 'super_admin',
        canApproveLive: true,
        isOfficialDeveloper: true,
        isVerified: true,
        isBlocked: false,
        liveAccess: 'approved'
      }) || developer;
      await syncLiveProfileToFirestore(developer);
      res.json({ liveAuthToken: createLiveAuthToken(developer), userId: developer.id });
      return;
    }

    let user = db.getUserById(decoded.uid) || db.getUserByFirebaseUid(decoded.uid);
    if (!user) {
      const existingEmailUser = db.getUserByEmail(email);
      if (existingEmailUser && existingEmailUser.id !== decoded.uid) {
        // Older accounts were created before Firebase sign-in, so their id is not the Firebase UID.
        // A Firebase-VERIFIED email proves the person owns that address, so link the two instead
        // of locking them out. Unverified emails are still refused.
        if (decoded.email_verified !== true) {
          console.warn('[Echat] Live auth profile UID mismatch (email not verified)', { tokenUid: decoded.uid, matchedUid: existingEmailUser.id });
          return res.status(403).json({ error: 'Verify your email address, then try Go Live again. Your Echat account is linked to this email.', code: 'email-not-verified' });
        }
        if (existingEmailUser.firebaseUid && existingEmailUser.firebaseUid !== decoded.uid) {
          return res.status(403).json({ error: 'Your Echat account is already linked to a different sign-in. Contact support.', code: 'profile-uid-mismatch' });
        }
        const linked = db.updateUser(existingEmailUser.id, { firebaseUid: decoded.uid });
        console.info('[Echat] Linked existing account to verified Firebase sign-in', { tokenUid: decoded.uid, accountId: existingEmailUser.id });
        user = linked || existingEmailUser;
      }
    }
    if (!user) {
      user = db.createUser({ id: decoded.uid, name: String(decoded.name || email.split('@')[0] || 'Echat User'), email, avatar: String(decoded.picture || ''), coverPhoto: '', bio: '', location: 'Global', work: '', education: '', role: 'user', liveAccess: 'none' });
      console.info('[Echat] Created live-access profile from verified Firebase token', { tokenUid: decoded.uid, searchedUid: decoded.uid, database: 'MongoDB/local users' });
    }
    if (user.isBlocked) return res.status(403).json({ error: 'This signed-in account cannot use Go Live.', code: 'account-blocked' });

    // Keep account age tied to server-verified sources. Prefer Firestore createdAt only when
    // it agrees with Firebase Auth metadata; without the optional Admin secret, auth_time is
    // a conservative lower bound and client-edited profile timestamps are ignored.
    const firebaseProfile = firestore
      ? await firestore.collection('users').doc(decoded.uid).get().catch(() => null)
      : null;
    const profileData = firebaseProfile?.exists ? firebaseProfile.data() : undefined;
    if (user.email.endsWith('@echat.local')) {
      const isReservedDeveloper = email === ADMIN_EMAIL;
      if (isReservedDeveloper && decoded.email_verified !== true) return res.status(403).json({ error: 'Verify the official developer email before using Go Live.' });
      const updated = db.updateUser(user.id, {
        email,
        ...(typeof profileData?.name === 'string' && { name: profileData.name }),
        ...(typeof profileData?.avatar === 'string' && { avatar: profileData.avatar }),
        ...(typeof profileData?.coverPhoto === 'string' && { coverPhoto: profileData.coverPhoto }),
        ...(isReservedDeveloper ? { role: 'developer' as const, isOfficialDeveloper: true, isVerified: true, liveAccess: 'approved' as const } : {})
      });
      if (updated) user = updated;
    }
    if (user.email.toLowerCase().trim() !== email) return res.status(403).json({ error: 'This signed-in account cannot use Go Live.' });
    // Real creation time from Firebase Admin when available; otherwise the earlier of the stored
    // server-side date and the user's last sign-in (see resolveLiveCreatedAt). Client-editable
    // Firestore timestamps are never trusted, and an older stored date is never replaced by a newer one.
    const firebaseAuth = getFirebaseAdminAuth();
    const firebaseUser = firebaseAuth ? await firebaseAuth.getUser(decoded.uid).catch(() => null) : null;
    const verifiedCreatedAt = resolveLiveCreatedAt({
      adminCreatedAt: Date.parse(firebaseUser?.metadata.creationTime || ''),
      storedCreatedAt: user.createdAt,
      authTimeMs: Number(decoded.auth_time || 0) * 1000
    });
    if (verifiedCreatedAt > 0 && user.createdAt !== verifiedCreatedAt) {
      user = db.updateUser(user.id, { createdAt: verifiedCreatedAt }) || user;
    }
    syncLiveProfileToFirestore(user);

    res.json({ liveAuthToken: createLiveAuthToken(user), userId: user.id });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || 'verification-failed') : 'verification-failed';
    console.error('[Echat] Firebase live-auth verification failed:', {
      code,
      configuredProject: firebaseProjectId,
      error: error instanceof Error ? error.message : error
    });
    res.status(401).json({ error: 'Could not verify your sign-in. Please try again.', code });
  }
});

app.get('/api/live/access', (req: Request, res: Response) => {
  const authUser = getLiveAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  const autoApproved = autoApproveMatureLiveUser(authUser);
  const request = db.getLiveRequests().find(item => item.userId === authUser.id && item.status === 'pending') || null;
  const accountAgeDays = liveAccountAgeDays(authUser);
  res.json({ liveAccess: authUser.liveAccess || 'none', mode: db.getLiveAccessMode(), canGoLive: canStartLive(authUser), request, accountAgeDays, daysUntilEligible: Math.max(0, Math.ceil(LIVE_AUTO_APPROVAL_DAYS - accountAgeDays)), autoApproved });
});

app.post('/api/live/request', (req: Request, res: Response) => {
  const authUser = getLiveAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 3 || reason.length > 500) return res.status(400).json({ error: 'Please tell us why you want to go live (3–500 characters).' });
  if (authUser.liveAccess === 'blocked') return res.status(403).json({ error: 'Your Go Live access is blocked. Contact an administrator.' });
  autoApproveMatureLiveUser(authUser);
  if (canStartLive(authUser)) return res.status(409).json({ error: 'You already have Go Live access.' });
  const request = db.createLiveRequest(authUser.id, reason);
  if (!request) return res.status(400).json({ error: 'Could not submit your request.' });
  syncLiveProfileToFirestore(db.getUserById(authUser.id));
  res.status(201).json({ success: true, request, liveAccess: 'pending' });
});

app.post('/api/live/request/cancel', (req: Request, res: Response) => {
  const authUser = getLiveAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  if (!db.cancelLiveRequest(authUser.id)) return res.status(404).json({ error: 'No pending request to cancel.' });
  syncLiveProfileToFirestore(db.getUserById(authUser.id));
  res.json({ success: true, liveAccess: 'none' });
});

app.get('/api/admin/live-access', (req: Request, res: Response) => {
  const admin = getLiveAuthUser(req);
  if (!isSuperAdminLiveUser(admin)) return res.status(403).json({ error: 'Super-admin access required' });
  res.json({ requests: db.getLiveRequests().filter(item => item.status === 'pending'), mode: db.getLiveAccessMode(), users: db.getUsers(true).map(user => db.sanitizeUser(user, admin!.id)) });
});

app.put('/api/admin/live-access/settings', async (req: Request, res: Response) => {
  const admin = getLiveAuthUser(req);
  if (!isSuperAdminLiveUser(admin)) return res.status(403).json({ error: 'Super-admin access required' });
  const mode = req.body?.mode;
  if (!['everyone', 'approved_only', 'sixty_days_plus', 'admins_creators_only'].includes(mode)) return res.status(400).json({ error: 'Invalid Go Live access mode.' });
  db.setLiveAccessMode(mode);
  if (firestore) {
    try { await firestore.collection('siteConfig').doc('site').set({ liveAccessMode: mode }, { merge: true }); }
    catch (error) { console.warn('[Echat] Could not sync live access mode to Firestore:', error instanceof Error ? error.message : error); }
  }
  audit(admin!, 'live_access.settings', undefined, `Go Live access mode: ${mode}`);
  res.json({ success: true, mode });
});

app.post('/api/admin/live-access/requests/:id/review', async (req: Request, res: Response) => {
  const admin = getLiveAuthUser(req);
  if (!isSuperAdminLiveUser(admin)) return res.status(403).json({ error: 'Super-admin access required' });
  const decision = req.body?.decision;
  if (!['approved', 'rejected', 'blocked'].includes(decision)) return res.status(400).json({ error: 'Invalid review decision.' });
  const request = db.reviewLiveRequest(req.params.id, decision, admin!.id);
  if (!request) return res.status(404).json({ error: 'Pending request not found.' });
  await syncLiveProfileToFirestore(db.getUserById(request.userId));
  if (decision === 'blocked') endLiveForBlockedUser(request.userId);
  const message = decision === 'approved' ? 'You can now Go Live! 🎉' : decision === 'rejected' ? 'Your Go Live request was declined.' : 'Your Go Live access has been blocked.';
  const notification = db.addNotification({ userId: request.userId, actorId: admin!.id, type: 'announcement', message, targetId: request.id, read: false });
  socketManager.sendToUser(request.userId, { type: 'new_notification', notification: populateNotification(notification) });
  audit(admin!, `live_access.${decision}`, { type: 'user', id: request.userId, name: request.name });
  res.json({ success: true, request, liveAccess: decision === 'approved' ? 'approved' : decision === 'blocked' ? 'blocked' : 'none' });
});

app.post('/api/admin/live-access/users/:id', (req: Request, res: Response) => {
  const admin = getLiveAuthUser(req);
  if (!isSuperAdminLiveUser(admin)) return res.status(403).json({ error: 'Super-admin access required' });
  const target = db.getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (isDeveloperUser(target)) return res.status(403).json({ error: 'Super-admin live access cannot be changed.' });
  const action = req.body?.action;
  if (!['grant', 'revoke', 'block', 'unblock'].includes(action)) return res.status(400).json({ error: 'Invalid user access action.' });
  const access = action === 'grant' ? 'approved' : action === 'block' ? 'blocked' : 'none';
  const pending = db.getLiveRequests().find(item => item.userId === target.id && item.status === 'pending');
  if (pending && action !== 'unblock') db.reviewLiveRequest(pending.id, action === 'grant' ? 'approved' : action === 'block' ? 'blocked' : 'rejected', admin!.id);
  if (action === 'block') {
    endLiveForBlockedUser(target.id);
  }
  const updated = db.updateUser(target.id, { liveAccess: access });
  syncLiveProfileToFirestore(updated);
  if (action === 'grant') {
    const notification = db.addNotification({ userId: target.id, actorId: admin!.id, type: 'announcement', message: 'You can now Go Live! 🎉', read: false });
    socketManager.sendToUser(target.id, { type: 'new_notification', notification: populateNotification(notification) });
  }
  audit(admin!, `live_access.${action}`, { type: 'user', id: target.id, name: target.name });
  res.json({ success: true, user: db.sanitizeUser(updated!, admin!.id) });
});

interface LiveComment {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  text: string;
  createdAt: number;
}

interface LiveSession {
  id: string;
  hostId: string;
  hostName: string;
  hostAvatar: string;
  hostEmail: string;
  isHostVerified?: boolean;
  title: string;
  taggedPageIds: string[];
  viewersCount: number;
  reactionsCount: number;
  startedAt: number;
  isActive: boolean;
  comments: LiveComment[];
}

let activeLiveSession: LiveSession | null = null;
const LIVE_VIEWER_BROADCAST_INTERVAL_MS = 30_000;
let lastLiveViewerBroadcastAt = 0;
let liveViewerBroadcastTimer: ReturnType<typeof setTimeout> | null = null;

function resetLiveViewerBroadcast(): void {
  if (liveViewerBroadcastTimer) clearTimeout(liveViewerBroadcastTimer);
  liveViewerBroadcastTimer = null;
  lastLiveViewerBroadcastAt = Date.now();
}

function clearLiveViewerBroadcast(): void {
  if (liveViewerBroadcastTimer) clearTimeout(liveViewerBroadcastTimer);
  liveViewerBroadcastTimer = null;
}

function broadcastLiveViewerCount(): void {
  if (!activeLiveSession?.isActive) return;
  lastLiveViewerBroadcastAt = Date.now();
  socketManager.broadcast({
    type: 'live_viewers_updated',
    viewersCount: activeLiveSession.viewersCount
  });
}

function queueLiveViewerCountBroadcast(): void {
  if (!activeLiveSession?.isActive || liveViewerBroadcastTimer) return;
  const delay = Math.max(0, lastLiveViewerBroadcastAt + LIVE_VIEWER_BROADCAST_INTERVAL_MS - Date.now());
  if (delay === 0) {
    broadcastLiveViewerCount();
    return;
  }
  liveViewerBroadcastTimer = setTimeout(() => {
    liveViewerBroadcastTimer = null;
    broadcastLiveViewerCount();
  }, delay);
}

function endLiveForBlockedUser(userId: string): void {
  if (activeLiveSession?.hostId !== userId) return;
  const endedHostId = activeLiveSession.hostId;
  clearLiveViewerBroadcast();
  socketManager.clearLiveHost(activeLiveSession.id);
  activeLiveSession = null;
  socketManager.broadcast({ type: 'live_ended', hostId: endedHostId });
}

function sendLiveStreamKeyError(res: Response, error: unknown) {
  error = describeLiveKitError(error);
  const value = error as { status?: number; code?: string; message?: string };
  const status = Number.isInteger(value?.status) ? value.status! : 500;
  return res.status(status).json({
    error: value?.message || 'The stream key request failed.',
    code: value?.code || 'stream-key-error'
  });
}

app.get('/api/live/stream-key', async (req: Request, res: Response) => {
  const user = getLiveAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    return res.setHeader('Cache-Control', 'no-store').json({
      success: true,
      ...await getOrCreateLiveStreamIngress(user.id)
    });
  } catch (error) {
    return sendLiveStreamKeyError(res, error);
  }
});

app.post('/api/live/stream-key/reset', async (req: Request, res: Response) => {
  const user = getLiveAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    return res.setHeader('Cache-Control', 'no-store').json({
      success: true,
      ...await resetLiveStreamIngress(user.id)
    });
  } catch (error) {
    return sendLiveStreamKeyError(res, error);
  }
});

app.get('/api/live/current', (_req: Request, res: Response) => {
  res.json({ live: activeLiveSession });
});

app.post('/api/live/start', (req: Request, res: Response) => {
  const authUser = getLiveAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  autoApproveMatureLiveUser(authUser);
  if (!canStartLive(authUser)) return res.status(403).json({ error: authUser.liveAccess === 'blocked' ? 'Your Go Live access is blocked.' : 'Request Go Live access from an administrator first.' });
  const isDev = isDeveloperUser(authUser);

  const { title, taggedPageIds } = req.body;
  const pageIdentityId = String(req.get('x-page-id') || '');
  const pageIdentity = pageIdentityId ? db.getPageById(pageIdentityId) : null;
  if (pageIdentityId && pageIdentity?.ownerId !== authUser.id) return res.status(403).json({ error: 'You do not manage this Page' });
  activeLiveSession = {
    id: 'live_' + crypto.randomBytes(6).toString('hex'),
    hostId: authUser.id,
    hostName: pageIdentity?.name || authUser.name,
    hostAvatar: pageIdentity?.avatar || authUser.avatar,
    hostEmail: authUser.email,
    isHostVerified: authUser.isVerified ?? isDev,
    title: title?.trim() || `${pageIdentity?.name || authUser.name} is Live on EChat!`,
    taggedPageIds: Array.isArray(taggedPageIds) ? [...new Set<string>(taggedPageIds.filter((id: unknown): id is string => typeof id === 'string' && Boolean(db.getPageById(id))))].slice(0, 22) : [],
    viewersCount: 1,
    reactionsCount: 0,
    startedAt: Date.now(),
    isActive: true,
    comments: [
      {
        id: 'lc_init',
        userId: authUser.id,
        userName: 'EChat Broadcast',
        userAvatar: authUser.avatar,
        text: 'Stream started. Live comments are open!',
        createdAt: Date.now()
      }
    ]
  };
  resetLiveViewerBroadcast();

  socketManager.setLiveHost(activeLiveSession.id, activeLiveSession.hostId);

  for (const uid of authUser.friends.filter(id => !db.isBlockedBetween(authUser.id, id))) {
    const notification = db.addNotification({
      userId: uid,
      actorId: authUser.id,
      type: 'live_stream',
      message: `${authUser.name} is live: ${activeLiveSession.title}`,
      targetId: activeLiveSession.id,
      read: false
    });
    socketManager.sendToUser(uid, { type: 'new_notification', notification: populateNotification(notification) });
  }

  const taggedPageAudience = new Set<string>();
  for (const pageId of activeLiveSession.taggedPageIds) {
    const page = db.getPageById(pageId);
    if (!page) continue;
    for (const uid of [...page.followers, page.ownerId]) {
      if (uid === authUser.id || taggedPageAudience.has(uid) || db.isBlockedBetween(authUser.id, uid)) continue;
      taggedPageAudience.add(uid);
      const notification = db.addNotification({ userId: uid, actorId: authUser.id, type: 'live_stream', message: `${authUser.name} is live with ${page.name}: ${activeLiveSession.title}`, targetId: activeLiveSession.id, read: false });
      socketManager.sendToUser(uid, { type: 'new_notification', notification: populateNotification(notification) });
    }
  }

  socketManager.broadcast({
    type: 'live_started',
    live: activeLiveSession
  });

  res.json({ success: true, live: activeLiveSession });
});

app.post('/api/live/stop', (req: Request, res: Response) => {
  const authUser = getLiveAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

  if (activeLiveSession) {
    if (activeLiveSession.hostId !== authUser.id && !isDeveloperUser(authUser)) {
      return res.status(403).json({ error: 'Only the host or developer can stop the live stream' });
    }

    const endedHostId = activeLiveSession.hostId;
    clearLiveViewerBroadcast();
    socketManager.clearLiveHost(activeLiveSession.id);
    activeLiveSession = null;

    socketManager.broadcast({
      type: 'live_ended',
      hostId: endedHostId
    });
  }

  res.json({ success: true });
});

app.post('/api/live/comment', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  if (!activeLiveSession || !activeLiveSession.isActive) {
    return res.status(400).json({ error: 'No active live stream' });
  }

  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Comment text required' });

  const newComment: LiveComment = {
    id: 'lc_' + crypto.randomBytes(4).toString('hex'),
    userId: authUser.id,
    userName: authUser.name,
    userAvatar: authUser.avatar,
    text: text.trim(),
    createdAt: Date.now()
  };

  activeLiveSession.comments.push(newComment);
  if (activeLiveSession.comments.length > 80) {
    activeLiveSession.comments.shift();
  }

  socketManager.broadcast({
    type: 'live_comment',
    comment: newComment
  });

  res.json({ success: true, comment: newComment });
});

app.post('/api/live/reaction', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  if (!activeLiveSession || !activeLiveSession.isActive) {
    return res.status(400).json({ error: 'No active live stream' });
  }

  const { emoji } = req.body;
  activeLiveSession.reactionsCount += 1;

  socketManager.broadcast({
    type: 'live_reaction',
    emoji: emoji || '❤️',
    userName: authUser.name,
    userId: authUser.id
  });

  res.json({ success: true, reactionsCount: activeLiveSession.reactionsCount });
});

app.post('/api/live/join', (_req: Request, res: Response) => {
  if (activeLiveSession && activeLiveSession.isActive) {
    activeLiveSession.viewersCount += 1;
    queueLiveViewerCountBroadcast();
  }
  res.json({ success: true, viewersCount: activeLiveSession?.viewersCount || 1 });
});

app.post('/api/live/leave', (_req: Request, res: Response) => {
  if (activeLiveSession && activeLiveSession.isActive) {
    activeLiveSession.viewersCount = Math.max(1, activeLiveSession.viewersCount - 1);
    queueLiveViewerCountBroadcast();
  }
  res.json({ success: true, viewersCount: activeLiveSession?.viewersCount || 1 });
});

// ----------------- PAGES ROUTES -----------------
app.get('/api/my-pages', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  res.json(db.getPages().filter(page => page.ownerId === authUser.id));
});

app.get('/api/pages', (_req: Request, res: Response) => {
  try {
    const pages = db.getPages();
    res.json(pages);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/pages/:id', (req: Request, res: Response) => {
  try {
    const page = db.getPageById(req.params.id);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    res.json(page);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Image values must be an uploaded file, an http(s) URL, or empty (to remove it).
const cleanImageValue = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (t === '' || /^https?:\/\//i.test(t) || t.startsWith('/uploads/')) return t;
  return undefined;
};

app.put('/api/pages/:id', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
    const page = db.getPageById(req.params.id);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    if (page.ownerId !== authUser.id && !isDeveloperUser(authUser)) {
      return res.status(403).json({ error: 'Only the page owner can edit this page' });
    }
    const { name, category, bio, avatar, cover } = req.body as Record<string, unknown>;
    const cleanName = typeof name === 'string' ? name.trim() : undefined;
    if (cleanName !== undefined && (cleanName.length < 2 || cleanName.length > 80)) {
      return res.status(400).json({ error: 'Page name must be 2 to 80 characters' });
    }
    const updated = db.updatePage(page.id, {
      ...(cleanName !== undefined && { name: cleanName }),
      ...(typeof category === 'string' && { category: category.trim().slice(0, 60) }),
      ...(typeof bio === 'string' && { bio: bio.trim().slice(0, 500) }),
      ...(cleanImageValue(avatar) !== undefined && { avatar: cleanImageValue(avatar) }),
      ...(cleanImageValue(cover) !== undefined && { cover: cleanImageValue(cover) })
    });
    socketManager.broadcast({ type: 'page_updated', page: updated });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/groups/:id', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
    const group = db.getGroupById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.ownerId !== authUser.id && !isDeveloperUser(authUser)) {
      return res.status(403).json({ error: 'Only the group owner can edit this group' });
    }
    const { name, description, privacy, avatar, cover } = req.body as Record<string, unknown>;
    const cleanName = typeof name === 'string' ? name.trim() : undefined;
    if (cleanName !== undefined && (cleanName.length < 2 || cleanName.length > 80)) {
      return res.status(400).json({ error: 'Group name must be 2 to 80 characters' });
    }
    const updated = db.updateGroup(group.id, {
      ...(cleanName !== undefined && { name: cleanName }),
      ...(typeof description === 'string' && { description: description.trim().slice(0, 500) }),
      ...((privacy === 'public' || privacy === 'private') && { privacy }),
      ...(cleanImageValue(avatar) !== undefined && { avatar: cleanImageValue(avatar) }),
      ...(cleanImageValue(cover) !== undefined && { cover: cleanImageValue(cover) })
    });
    socketManager.broadcast({ type: 'group_updated', group: updated });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/pages', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

    const { name, category, bio, cover, avatar } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Page name is required' });

    const newPage = db.createPage({
      name: name.trim(),
      category: category?.trim() || 'General',
      bio: bio?.trim() || '',
      cover: cover?.trim() || '',
      avatar: avatar?.trim() || '',
      ownerId: authUser.id,
      ownerName: authUser.name
    });

    socketManager.broadcast({ type: 'page_created', page: newPage });
    res.status(201).json(newPage);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/pages/:id/follow', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

    const pageBefore = db.getPageById(req.params.id);
    const wasFollowing = Boolean(pageBefore?.followers.includes(authUser.id));
    const updated = db.togglePageFollow(req.params.id, authUser.id);
    if (!updated) return res.status(404).json({ error: 'Page not found' });

    socketManager.broadcast({ type: 'page_updated', page: updated });
    if (!wasFollowing && updated.ownerId !== authUser.id) {
      const notification = db.addNotification({ userId: updated.ownerId, actorId: authUser.id, type: 'page_follow', message: `${authUser.name} followed your page`, targetId: updated.id, read: false });
      socketManager.sendToUser(updated.ownerId, { type: 'new_notification', notification: populateNotification(notification) });
    }
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/pages/:id/like', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

    const updated = db.togglePageLike(req.params.id, authUser.id);
    if (!updated) return res.status(404).json({ error: 'Page not found' });

    socketManager.broadcast({ type: 'page_updated', page: updated });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/pages/:id/posts', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

    const page = db.getPageById(req.params.id);
    if (!page) return res.status(404).json({ error: 'Page not found' });

    if (page.ownerId !== authUser.id && !isDeveloperUser(authUser)) {
      return res.status(403).json({ error: 'Only the page creator can post as this page' });
    }

    const { content, mediaUrl, mediaType } = req.body;
    if (!content && !mediaUrl) {
      return res.status(400).json({ error: 'Post content or media required' });
    }

    const newPost = db.addPagePost(req.params.id, {
      authorId: authUser.id,
      content: content || '',
      mediaUrl,
      mediaType
    });

    socketManager.broadcast({ type: 'page_post_created', pageId: req.params.id, post: newPost });
    res.status(201).json(newPost);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ----------------- GROUPS ROUTES -----------------
app.get('/api/groups', (req: Request, res: Response) => {
  try {
    const viewer = getAuthUser(req);
    const groups = db.getGroups()
      .filter(group => group.privacy !== 'private' || Boolean(viewer && (group.members.includes(viewer.id) || group.ownerId === viewer.id || isDeveloperUser(viewer))))
      .map(group => ({
        ...group,
        posts: (group.posts || []).filter(post => post.status === 'approved' || Boolean(viewer && (post.authorId === viewer.id || group.ownerId === viewer.id || isDeveloperUser(viewer))))
      }));
    res.json(groups);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/groups/:id', (req: Request, res: Response) => {
  try {
    const viewer = getAuthUser(req);
    const group = db.getGroupById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.privacy === 'private' && (!viewer || (!group.members.includes(viewer.id) && group.ownerId !== viewer.id && !isDeveloperUser(viewer)))) {
      return res.status(404).json({ error: 'Group not found' });
    }
    res.json({
      ...group,
      posts: (group.posts || []).filter(post => post.status === 'approved' || Boolean(viewer && (post.authorId === viewer.id || group.ownerId === viewer.id || isDeveloperUser(viewer))))
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/groups', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

    const { name, privacy, description, cover, avatar } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Group name is required' });

    const newGroup = db.createGroup({
      name: name.trim(),
      privacy: privacy === 'private' ? 'private' : 'public',
      description: description?.trim() || '',
      cover: cover?.trim() || '',
      avatar: avatar?.trim() || '',
      ownerId: authUser.id,
      ownerName: authUser.name
    });

    socketManager.broadcast({ type: 'group_created', group: newGroup });
    res.status(201).json(newGroup);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/groups/:id/join', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

    const updated = db.joinGroup(req.params.id, authUser.id);
    if (!updated) return res.status(404).json({ error: 'Group not found' });

    socketManager.broadcast({ type: 'group_updated', group: updated });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/groups/:id/leave', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

    const updated = db.leaveGroup(req.params.id, authUser.id);
    if (!updated) return res.status(404).json({ error: 'Group not found' });

    socketManager.broadcast({ type: 'group_updated', group: updated });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** Group message: tell the other members (capped so a huge group can't flood the server). */
function pushGroupPost(group: { id: string; name: string; members: string[] }, post: { authorId: string; authorName?: string; content?: string; mediaUrl?: string }) {
  const body = post.content ? `${post.authorName || 'Someone'}: ${String(post.content).slice(0, 140)}` : `${post.authorName || 'Someone'} shared ${post.mediaUrl ? 'a photo or video' : 'a post'}`;
  const members = group.members.filter(id => id !== post.authorId && !db.isBlockedBetween(id, post.authorId)).slice(0, 500);
  pushTo(members, { kind: 'group_post', title: group.name, body, url: `/groups?group=${encodeURIComponent(group.id)}`, tag: `group-${group.id}` });
}

app.post('/api/groups/:id/posts', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

    const group = db.getGroupById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    if (!group.members.includes(authUser.id) && !isDeveloperUser(authUser)) {
      return res.status(403).json({ error: 'You must join this group before posting' });
    }

    const { content, mediaUrl, mediaType } = req.body;
    if (!content && !mediaUrl) {
      return res.status(400).json({ error: 'Post content or media required' });
    }

    const newPost = db.addGroupPost(req.params.id, {
      authorId: authUser.id,
      authorName: authUser.name,
      authorAvatar: authUser.avatar,
      content: content || '',
      mediaUrl,
      mediaType
    });

    socketManager.broadcast({ type: 'group_post_created', groupId: req.params.id, post: newPost });
    if (newPost.status === 'approved') pushGroupPost(group, newPost);
    res.status(201).json(newPost);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/groups/:id/posts/:postId/approve', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

    const success = db.approveGroupPost(req.params.id, req.params.postId, authUser.id);
    if (!success) return res.status(403).json({ error: 'Cannot approve this post (unauthorized or not found)' });

    const group = db.getGroupById(req.params.id);
    const approved = group?.posts?.find(post => post.id === req.params.postId);
    if (group && approved) pushGroupPost(group, approved);
    socketManager.broadcast({ type: 'group_updated', group });
    res.json({ success: true, group });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ----------------- LISTING IMAGE UPLOADS (Jobs + Events) -----------------
// Jobs and Events accept one photo sent as multipart/form-data (field "image").
// Stored exactly like /api/upload: local UPLOADS_DIR + durable copy via db.putFile.
const LISTING_IMAGE_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_LISTING_IMAGE_BYTES = 5 * 1024 * 1024;
const listingRawParser = express.raw({ type: 'multipart/form-data', limit: MAX_LISTING_IMAGE_BYTES + 512 * 1024 });
const listingMultipart = (req: Request, res: Response, next: express.NextFunction) => {
  listingRawParser(req, res, (err?: unknown) => {
    if (err) return res.status(413).json({ error: 'Photo must be 5 MB or smaller' });
    next();
  });
};

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Detect the real image type from the file's first bytes (never trust the client-provided type). */
function sniffListingImage(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Reads text fields + optional image from a multipart body, or text fields from a JSON body. */
async function readListingForm(req: Request): Promise<{ fields: Record<string, string>; image: File | null }> {
  const contentType = String(req.headers['content-type'] || '');
  const fields: Record<string, string> = {};
  if (contentType.toLowerCase().startsWith('multipart/form-data') && Buffer.isBuffer(req.body)) {
    let form: FormData;
    try {
      form = await new globalThis.Request('http://localhost/listing', {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: new Uint8Array(req.body)
      }).formData();
    } catch {
      throw new HttpError(400, 'Could not read the submitted form');
    }
    let image: File | null = null;
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') fields[key] = value;
      else if (key === 'image' && value.size > 0) image = value;
    }
    return { fields, image };
  }
  const body = (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) ? req.body as Record<string, unknown> : {};
  for (const [key, value] of Object.entries(body)) if (typeof value === 'string') fields[key] = value;
  return { fields, image: null };
}

async function saveListingImage(file: File): Promise<string> {
  if (file.size > MAX_LISTING_IMAGE_BYTES) throw new HttpError(413, 'Photo must be 5 MB or smaller');
  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = sniffListingImage(buffer);
  if (!mime) throw new HttpError(415, 'Photo must be a JPG, PNG or WEBP image');
  const fileName = `${crypto.randomUUID()}.${LISTING_IMAGE_EXT[mime]}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, fileName), buffer);
  try {
    await db.putFile(fileName, mime, buffer); // durable copy (MongoDB), if configured
  } catch (err) {
    console.error('[Echat] Could not store listing photo durably (kept on local disk only):', err);
  }
  return `/uploads/${fileName}`;
}

const clean = (value: string | undefined, max: number) => (value ?? '').trim().slice(0, max);
const canManageListing = (user: { id: string } | null, ownerId: string) => Boolean(user && (user.id === ownerId || isAdminUser(user)));
const sendListingError = (res: Response, e: unknown) => {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
  res.status(500).json({ error: e instanceof Error ? e.message : 'Request failed' });
};

/** "2026-12-01" + "18:30" -> "2026-12-01T18:30". Also accepts a full datetime-local value. */
function combineEventDate(date: string, time: string): string | null {
  const d = date.trim();
  const t = time.trim();
  const value = /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T${/^\d{2}:\d{2}$/.test(t) ? t : '00:00'}` : d;
  return value && !Number.isNaN(Date.parse(value)) ? value : null;
}

// ----------------- EVENTS: EDIT / DELETE -----------------
app.put('/api/events/:id', listingMultipart, async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
    const event = db.getEventById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (!canManageListing(authUser, event.ownerId)) return res.status(403).json({ error: 'Only the organizer or an admin can edit this event' });

    const { fields, image } = await readListingForm(req);
    const updates: Parameters<typeof db.updateEvent>[1] = {};
    if (fields.title !== undefined) {
      const title = clean(fields.title, 150);
      if (!title) return res.status(400).json({ error: 'Event title is required' });
      updates.title = title;
    }
    if (fields.date !== undefined) {
      const date = combineEventDate(fields.date, fields.time ?? '');
      if (!date) return res.status(400).json({ error: 'A valid event date is required' });
      updates.date = date;
      updates.time = clean(fields.time, 5);
    }
    if (fields.location !== undefined) updates.location = clean(fields.location, 200) || 'Online';
    if (fields.description !== undefined) updates.description = clean(fields.description, 5000);
    if (fields.organizer !== undefined) updates.organizer = clean(fields.organizer, 150);
    if (fields.contactInfo !== undefined) updates.contactInfo = clean(fields.contactInfo, 300);
    if (image) updates.cover = await saveListingImage(image);
    else if (fields.removeImage === 'true') updates.cover = '';

    const updated = db.updateEvent(event.id, updates);
    socketManager.broadcast({ type: 'event_updated', event: updated });
    res.json(updated);
  } catch (e) {
    sendListingError(res, e);
  }
});

app.delete('/api/events/:id', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
    const event = db.getEventById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (!canManageListing(authUser, event.ownerId)) return res.status(403).json({ error: 'Only the organizer or an admin can delete this event' });
    db.deleteEvent(event.id);
    socketManager.broadcast({ type: 'event_deleted', eventId: event.id });
    res.json({ success: true });
  } catch (e) {
    sendListingError(res, e);
  }
});

// ----------------- JOBS ROUTES -----------------
const JOB_TYPES = ['Full-time', 'Part-time', 'Remote', 'Contract'] as const;
type JobTypeValue = typeof JOB_TYPES[number];
const isJobType = (value: string): value is JobTypeValue => (JOB_TYPES as readonly string[]).includes(value);

app.get('/api/jobs', (_req: Request, res: Response) => {
  try {
    res.json(db.getJobs());
  } catch (e) {
    sendListingError(res, e);
  }
});

app.get('/api/jobs/:id', (req: Request, res: Response) => {
  const job = db.getJobById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.post('/api/jobs', listingMultipart, async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
    const { fields, image } = await readListingForm(req);
    const title = clean(fields.title, 150);
    const company = clean(fields.company, 150);
    const type = clean(fields.type, 20);
    if (!title) return res.status(400).json({ error: 'Job title is required' });
    if (!company) return res.status(400).json({ error: 'Company is required' });
    if (!isJobType(type)) return res.status(400).json({ error: 'Choose a job type: Full-time, Part-time, Remote or Contract' });

    const job = db.createJob({
      title,
      company,
      type,
      location: clean(fields.location, 150) || 'Not specified',
      salary: clean(fields.salary, 100) || 'Negotiable',
      description: clean(fields.description, 5000),
      contactInfo: clean(fields.contactInfo, 300),
      image: image ? await saveListingImage(image) : '',
      ownerId: authUser.id,
      ownerName: authUser.name
    });
    res.status(201).json(job);
  } catch (e) {
    sendListingError(res, e);
  }
});

app.put('/api/jobs/:id', listingMultipart, async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
    const job = db.getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!canManageListing(authUser, job.ownerId)) return res.status(403).json({ error: 'Only the job owner or an admin can edit this job' });

    const { fields, image } = await readListingForm(req);
    const updates: Parameters<typeof db.updateJob>[1] = {};
    if (fields.title !== undefined) {
      const title = clean(fields.title, 150);
      if (!title) return res.status(400).json({ error: 'Job title is required' });
      updates.title = title;
    }
    if (fields.company !== undefined) {
      const company = clean(fields.company, 150);
      if (!company) return res.status(400).json({ error: 'Company is required' });
      updates.company = company;
    }
    if (fields.type !== undefined) {
      const type = clean(fields.type, 20);
      if (!isJobType(type)) return res.status(400).json({ error: 'Choose a job type: Full-time, Part-time, Remote or Contract' });
      updates.type = type;
    }
    if (fields.location !== undefined) updates.location = clean(fields.location, 150) || 'Not specified';
    if (fields.salary !== undefined) updates.salary = clean(fields.salary, 100) || 'Negotiable';
    if (fields.description !== undefined) updates.description = clean(fields.description, 5000);
    if (fields.contactInfo !== undefined) updates.contactInfo = clean(fields.contactInfo, 300);
    if (image) updates.image = await saveListingImage(image);
    else if (fields.removeImage === 'true') updates.image = '';

    res.json(db.updateJob(job.id, updates));
  } catch (e) {
    sendListingError(res, e);
  }
});

app.delete('/api/jobs/:id', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
    const job = db.getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!canManageListing(authUser, job.ownerId)) return res.status(403).json({ error: 'Only the job owner or an admin can delete this job' });
    db.deleteJob(job.id);
    res.json({ success: true });
  } catch (e) {
    sendListingError(res, e);
  }
});

// ----------------- EVENTS ROUTES -----------------
app.get('/api/events', (_req: Request, res: Response) => {
  try {
    const events = db.getEvents();
    res.json(events);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/events/:id', (req: Request, res: Response) => {
  try {
    const event = db.getEventById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/events', listingMultipart, async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

    // New Events form: multipart with an optional uploaded photo. Older clients keep sending JSON.
    if (Buffer.isBuffer(req.body)) {
      const { fields, image } = await readListingForm(req);
      const title = clean(fields.title, 150);
      if (!title) return res.status(400).json({ error: 'Event title is required' });
      const date = combineEventDate(fields.date ?? '', fields.time ?? '');
      if (!date) return res.status(400).json({ error: 'A valid event date is required' });
      const created = db.createEvent({
        title,
        date,
        time: clean(fields.time, 5),
        location: clean(fields.location, 200) || 'Online',
        description: clean(fields.description, 5000),
        organizer: clean(fields.organizer, 150),
        contactInfo: clean(fields.contactInfo, 300),
        cover: image ? await saveListingImage(image) : '',
        keepEmptyCover: true,
        ownerId: authUser.id,
        ownerName: authUser.name
      });
      socketManager.broadcast({ type: 'event_created', event: created });
      return res.status(201).json(created);
    }

    const { title, date, location, cover, description } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Event title is required' });
    if (!date) return res.status(400).json({ error: 'Event date is required' });

    const newEvent = db.createEvent({
      title: title.trim(),
      date,
      location: location?.trim() || 'Online',
      cover: cover?.trim() || '',
      description: description?.trim() || '',
      ownerId: authUser.id,
      ownerName: authUser.name
    });

    socketManager.broadcast({ type: 'event_created', event: newEvent });
    res.status(201).json(newEvent);
  } catch (e) {
    sendListingError(res, e);
  }
});

app.post('/api/events/:id/going', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

    const updated = db.toggleEventGoing(req.params.id, authUser.id);
    if (!updated) return res.status(404).json({ error: 'Event not found' });

    socketManager.broadcast({ type: 'event_updated', event: updated });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/events/:id/interested', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

    const updated = db.toggleEventInterested(req.params.id, authUser.id);
    if (!updated) return res.status(404).json({ error: 'Event not found' });

    socketManager.broadcast({ type: 'event_updated', event: updated });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ----------------- USER PROFILE & SETTINGS ROUTES -----------------
app.post('/api/users/:id/change-password', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser || authUser.id !== req.params.id) {
      return res.status(403).json({ error: 'Unauthorized to change this password' });
    }

    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    // Verify current password if user had one
    if (authUser.passwordHash && hashPassword(currentPassword) !== authUser.passwordHash) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    db.updateUser(authUser.id, { passwordHash: hashPassword(newPassword) });
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/users/:id', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser || (authUser.id !== req.params.id && !isDeveloperUser(authUser))) {
      return res.status(403).json({ error: 'Unauthorized to delete this account' });
    }

    const victim = db.getUserById(req.params.id);
    if (!victim) return res.status(404).json({ error: 'User not found' });
    if (victim.role === 'developer' || isDeveloperUser(victim)) {
      return res.status(400).json({ error: 'The administrator account cannot be deleted' });
    }

    const success = db.deleteUser(req.params.id);
    if (!success) return res.status(400).json({ error: 'Failed to delete account' });
    if (authUser.id !== req.params.id) audit(authUser, 'user.delete', { type: 'user', id: victim.id, name: victim.name });

    socketManager.broadcast({ type: 'user_deleted', userId: req.params.id });
    res.json({ success: true, message: 'Account permanently deleted' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ----------------- VITE & SERVER STARTUP -----------------
async function startServer() {
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API route not found' });
  });

  // Clear corrupted vite cache if present
  try {
    const viteCachePath = path.resolve(process.cwd(), 'node_modules', '.vite');
    if (fs.existsSync(viteCachePath)) {
      try {
        const metaFile = path.resolve(viteCachePath, 'deps', '_metadata.json');
        if (fs.existsSync(metaFile)) {
          JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
        }
      } catch {
        fs.rmSync(viteCachePath, { recursive: true, force: true });
        console.info('[Echat] Cleared corrupted vite cache');
      }
    }
  } catch {
    // ignore
  }

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        fs: {
          strict: false,
        },
      },
      optimizeDeps: {
        force: false,
      },
      appType: 'spa'
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Central error handler: never leak stack traces, always answer JSON.
  app.use((err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : 500;
    if (status >= 500) console.error('[Echat] Unhandled error:', err);
    const detail = err instanceof Error ? err.message : undefined;
    res.status(status).json({
      error: status === 413 ? 'File or request is too large' : status < 500 ? 'Bad request' : 'Internal server error',
      ...(status >= 500 && detail ? { detail } : {})
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.info(`[Echat] Listening on ${PORT}`);
  });

  // Bind Render's port before starting the existing database initialization.
  void Promise.resolve(db.init()).then(() => {
    // One-time: refresh names/photos copied into older Firestore posts, comments, stories and reels.
    setTimeout(() => { void migrateEmbeddedProfilesOnce(firestore, lookupProfileOwner); }, 20_000);
  }).catch(() => {});

  // Dev only: also answer on :5173 so http://localhost:5173 works like a Vite dev server.
  if (!isProd && PORT !== 5173) {
    const altServer = http.createServer(app);
    altServer.on('error', () => { /* port busy: ignore */ });
    altServer.listen(5173, '0.0.0.0', () => {
      console.info('[vite] Local: http://localhost:5173/');
    });
  }

  const shutdown = () => {
    // give the background writer a moment to push the last changes to MongoDB
    void db.flush().finally(() => server.close(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((err) => {
  console.error('[Echat] Failed to start server:', err);
  process.exit(1);
});
