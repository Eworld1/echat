import fs from 'fs';
import http from 'http';
import path from 'path';
import crypto from 'node:crypto';
import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { db, hashPassword } from './server/db.js';
import { SocketManager } from './server/socket.js';

const isProd = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const socketManager = new SocketManager(server);

// ----------------- CORS -----------------
// CORS_ORIGIN: comma-separated allowed origins, or * (default).
const CORS_ORIGINS = (process.env.CORS_ORIGIN ?? '*').split(',').map(o => o.trim()).filter(Boolean);
app.use((req: Request, res: Response, next) => {
  const origin = req.headers.origin;
  const allowAny = CORS_ORIGINS.includes('*');
  if (origin && (allowAny || CORS_ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', allowAny ? '*' : origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id, x-developer-key');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Brute-force protection for login / register / password reset (30 tries per 15 min per IP).
const authHits = new Map<string, { count: number; reset: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of authHits) if (v.reset < now) authHits.delete(k);
}, 10 * 60 * 1000).unref();
app.use('/api/auth', (req: Request, res: Response, next) => {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const rec = authHits.get(key);
  if (!rec || rec.reset < now) {
    authHits.set(key, { count: 1, reset: now + 15 * 60 * 1000 });
    return next();
  }
  rec.count++;
  if (rec.count > 30) return res.status(429).json({ error: 'Too many attempts. Please try again in 15 minutes.' });
  next();
});

// ----------------- STATIC UPLOADS -----------------
// Stored under data/ so a single persistent disk keeps both the database and uploads.
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), 'data', 'uploads'));
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR, {
  maxAge: '7d',
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')
}));

const UPLOAD_MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a'
};
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // base64 adds ~33%, must stay under the 25mb JSON limit

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Upload a file (sent as a base64 data URL). Returns a server-relative URL.
app.post('/api/upload', (req: Request, res: Response) => {
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
      return res.status(413).json({ error: 'File is empty or larger than 15 MB' });
    }

    const fileName = `${crypto.randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, fileName), buffer);
    res.status(201).json({ url: `/uploads/${fileName}` });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Upload failed' });
  }
});

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'eldermoses89@gmail.com').toLowerCase().trim();

function isDeveloperUser(user: any): boolean {
  return Boolean(user && user.email?.toLowerCase().trim() === ADMIN_EMAIL);
}

// Helper to extract authenticated user from header
function getAuthUser(req: Request) {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return null;
  let user = db.getUserById(userId);
  if (!user && userId.trim()) {
    // Never grant developer rights here: the admin account is created only through /api/auth/register.
    const isDev = false;
    user = db.createUser({
      id: userId,
      name: 'User',
      email: `${userId}@echat.local`,
      dob: '2000-01-01',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
      coverPhoto: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1400&q=80',
      bio: 'Echat member',
      location: 'Global',
      work: '',
      education: '',
      role: isDev ? 'developer' : 'user'
    });
  }
  return user || null;
}

// ----------------- AUTH ROUTES -----------------
// Copies the real profile (name, photo...) onto an auto-created placeholder account.
// Only placeholders can be synced; email, role and password are never changed here.
app.post('/api/auth/sync-profile', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
    if (!authUser.email.endsWith('@echat.local')) return res.json({ user: db.sanitizeUser(authUser), synced: false });

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

    if (age < 13) {
      return res.status(400).json({ error: 'You must be at least 13 years old to create an account on Echat.' });
    }

    const existing = db.getUserByEmail(cleanEmail);
    if (existing) {
      // Only the real owner (correct password) may re-enter an existing account.
      if (existing.passwordHash && existing.passwordHash === hashPassword(password)) {
        return res.json({ user: db.sanitizeUser(existing), token: existing.id });
      }
      return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
    }

    if (cleanEmail === ADMIN_EMAIL && process.env.ADMIN_BOOTSTRAP_PASSWORD && password !== process.env.ADMIN_BOOTSTRAP_PASSWORD) {
      return res.status(403).json({ error: 'Reserved administrator email: setup password required.' });
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
      if (upgraded) return res.json({ user: db.sanitizeUser(upgraded), token: upgraded.id });
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
      user: db.sanitizeUser(user),
      token: user.id
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
      user: db.sanitizeUser(user),
      token: user.id
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Login failed' });
  }
});

app.post('/api/auth/forgot-password', (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Email is required' });

    const genericMessage = 'If an account exists for that email, a reset code has been generated.';
    const user = db.getUserByEmail(email);
    if (!user) return res.json({ success: true, message: genericMessage });

    const token = db.createPasswordResetToken(email);
    // Without an email provider the code must not be handed to the requester: that would let
    // anyone reset anyone's password. It is shown only in dev, or if explicitly enabled.
    const exposeToken = !isProd || process.env.ALLOW_RESET_TOKEN_IN_RESPONSE === 'true';
    if (!exposeToken) console.log(`[Echat] Password reset code for ${email}: ${token}`);
    res.json({ success: true, message: genericMessage, ...(exposeToken ? { token } : {}) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/reset-password', (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Reset token and new password are required' });
    }

    const success = db.verifyAndResetPassword(token, newPassword);
    if (!success) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    res.json({ success: true, message: 'Password has been successfully reset. Please log in.' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (user.isBlocked) return res.status(403).json({ error: 'Account suspended' });
  res.json({ user: db.sanitizeUser(user) });
});

// Quick switcher to effortlessly test multiple personas
app.post('/api/auth/quick-switch', (req: Request, res: Response) => {
  const { userId } = req.body;
  const user = db.getUserById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: db.sanitizeUser(user), token: user.id });
});

// ----------------- USERS ROUTES -----------------
app.get('/api/users', (req: Request, res: Response) => {
  const users = db.getUsers().map(u => db.sanitizeUser(u));
  res.json(users);
});

app.get('/api/users/:id', (req: Request, res: Response) => {
  const user = db.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Get user's posts
  const posts = db.getPosts(user.id)
    .filter(p => p.authorId === user.id)
    .map(p => populatePost(p));

  // Get friends details
  const friends = user.friends
    .map(fId => db.getUserById(fId))
    .filter(Boolean)
    .map(f => db.sanitizeUser(f!));

  res.json({
    user: db.sanitizeUser(user),
    posts,
    friends
  });
});

app.put('/api/users/:id', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser || (authUser.id !== req.params.id && !isDeveloperUser(authUser))) {
    return res.status(403).json({ error: 'Unauthorized to update this profile' });
  }

  const { name, bio, location, work, education, avatar, coverPhoto, dob } = req.body;

  // Task 4: Anti-impersonation protection for normal users updating profile
  if (!isDeveloperUser(authUser) && name) {
    const reservedKeywords = ['echat official', 'super admin', 'developer', 'moderator', 'system admin', 'verified staff', 'official admin'];
    const lowerName = String(name).toLowerCase().trim();
    if (reservedKeywords.some(kw => lowerName.includes(kw))) {
      return res.status(400).json({ error: 'Prohibited Name: Impersonating EChat staff or developers violates Terms & Conditions.' });
    }
  }

  const updated = db.updateUser(req.params.id, {
    ...(name && { name: String(name).trim() }),
    ...(dob && { dob }),
    ...(bio !== undefined && { bio }),
    ...(location !== undefined && { location }),
    ...(work !== undefined && { work }),
    ...(education !== undefined && { education }),
    ...(avatar && { avatar }),
    ...(coverPhoto && { coverPhoto })
  });

  if (!updated) return res.status(404).json({ error: 'User not found' });
  const sanitized = db.sanitizeUser(updated);

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

  res.json(sanitized);
});


// ----------------- FRIENDS ROUTES -----------------
app.post('/api/friends/request', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  const { toUserId } = req.body;

  const success = db.sendFriendRequest(authUser.id, toUserId);
  if (!success) return res.status(400).json({ error: 'Cannot send friend request' });

  // Broadcast notification to recipient
  socketManager.sendToUser(toUserId, {
    type: 'new_notification',
    message: `${authUser.name} sent you a friend request.`
  });

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
function populatePost(post: any) {
  const author = db.getUserById(post.authorId);
  const populatedComments = post.comments.map((c: any) => {
    const cAuthor = db.getUserById(c.authorId);
    return {
      ...c,
      author: cAuthor ? db.sanitizeUser(cAuthor) : { name: 'Former User', avatar: '' }
    };
  });

  return {
    ...post,
    author: author ? db.sanitizeUser(author) : { name: 'Former User', avatar: '' },
    comments: populatedComments
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

app.get('/api/posts', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  const rawPosts = db.getPosts(authUser?.id);
  const populated = rawPosts.map(p => populatePost(p));
  res.json(populated);
});

app.post('/api/posts', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

  const { content, mediaUrl, mediaType, feeling, privacy } = req.body;
  if (!content && !mediaUrl) {
    return res.status(400).json({ error: 'Post must contain text or media' });
  }

  const post = db.createPost(
    authUser.id,
    content || '',
    mediaUrl,
    mediaType,
    feeling,
    privacy || 'public'
  );

  const populated = populatePost(post);
  socketManager.broadcast({ type: 'new_post', post: populated });

  res.json(populated);
});

app.post('/api/posts/:id/react', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

  const { type } = req.body;
  const post = db.toggleReaction(req.params.id, authUser.id, type || 'like');
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const populated = populatePost(post);
  socketManager.broadcast({ type: 'post_updated', post: populated });

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

  res.json(populated);
});

app.post('/api/posts/:id/share', (req: Request, res: Response) => {
  const success = db.sharePost(req.params.id);
  if (!success) return res.status(404).json({ error: 'Post not found' });
  const post = db.getPostById(req.params.id);
  const populated = post ? populatePost(post) : null;
  if (populated) socketManager.broadcast({ type: 'post_updated', post: populated });
  res.json({ success: true, sharesCount: post?.sharesCount });
});

app.post('/api/posts/:id/report', (req: Request, res: Response) => {
  const { reason } = req.body;
  const success = db.reportPost(req.params.id, reason || 'Inappropriate content');
  res.json({ success, message: 'Report submitted for review.' });
});

app.delete('/api/posts/:id', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

  const success = db.deletePost(req.params.id, authUser.id);
  if (!success) return res.status(403).json({ error: 'Failed or not authorized to delete post' });

  socketManager.broadcast({ type: 'post_deleted', postId: req.params.id });
  res.json({ success: true });
});

// ----------------- STORIES (24H STATUS) ROUTES -----------------
app.get('/api/stories', (req: Request, res: Response) => {
  const stories = db.getActiveStories();
  const populated = stories.map(s => {
    const author = db.getUserById(s.authorId);
    return {
      ...s,
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

  db.viewStory(req.params.id, authUser.id);
  res.json({ success: true });
});

// ----------------- MESSAGES / CHAT ROUTES -----------------
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
  if (!receiverId || (!text && !mediaUrl)) {
    return res.status(400).json({ error: 'Recipient and message content required' });
  }

  const receiver = db.getUserById(receiverId);
  const status = receiver?.isOnline ? 'delivered' : 'sent';

  const message = db.addMessage({
    senderId: authUser.id,
    receiverId,
    text,
    mediaUrl,
    mediaType,
    audioDuration,
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

  res.json(message);
});

app.post('/api/messages/seen', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

  const { partnerId } = req.body;
  db.markConversationSeen(authUser.id, partnerId);

  socketManager.sendToUser(partnerId, {
    type: 'messages_seen',
    viewerId: authUser.id
  });

  res.json({ success: true });
});

// ----------------- NOTIFICATIONS ROUTES -----------------
app.get('/api/notifications', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.json([]);

  const notifs = db.getNotifications(authUser.id).map(n => {
    const actor = db.getUserById(n.actorId);
    return {
      ...n,
      actor: actor ? db.sanitizeUser(actor) : null
    };
  });
  res.json(notifs);
});

app.post('/api/notifications/read', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.json({ success: true });

  db.markNotificationsRead(authUser.id);
  res.json({ success: true });
});

// ----------------- ADMIN / DEVELOPER ROUTES (100% GATED TO DEVELOPER) -----------------
app.get('/api/admin/stats', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!isDeveloperUser(authUser)) {
    return res.status(403).json({ error: 'Access denied: Master Developer credentials required' });
  }

  const stats = db.getAdminStats(socketManager.getActiveCount());
  res.json(stats);
});

app.get('/api/admin/users', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!isDeveloperUser(authUser)) {
    return res.status(403).json({ error: 'Access denied: Master Developer credentials required' });
  }

  const users = db.getUsers(true).map(u => db.sanitizeUser(u));
  res.json(users);
});

app.post('/api/admin/users/:id/toggle-block', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!isDeveloperUser(authUser)) {
    return res.status(403).json({ error: 'Access denied: Master Developer credentials required' });
  }

  const target = db.getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.role === 'developer' || isDeveloperUser(target)) {
    return res.status(400).json({ error: 'Cannot block super developer account' });
  }

  const updated = db.updateUser(target.id, { isBlocked: !target.isBlocked });
  res.json(db.sanitizeUser(updated!));
});

app.get('/api/admin/reports', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!isDeveloperUser(authUser)) {
    return res.status(403).json({ error: 'Access denied: Master Developer credentials required' });
  }

  const reportedPosts = db.getReportedPosts().map(p => populatePost(p));
  res.json(reportedPosts);
});

app.post('/api/admin/reports/:postId/dismiss', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!isDeveloperUser(authUser)) {
    return res.status(403).json({ error: 'Access denied: Master Developer credentials required' });
  }

  db.dismissReport(req.params.postId);
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
  viewersCount: number;
  reactionsCount: number;
  startedAt: number;
  isActive: boolean;
  comments: LiveComment[];
}

let activeLiveSession: LiveSession | null = null;

app.get('/api/live/current', (_req: Request, res: Response) => {
  res.json({ live: activeLiveSession });
});

app.post('/api/live/start', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

  const isDev = isDeveloperUser(authUser);
  const accountAgeDays = Math.floor((Date.now() - (authUser.createdAt || Date.now())) / (1000 * 60 * 60 * 24));

  // Gating rule:
  // a) For normal users: Go Live is locked. "Go Live unlocks after 60 days on EChat. Keep posting and engaging to unlock!"
  // b) Calculate account age from createdAt field. If now - createdAt < 60 days, block live.
  // c) For developer only: Bypass the 60-day rule. Developer can Go Live anytime.
  if (!isDev && accountAgeDays < 60) {
    return res.status(403).json({
      error: 'Go Live unlocks after 60 days on EChat. Keep posting and engaging to unlock!',
      accountAgeDays,
      daysRemaining: 60 - accountAgeDays
    });
  }

  const { title } = req.body;
  activeLiveSession = {
    id: 'live_' + crypto.randomBytes(6).toString('hex'),
    hostId: authUser.id,
    hostName: authUser.name,
    hostAvatar: authUser.avatar,
    hostEmail: authUser.email,
    isHostVerified: authUser.isVerified ?? isDev,
    title: title?.trim() || `${authUser.name} is Live on EChat!`,
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

  socketManager.broadcast({
    type: 'live_started',
    live: activeLiveSession
  });

  res.json({ success: true, live: activeLiveSession });
});

app.post('/api/live/stop', (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

  if (activeLiveSession) {
    if (activeLiveSession.hostId !== authUser.id && !isDeveloperUser(authUser)) {
      return res.status(403).json({ error: 'Only the host or developer can stop the live stream' });
    }

    const endedHostId = activeLiveSession.hostId;
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
    socketManager.broadcast({
      type: 'live_viewers_updated',
      viewersCount: activeLiveSession.viewersCount
    });
  }
  res.json({ success: true, viewersCount: activeLiveSession?.viewersCount || 1 });
});

app.post('/api/live/leave', (_req: Request, res: Response) => {
  if (activeLiveSession && activeLiveSession.isActive) {
    activeLiveSession.viewersCount = Math.max(1, activeLiveSession.viewersCount - 1);
    socketManager.broadcast({
      type: 'live_viewers_updated',
      viewersCount: activeLiveSession.viewersCount
    });
  }
  res.json({ success: true, viewersCount: activeLiveSession?.viewersCount || 1 });
});

// ----------------- PAGES ROUTES -----------------
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

    const updated = db.togglePageFollow(req.params.id, authUser.id);
    if (!updated) return res.status(404).json({ error: 'Page not found' });

    socketManager.broadcast({ type: 'page_updated', page: updated });
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
app.get('/api/groups', (_req: Request, res: Response) => {
  try {
    const groups = db.getGroups();
    res.json(groups);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/groups/:id', (req: Request, res: Response) => {
  try {
    const group = db.getGroupById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json(group);
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
    socketManager.broadcast({ type: 'group_updated', group });
    res.json({ success: true, group });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
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

app.post('/api/events', (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

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
  } catch (e: any) {
    res.status(500).json({ error: e.message });
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
    const { hashPassword } = await import('./server/db.js');
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

    if (authUser.email.toLowerCase() === 'eldermoses89@gmail.com') {
      return res.status(400).json({ error: 'Cannot delete primary developer account' });
    }

    const success = db.deleteUser(req.params.id);
    if (!success) return res.status(400).json({ error: 'Failed to delete account' });

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
        console.log('[Echat] Cleared corrupted vite cache');
      }
    }
  } catch {
    // ignore
  }

  if (!isProd) {
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
    res.status(status).json({
      error: status === 413 ? 'File or request is too large' : status < 500 ? 'Bad request' : 'Internal server error'
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Echat] Server on ${PORT}`);
  });

  // Dev only: also answer on :5173 so http://localhost:5173 works like a Vite dev server.
  if (!isProd && PORT !== 5173) {
    const altServer = http.createServer(app);
    altServer.on('error', () => { /* port busy: ignore */ });
    altServer.listen(5173, '0.0.0.0', () => {
      console.log('[vite] Local: http://localhost:5173/');
    });
  }

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((err) => {
  console.error('[Echat] Failed to start server:', err);
  process.exit(1);
});
