import { gradientCover, initialsAvatar } from './avatar.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { WriteThroughSync, type PersistenceDriver, type Snapshot } from './persistence.js';
import { AuditLog, User, Post, Story, Message, Notification, Comment, ReactionType, AdminStats, Page, PagePost, Group, GroupPost, EventItem, SiteConfig, LiveAccessRequest, LiveAccessMode } from './types.js';

// FIX: Try multiple locations because AI Studio wipes process.cwd()/data on Republish
const POSSIBLE_DATA_DIRS = [
  path.resolve(process.cwd(), 'data'),
  path.resolve('/tmp', 'echat_data'),
  path.resolve(process.cwd(), '..', 'data'),
];

const DB_FILENAME = 'echat_db.json';

export interface DatabaseSchema {
  users: User[];
  posts: Post[];
  stories: Story[];
  messages: Message[];
  notifications: Notification[];
  passwordResetTokens: { token: string; email: string; expiresAt: number }[];
  pages: Page[];
  groups: Group[];
  events: EventItem[];
  siteConfig: (SiteConfig & { id: string })[];
  auditLogs: AuditLog[];
  liveRequests: LiveAccessRequest[];
}

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + '_echat_salt_2026').digest('hex');
}

// No built-in accounts. The old demo admin (public id + password) was a backdoor; the real admin
// account is claimed through POST /api/admin/claim using the ADMIN_BOOTSTRAP_PASSWORD secret.
const SEED_USERS: User[] = [];

const SEED_PAGES: Page[] = [];
const SEED_GROUPS: Group[] = [];
const SEED_EVENTS: EventItem[] = [];

class Database {
  private data: DatabaseSchema;
  private startTime = Date.now();
  private currentDbPath: string;

  constructor() {
    const loaded = this.load();
    this.data = loaded.data;
    const assignedPostTypes = this.normalizePostTypes(this.data.posts);
    this.currentDbPath = loaded.path;
    this.removeLegacyTestAccounts();
    if (assignedPostTypes) this.save();
  }

  /** Apply the same legacy-Reel migration to local JSON and durable database records. */
  private normalizePostTypes(posts: Post[]): boolean {
    let assignedPostTypes = false;
    for (const post of posts) {
      const metadata = post as Post & { videoUrl?: string; videoType?: string; aspectRatio?: number | string };
      const ratio = typeof metadata.aspectRatio === 'number'
        ? metadata.aspectRatio
        : typeof metadata.aspectRatio === 'string' && metadata.aspectRatio.includes(':')
          ? Number(metadata.aspectRatio.split(':')[0]) / Number(metadata.aspectRatio.split(':')[1])
          : Number(metadata.aspectRatio);
      const hasVideo = post.mediaType === 'video' || Boolean(metadata.videoUrl);
      const isLegacyReel = post.type === 'reel' || metadata.isReel === true || metadata.videoType === 'reel' || (hasVideo && ratio > 0 && ratio <= 0.75);
      if (isLegacyReel) {
        if (post.type !== 'reel' || post.isReel !== true || post.mediaType !== 'video' || (!post.mediaUrl && Boolean(metadata.videoUrl))) assignedPostTypes = true;
        post.type = 'reel';
        post.isReel = true;
        post.mediaType = 'video';
        if (!post.mediaUrl && metadata.videoUrl) post.mediaUrl = metadata.videoUrl;
      } else if (!post.type || post.type === 'story') {
        post.type = 'post';
        post.isReel = false;
        assignedPostTypes = true;
      }
    }
    return assignedPostTypes;
  }

  private findExistingDbFile(): { path: string; raw: string } | null {
    for (const dir of POSSIBLE_DATA_DIRS) {
      const file = path.join(dir, DB_FILENAME);
      try {
        if (fs.existsSync(file)) {
          const raw = fs.readFileSync(file, 'utf-8');
          if (raw && raw.length > 50) {
            return { path: file, raw };
          }
        }
      } catch {}
    }
    return null;
  }

  private load(): { data: DatabaseSchema; path: string } {
    try {
      const found = this.findExistingDbFile();
      if (found) {
        const parsed = JSON.parse(found.raw);
        if (parsed && Array.isArray(parsed.users) && parsed.users.length > 0) {
          // Preserve existing user records. Legacy demo accounts are removed after loading.
          let users = parsed.users;
          const hasElder = users.some((u: User) => u.email.toLowerCase() === 'eldermoses89@gmail.com');
          if (!hasElder) {
            users = [...SEED_USERS, ...users];
          }
          return {
            data: {
              users: users,
              posts: parsed.posts || [],
              stories: parsed.stories || [],
              messages: parsed.messages || [],
              notifications: parsed.notifications || [],
              passwordResetTokens: parsed.passwordResetTokens || [],
              auditLogs: parsed.auditLogs || [],
              liveRequests: Array.isArray(parsed.liveRequests) ? parsed.liveRequests : [],
              pages: (Array.isArray(parsed.pages) && parsed.pages.length > 0) ? parsed.pages : SEED_PAGES,
              groups: (Array.isArray(parsed.groups) && parsed.groups.length > 0) ? parsed.groups : SEED_GROUPS,
              events: (Array.isArray(parsed.events) && parsed.events.length > 0) ? parsed.events : SEED_EVENTS,
              siteConfig: Array.isArray(parsed.siteConfig) && parsed.siteConfig.length > 0 ? parsed.siteConfig : [{ id: 'site', welcomeTitle: 'Welcome to EChat', welcomeSubtitle: 'Connect with friends, share 24-hour stories, and make calls with the people in your life.', liveAccessMode: 'approved_only' }]
            },
            path: found.path
          };
        }
      }
    } catch (e) {
      console.warn('[DB] Could not read existing database, will create new:', e);
      try {
        const bad = this.findExistingDbFile();
        if (bad) fs.copyFileSync(bad.path, `${bad.path}.corrupt-${Date.now()}`);
      } catch { /* best effort */ }
    }

    // No file found anywhere -> create fresh
    const defaultDir = POSSIBLE_DATA_DIRS[0];
    const defaultPath = path.join(defaultDir, DB_FILENAME);
    const initial: DatabaseSchema = {
      users: SEED_USERS,
      posts: [],
      stories: [],
      messages: [],
      notifications: [],
      passwordResetTokens: [],
      auditLogs: [],
      liveRequests: [],
      pages: SEED_PAGES,
      groups: SEED_GROUPS,
      events: SEED_EVENTS,
      siteConfig: [{ id: 'site', welcomeTitle: 'Welcome to EChat', welcomeSubtitle: 'Connect with friends, share 24-hour stories, and make calls with the people in your life.', liveAccessMode: 'approved_only' }]
    };
    this.saveToAll(initial);
    return { data: initial, path: defaultPath };
  }

  private saveToAll(dataToSave: DatabaseSchema) {
    // SAFETY: Never save empty users if we had users before
    if (dataToSave.users.length === 0) {
      if (this.data && this.data.users.length > 0) {
        console.error('[DB] SAFETY BLOCK: Refused to save empty users list!');
        return;
      }
    }
    for (const dir of POSSIBLE_DATA_DIRS) {
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const file = path.join(dir, DB_FILENAME);
        // Write to a temp file then rename: a crash mid-write can no longer leave a corrupt database.
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(dataToSave), 'utf-8');
        fs.renameSync(tmp, file);
      } catch (e) {
        // ignore write errors for secondary locations
      }
    }
  }

  /** Remove the known demo profile and its owned content from persisted app data. */
  private removeLegacyTestAccounts(): void {
    const removedIds = new Set(this.data.users
      .filter(user => user.id === 'user_admin_elder' || /^elder moses\s*\(test\)$/i.test(user.name.trim()))
      .map(user => user.id));
    const hasSeedContent = this.data.pages.some(page => ['page_tech_hub', 'page_echat_hq'].includes(page.id)) || this.data.groups.some(group => ['group_react_devs', 'group_creators'].includes(group.id)) || this.data.events.some(event => ['event_hackathon_2026', 'event_founder_talk'].includes(event.id));
    if (!removedIds.size && !hasSeedContent) return;
    this.data.users = this.data.users.filter(user => !removedIds.has(user.id));
    this.data.posts = this.data.posts.filter(post => !removedIds.has(post.authorId));
    this.data.stories = this.data.stories.filter(story => !removedIds.has(story.authorId));
    this.data.messages = this.data.messages.filter(message => !removedIds.has(message.senderId) && !removedIds.has(message.receiverId));
    this.data.notifications = this.data.notifications.filter(notification => !removedIds.has(notification.userId) && !removedIds.has(notification.actorId));
    this.data.pages = this.data.pages.filter(page => !removedIds.has(page.ownerId) && !['page_tech_hub', 'page_echat_hq'].includes(page.id));
    this.data.groups = this.data.groups.filter(group => !removedIds.has(group.ownerId) && !['group_react_devs', 'group_creators'].includes(group.id));
    this.data.events = this.data.events.filter(event => !removedIds.has(event.ownerId) && !['event_hackathon_2026', 'event_founder_talk'].includes(event.id));
    this.save();
  }

  /** Give a user developer/admin rights. Only the server calls this, after the setup secret is verified. */
  claimAdmin(userId: string, adminEmail: string): User | null {
    const user = this.getUserById(userId);
    if (!user) return null;
    const email = adminEmail.toLowerCase().trim();
    // If another account already holds the admin email, release it so the email stays unique.
    for (const other of this.data.users) {
      if (other.id !== userId && other.email?.toLowerCase() === email) {
        other.email = `former-${other.id}@echat.local`;
        other.role = 'user';
        other.isOfficialDeveloper = false;
      }
    }
    user.email = email;
    user.role = 'developer';
    user.isVerified = true;
    user.isOfficialDeveloper = true;
    this.save();
    return user;
  }

  private save(dataToSave?: DatabaseSchema) {
    const toWrite = dataToSave || this.data;
    this.saveToAll(toWrite);
    this.sync?.markDirty(); // mirror to MongoDB in the background (no-op when not configured)
  }

  // ---------- Durable storage (MongoDB) ----------
  private sync: WriteThroughSync | null = null;
  private driver: PersistenceDriver | null = null;

  private normalize(parsed: Partial<DatabaseSchema>): DatabaseSchema {
    let users = Array.isArray(parsed.users) ? parsed.users : [];
    if (!users.some((u: User) => u.email?.toLowerCase() === 'eldermoses89@gmail.com')) {
      users = [...SEED_USERS, ...users];
    }
    const posts = Array.isArray(parsed.posts) ? parsed.posts : [];
    this.normalizePostTypes(posts);
    return {
      users,
      posts,
      stories: parsed.stories || [],
      messages: parsed.messages || [],
      notifications: parsed.notifications || [],
      passwordResetTokens: parsed.passwordResetTokens || [],
      auditLogs: parsed.auditLogs || [],
      liveRequests: Array.isArray(parsed.liveRequests) ? parsed.liveRequests : [],
      pages: Array.isArray(parsed.pages) && parsed.pages.length > 0 ? parsed.pages : SEED_PAGES,
      groups: Array.isArray(parsed.groups) && parsed.groups.length > 0 ? parsed.groups : SEED_GROUPS,
      events: Array.isArray(parsed.events) && parsed.events.length > 0 ? parsed.events : SEED_EVENTS,
      siteConfig: Array.isArray(parsed.siteConfig) && parsed.siteConfig.length > 0 ? parsed.siteConfig : [{ id: 'site', welcomeTitle: 'Welcome to EChat', welcomeSubtitle: 'Connect with friends, share 24-hour stories, and make calls with the people in your life.', liveAccessMode: 'approved_only' }]
    };
  }

  getSiteConfig(): SiteConfig {
    if (!this.data.siteConfig?.length) this.data.siteConfig = [{ id: 'site' }];
    return this.data.siteConfig[0];
  }

  updateSiteConfig(updates: Partial<SiteConfig>): SiteConfig {
    const current = this.getSiteConfig();
    const updated = { ...current, ...updates, id: 'site', updatedAt: Date.now() };
    this.data.siteConfig = [updated];
    this.save();
    return updated;
  }

  getLiveAccessMode(): LiveAccessMode {
    return this.getSiteConfig().liveAccessMode || 'approved_only';
  }

  setLiveAccessMode(mode: LiveAccessMode): SiteConfig {
    return this.updateSiteConfig({ liveAccessMode: mode });
  }

  getLiveRequests(): LiveAccessRequest[] {
    this.data.liveRequests ||= [];
    return [...this.data.liveRequests].sort((a, b) => b.createdAt - a.createdAt);
  }

  createLiveRequest(userId: string, reason: string): LiveAccessRequest | null {
    this.data.liveRequests ||= [];
    const user = this.getUserById(userId);
    if (!user || user.liveAccess === 'blocked') return null;
    const pending = this.data.liveRequests.find(request => request.userId === userId && request.status === 'pending');
    if (pending) return pending;
    const request: LiveAccessRequest = {
      id: `live_request_${crypto.randomBytes(8).toString('hex')}`,
      userId,
      name: user.name,
      avatar: user.avatar,
      reason,
      status: 'pending',
      createdAt: Date.now()
    };
    this.data.liveRequests.unshift(request);
    user.liveAccess = 'pending';
    this.save();
    return request;
  }

  cancelLiveRequest(userId: string): boolean {
    this.data.liveRequests ||= [];
    const request = this.data.liveRequests.find(item => item.userId === userId && item.status === 'pending');
    if (!request) return false;
    request.status = 'cancelled';
    const user = this.getUserById(userId);
    if (user?.liveAccess === 'pending') user.liveAccess = 'none';
    this.save();
    return true;
  }

  reviewLiveRequest(requestId: string, decision: 'approved' | 'rejected' | 'blocked', reviewerId: string): LiveAccessRequest | null {
    this.data.liveRequests ||= [];
    const request = this.data.liveRequests.find(item => item.id === requestId);
    if (!request || request.status !== 'pending') return null;
    request.status = decision;
    request.reviewedBy = reviewerId;
    const user = this.getUserById(request.userId);
    if (user) user.liveAccess = decision === 'approved' ? 'approved' : decision === 'blocked' ? 'blocked' : 'none';
    this.save();
    return request;
  }

  /**
   * Connects durable storage. With MONGO_URI set (or a driver passed in), MongoDB becomes the source of
   * truth: its data is loaded into memory, and existing local data is migrated up on the first run.
   * Without it the app keeps using the local JSON file, exactly as before.
   */
  async init(driverOverride?: PersistenceDriver): Promise<void> {
    try {
      let driver = driverOverride ?? null;
      if (!driver) {
        const uri = process.env.MONGO_URI;
        if (!uri) {
          console.info('[DB] MONGO_URI not set: using the local JSON file.');
          return;
        }
        const { MongoDriver } = await import('./mongoDriver.js');
        const mongo = new MongoDriver(uri);
        await mongo.connect();
        driver = mongo;
      }

      const stored: Snapshot = await driver.load();
      const hasStored = (stored.users?.length ?? 0) > 0;
      if (hasStored) {
        this.data = this.normalize(stored as unknown as Partial<DatabaseSchema>);
        this.removeLegacyTestAccounts();
        console.info(`[DB] ${driver.name}: loaded ${this.data.users.length} users, ${this.data.posts.length} posts, ${this.data.messages.length} messages`);
      } else {
        console.info(`[DB] ${driver.name} is empty: migrating the current data into it`);
      }

      this.driver = driver;
      this.sync = new WriteThroughSync(driver, () => this.data as unknown as Record<string, unknown[]>);
      this.sync.prime(hasStored ? stored : {});
      await this.sync.flush(); // pushes anything that exists only locally (first-run migration)
      this.saveToAll(this.data); // keep the local file as a warm backup
      console.info(`[DB] ${driver.name} persistence is ON`);
    } catch (err) {
      this.sync = null;
      console.error('[DB] Durable storage unavailable, continuing with the local file only:', err);
    }
  }

  /** Keep an uploaded file in durable storage so it survives host disk resets. */
  async putFile(name: string, mime: string, data: Buffer): Promise<boolean> {
    if (!this.driver?.putFile) return false;
    await this.driver.putFile(name, mime, data);
    return true;
  }

  async getStoredFile(name: string): Promise<{ mime: string; data: Buffer } | null> {
    if (!this.driver?.getFile) return null;
    return this.driver.getFile(name);
  }

  /** Push pending changes to durable storage (call before the process exits). */
  async flush(): Promise<void> {
    await this.sync?.flush();
  }

  get persistenceStats() {
    return this.sync ? { driver: this.driver?.name, ...this.sync.stats } : null;
  }

  // --- Add backup export for you ---
  exportBackup(): DatabaseSchema {
    return this.data;
  }

  importBackup(json: DatabaseSchema): boolean {
    if (!json || !Array.isArray(json.users) || json.users.length === 0) return false;
    this.data = json;
    this.save();
    console.info(`[DB] Restored backup with ${json.users.length} users`);
    return true;
  }

  getUsers(includeBlocked = false): User[] {
    return includeBlocked ? this.data.users : this.data.users.filter(u => !u.isBlocked);
  }

  getUserById(id: string): User | undefined {
    return this.data.users.find(u => u.id === id);
  }

  getUserByEmail(email: string): User | undefined {
    const clean = email.toLowerCase().trim();
    return this.data.users.find(u => u.email.toLowerCase().trim() === clean);
  }

  createUser(user: Omit<User, 'id' | 'passwordHash' | 'createdAt' | 'isBlocked' | 'friends' | 'friendRequestsSent' | 'friendRequestsReceived' | 'lastSeen' | 'isOnline'> & { password?: string; id?: string }): User {
    if (user.id && this.data.users.some(u => u.id === user.id)) {
      throw new Error('A user with this id already exists');
    }
    const isDev = user.email.toLowerCase().trim() === 'eldermoses89@gmail.com';
    const newUser: User = {
      id: user.id || ('user_' + crypto.randomBytes(6).toString('hex')),
      name: user.name,
      email: user.email.toLowerCase().trim(),
      dob: user.dob,
      birthdayReminderEnabled: user.birthdayReminderEnabled ?? true,
      reelsAutoplay: user.reelsAutoplay ?? true,
      reelsWifiOnly: user.reelsWifiOnly ?? false,
      passwordHash: hashPassword(user.password || ''),
      avatar: user.avatar || initialsAvatar(user.name),
      coverPhoto: user.coverPhoto || gradientCover(user.name),
      bio: user.bio || 'Hello, I am on Echat!',
      location: user.location || 'Earth',
      work: user.work || '',
      education: user.education || '',
      role: isDev ? 'developer' : (user.role || 'user'),
      liveAccess: isDev ? 'approved' : (user.liveAccess || 'none'),
      liveAuthSecret: crypto.randomBytes(32).toString('hex'),
      isVerified: isDev,
      isOfficialDeveloper: isDev,
      boostsCount: isDev ? 420 : 0,
      boostedBy: [],
      isBlocked: false,
      isOnline: false,
      lastSeen: Date.now(),
      createdAt: Date.now(),
      friends: [],
      friendRequestsSent: [],
      friendRequestsReceived: []
    };
    this.data.users.push(newUser);
    this.save();
    return newUser;
  }

  boostUser(targetUserId: string, boosterUserId: string): { user: User; hasBoosted: boolean } | null {
    const target = this.getUserById(targetUserId);
    if (!target) return null;
    if (!target.boostedBy) target.boostedBy = [];
    if (!target.boostsCount) target.boostsCount = 0;
    const already = target.boostedBy.includes(boosterUserId);
    if (already) {
      target.boostedBy = target.boostedBy.filter(id => id !== boosterUserId);
      target.boostsCount = Math.max(0, target.boostsCount - 1);
    } else {
      target.boostedBy.push(boosterUserId);
      target.boostsCount += 1;
    }
    this.save();
    return { user: target, hasBoosted: !already };
  }

  updateUser(id: string, updates: Partial<User>): User | null {
    const idx = this.data.users.findIndex(u => u.id === id);
    if (idx === -1) return null;
    this.data.users[idx] = { ...this.data.users[idx], ...updates };
    this.save();
    return this.data.users[idx];
  }

  setUserOnline(id: string, isOnline: boolean) {
    const u = this.getUserById(id);
    if (u) {
      u.isOnline = isOnline;
      u.lastSeen = Date.now();
      this.save();
    }
  }

  sanitizeUser(user: User, viewerId?: string): Omit<User, 'passwordHash'> & { dobMonthDay?: string } {
    const { passwordHash, liveAuthSecret, dob, dobVisibility = 'public', ...safe } = user;
    const isOwner = viewerId === user.id;
    const viewer = viewerId ? this.getUserById(viewerId) : undefined;
    const isFriend = Boolean(viewer && user.friends.includes(viewer.id) && viewer.friends.includes(user.id));
    if (!dob || isOwner || dobVisibility === 'public' || (dobVisibility === 'friends' && isFriend)) {
      return { ...safe, ...(dob ? { dob } : {}), dobVisibility };
    }
    if (dobVisibility === 'month_day_only') {
      return { ...safe, dobVisibility, ...(dob ? { dobMonthDay: dob.slice(5) } : {}) };
    }
    return { ...safe, dobVisibility };
  }

  sendFriendRequest(fromUserId: string, toUserId: string): boolean {
    if (fromUserId === toUserId) return false;
    const fromUser = this.getUserById(fromUserId);
    const toUser = this.getUserById(toUserId);
    if (!fromUser || !toUser) return false;
    if (fromUser.friends.includes(toUserId)) return true;
    if (!fromUser.friendRequestsSent.includes(toUserId)) fromUser.friendRequestsSent.push(toUserId);
    if (!toUser.friendRequestsReceived.includes(fromUserId)) toUser.friendRequestsReceived.push(fromUserId);
    this.addNotification({
      userId: toUserId,
      actorId: fromUserId,
      type: 'friend_request',
      message: `${fromUser.name} sent you a friend request.`,
      read: false
    });
    this.save();
    return true;
  }

  acceptFriendRequest(userId: string, targetUserId: string): boolean {
    const user = this.getUserById(userId);
    const targetUser = this.getUserById(targetUserId);
    if (!user || !targetUser) return false;
    user.friendRequestsReceived = user.friendRequestsReceived.filter(id => id !== targetUserId);
    targetUser.friendRequestsSent = targetUser.friendRequestsSent.filter(id => id !== userId);
    if (!user.friends.includes(targetUserId)) user.friends.push(targetUserId);
    if (!targetUser.friends.includes(userId)) targetUser.friends.push(userId);
    this.addNotification({
      userId: targetUserId,
      actorId: userId,
      type: 'friend_accept',
      message: `${user.name} accepted your friend request.`,
      read: false
    });
    this.save();
    return true;
  }

  rejectFriendRequest(userId: string, targetUserId: string): boolean {
    const user = this.getUserById(userId);
    const targetUser = this.getUserById(targetUserId);
    if (!user || !targetUser) return false;
    user.friendRequestsReceived = user.friendRequestsReceived.filter(id => id !== targetUserId);
    targetUser.friendRequestsSent = targetUser.friendRequestsSent.filter(id => id !== userId);
    this.save();
    return true;
  }

  unfriend(userId: string, friendId: string): boolean {
    const user = this.getUserById(userId);
    const friend = this.getUserById(friendId);
    if (!user || !friend) return false;
    user.friends = user.friends.filter(id => id !== friendId);
    friend.friends = friend.friends.filter(id => id !== userId);
    this.save();
    return true;
  }

  isBlockedBetween(a: string, b: string): boolean {
    const ua = this.getUserById(a);
    const ub = this.getUserById(b);
    return Boolean(ua?.blockedUsers?.includes(b) || ub?.blockedUsers?.includes(a));
  }

  /** Public posts are visible to everyone; friends-only to the author's friends; only-me to the author. */
  canViewPost(post: Post, viewerId?: string): boolean {
    if (viewerId && post.authorId === viewerId) return true;
    if (viewerId && this.isBlockedBetween(post.authorId, viewerId)) return false;
    if (post.privacy === 'only_me') return false;
    if (post.privacy === 'friends') {
      return Boolean(viewerId && this.getUserById(post.authorId)?.friends?.includes(viewerId));
    }
    return true;
  }

  getPosts(viewerId?: string): Post[] {
    const isDev = Boolean(viewerId && this.getUserById(viewerId)?.role === 'developer');
    return this.data.posts
      .filter(p => (!p.isReported || isDev) && this.canViewPost(p, viewerId))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  recordPostView(postId: string, viewerId: string): Post | null {
    const post = this.getPostById(postId);
    if (!post || post.authorId === viewerId || !this.canViewPost(post, viewerId)) return post || null;
    const now = Date.now();
    if (!post.viewRecords) post.viewRecords = (post.views || []).map(userId => ({ userId, viewedAt: post.createdAt }));
    if (post.viewRecords.some(record => record.userId === viewerId && now - record.viewedAt < 24 * 60 * 60 * 1000)) return post;
    post.viewRecords.push({ userId: viewerId, viewedAt: now });
    post.views = [...new Set(post.viewRecords.map(record => record.userId))];
    post.viewsCount = post.viewRecords.length;
    this.save();
    return post;
  }

  getPostViewRecords(postId: string): { userId: string; viewedAt: number }[] {
    const post = this.getPostById(postId);
    if (!post) return [];
    const records = post.viewRecords ?? (post.views || []).map(userId => ({ userId, viewedAt: post.createdAt }));
    return [...records].sort((a, b) => b.viewedAt - a.viewedAt);
  }

  // ---------- Saved posts (bookmarks) ----------
  toggleSavedPost(userId: string, postId: string): { saved: boolean; savedPosts: string[] } | null {
    const user = this.getUserById(userId);
    const post = this.getPostById(postId);
    if (!user || !post || !this.canViewPost(post, userId)) return null;
    const list = user.savedPosts ?? [];
    const saved = !list.includes(postId);
    user.savedPosts = saved ? [postId, ...list] : list.filter(id => id !== postId);
    this.save();
    return { saved, savedPosts: user.savedPosts };
  }

  getSavedPosts(userId: string): Post[] {
    const ids = this.getUserById(userId)?.savedPosts ?? [];
    return ids
      .map(id => this.getPostById(id))
      .filter((p): p is Post => Boolean(p) && this.canViewPost(p as Post, userId));
  }

  // ---------- Trending topics (hashtags in the last 7 days) ----------
  getTrendingTags(limit = 8, viewerId?: string): { tag: string; count: number }[] {
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const counts = new Map<string, number>();
    for (const p of this.data.posts) {
      if (p.createdAt < since || !this.canViewPost(p, viewerId)) continue;
      const seen = new Set<string>();
      for (const m of (p.content || '').matchAll(/#([\p{L}\p{N}_]{2,40})/gu)) {
        const tag = m[1].toLowerCase();
        if (seen.has(tag)) continue;
        seen.add(tag);
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, limit);
  }

  getPostById(id: string): Post | undefined {
    return this.data.posts.find(p => p.id === id);
  }

  assignPostPageIdentity(postId: string, pageId: string): void {
    const post = this.getPostById(postId);
    if (!post) return;
    post.pageId = pageId;
    this.save();
  }

  createPost(
    authorId: string,
    content: string,
    mediaUrl?: string,
    mediaType?: 'image' | 'video',
    feeling?: string,
    privacy: 'public' | 'friends' | 'only_me' = 'public',
    extras: { taggedUserIds?: string[]; sharedPostId?: string; mediaUrls?: string[]; images?: string[]; imagesCount?: number; v2?: Post['v2']; type?: 'post' | 'reel' | 'story'; isReel?: boolean; thumbnailUrl?: string; mediaDuration?: number; mediaSize?: number } = {}
  ): Post {
    const newPost: Post = {
      id: 'post_' + crypto.randomBytes(6).toString('hex'),
      authorId,
      type: extras.type || 'post',
      isReel: extras.isReel ?? extras.type === 'reel',
      content,
      mediaUrl,
      ...(extras.mediaUrls?.length ? { mediaUrls: extras.mediaUrls.slice(0, 10) } : {}),
      ...(extras.images?.length ? { images: extras.images.slice(0, 10) } : {}),
      ...(Number.isFinite(extras.imagesCount) ? { imagesCount: Math.max(0, Math.min(10, Number(extras.imagesCount))) } : {}),
      ...(extras.v2 ? { v2: extras.v2 } : {}),
      mediaType,
      ...(extras.thumbnailUrl ? { thumbnailUrl: extras.thumbnailUrl } : {}),
      ...(Number.isFinite(extras.mediaDuration) ? { mediaDuration: extras.mediaDuration } : {}),
      ...(Number.isFinite(extras.mediaSize) ? { mediaSize: extras.mediaSize } : {}),
      feeling,
      privacy,
      reactions: [],
      comments: [],
      sharesCount: 0,
      viewsCount: 0,
      views: [],
      isReported: false,
      createdAt: Date.now(),
      ...(extras.taggedUserIds && extras.taggedUserIds.length > 0 && { taggedUserIds: extras.taggedUserIds }),
      ...(extras.sharedPostId && { sharedPostId: extras.sharedPostId })
    };
    this.data.posts.unshift(newPost);
    this.save();
    return newPost;
  }

  toggleReaction(postId: string, userId: string, type: ReactionType): Post | null {
    const post = this.getPostById(postId);
    if (!post) return null;
    if (!post.reactions) post.reactions = [];
    const existingIndex = post.reactions.findIndex(r => r.userId === userId);
    if (existingIndex > -1) {
      if (post.reactions[existingIndex].type === type) {
        post.reactions.splice(existingIndex, 1);
      } else {
        post.reactions[existingIndex].type = type;
        post.reactions[existingIndex].createdAt = Date.now();
      }
    } else {
      post.reactions.push({ userId, type, createdAt: Date.now() });
      if (post.authorId !== userId) {
        const reactor = this.getUserById(userId);
        this.addNotification({
          userId: post.authorId,
          actorId: userId,
          type: 'post_reaction',
          targetId: postId,
          message: `${reactor?.name || 'Someone'} reacted to your post.`,
          read: false
        });
      }
    }
    this.save();
    return post;
  }

  addComment(postId: string, authorId: string, content: string): { post: Post; comment: Comment } | null {
    const post = this.getPostById(postId);
    if (!post) return null;
    if (!post.comments) post.comments = [];
    const comment: Comment = {
      id: 'comment_' + crypto.randomBytes(6).toString('hex'),
      postId,
      authorId,
      content,
      createdAt: Date.now(),
      likes: []
    };
    post.comments.push(comment);
    if (post.authorId !== authorId) {
      const commenter = this.getUserById(authorId);
      this.addNotification({
        userId: post.authorId,
        actorId: authorId,
        type: 'post_comment',
        targetId: postId,
        message: `${commenter?.name || 'Someone'} commented on your post.`,
        read: false
      });
    }
    this.save();
    return { post, comment };
  }

  sharePost(postId: string): boolean {
    const post = this.getPostById(postId);
    if (!post) return false;
    post.sharesCount = (post.sharesCount || 0) + 1;
    this.save();
    return true;
  }

  reportPost(postId: string, reason: string): boolean {
    const post = this.getPostById(postId);
    if (!post) return false;
    post.isReported = true;
    post.reportReason = reason;
    this.save();
    return true;
  }

  dismissReport(postId: string): boolean {
    const post = this.getPostById(postId);
    if (!post) return false;
    post.isReported = false;
    delete post.reportReason;
    this.save();
    return true;
  }

  deletePost(postId: string, requesterId: string): boolean {
    const post = this.getPostById(postId);
    if (!post) return false;
    const requester = this.getUserById(requesterId);
    const isDev = requester?.role === 'developer';
    if (post.authorId !== requesterId && !isDev) return false;
    this.data.posts = this.data.posts.filter(p => p.id !== postId);
    this.save();
    return true;
  }

  updatePost(
    postId: string,
    requesterId: string,
    updates: { content?: string; privacy?: 'public' | 'friends' | 'only_me'; feeling?: string }
  ): Post | null {
    const post = this.getPostById(postId);
    if (!post || post.authorId !== requesterId) return null; // only the author may edit
    if (updates.content !== undefined) post.content = updates.content;
    if (updates.privacy) post.privacy = updates.privacy;
    if (updates.feeling !== undefined) post.feeling = updates.feeling || undefined;
    post.editedAt = Date.now();
    this.save();
    return post;
  }

  getReportedPosts(): Post[] {
    return this.data.posts.filter(p => p.isReported);
  }

  getActiveStories(): Story[] {
    const now = Date.now();
    return this.data.stories
      .filter(s => s.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  createStory(
    authorId: string,
    type: 'text' | 'image' | 'video',
    mediaUrl?: string,
    text?: string,
    backgroundGradient?: string
  ): Story {
    const now = Date.now();
    const story: Story = {
      id: 'story_' + crypto.randomBytes(6).toString('hex'),
      authorId,
      type,
      mediaUrl,
      text,
      backgroundGradient,
      viewers: [],
      createdAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000
    };
    this.data.stories.unshift(story);
    this.save();
    return story;
  }

  viewStory(storyId: string, userId: string): boolean {
    const story = this.data.stories.find(s => s.id === storyId);
    if (!story) return false;
    if (!story.viewers.some(v => v.userId === userId)) {
      story.viewers.push({ userId, viewedAt: Date.now() });
      this.save();
    }
    return true;
  }

  getStoryById(storyId: string): Story | undefined {
    return this.data.stories.find(s => s.id === storyId);
  }

  getConversation(userA: string, userB: string): Message[] {
    return this.data.messages
      .filter(m =>
        (m.senderId === userA && m.receiverId === userB) ||
        (m.senderId === userB && m.receiverId === userA)
      )
      .filter(message => !message.deletedFor?.includes(userA))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(message => { const visible = { ...message }; delete visible.editHistory; delete visible.deletedFor; return visible; });
  }

  deleteMessageForUser(messageId: string, userId: string): boolean {
    const message = this.data.messages.find(item => item.id === messageId && (item.senderId === userId || item.receiverId === userId));
    if (!message) return false;
    message.deletedFor = Array.from(new Set([...(message.deletedFor || []), userId]));
    this.save();
    return true;
  }

  getConversationPartners(userId: string): string[] {
    const partners = new Set<string>();
    for (const message of this.data.messages) {
      if (message.senderId === userId) partners.add(message.receiverId);
      else if (message.receiverId === userId) partners.add(message.senderId);
    }
    return [...partners];
  }

  addMessage(msg: Omit<Message, 'id' | 'createdAt' | 'status'> & { status?: 'sent' | 'delivered' | 'seen' }): Message {
    const convId = msg.conversationId || [msg.senderId, msg.receiverId].sort().join('_');
    const newMsg: Message = {
      id: 'msg_' + crypto.randomBytes(6).toString('hex'),
      conversationId: convId,
      senderId: msg.senderId,
      receiverId: msg.receiverId,
      text: msg.text,
      mediaUrl: msg.mediaUrl,
      mediaType: msg.mediaType,
      audioDuration: msg.audioDuration,
      attachments: msg.attachments?.slice(0, 10),
      status: msg.status || 'sent',
      createdAt: Date.now()
    };
    this.data.messages.push(newMsg);
    this.save();
    return newMsg;
  }

  editMessage(messageId: string, senderId: string, text: string): Message | null {
    const message = this.data.messages.find(item => item.id === messageId && item.senderId === senderId);
    if (!message || !message.text || message.mediaUrl || message.mediaType || message.attachments?.length || Date.now() - message.createdAt > 15 * 60 * 1000) return null;
    message.editHistory = [...(message.editHistory || []), { text: message.text, editedAt: Date.now() }];
    message.text = text;
    message.editedAt = Date.now();
    this.save();
    return message;
  }

  updateMessageStatus(messageId: string, status: 'delivered' | 'seen'): Message | null {
    const msg = this.data.messages.find(m => m.id === messageId);
    if (!msg) return null;
    msg.status = status;
    this.save();
    return msg;
  }

  markConversationSeen(viewerId: string, partnerId: string): void {
    let changed = false;
    for (const msg of this.data.messages) {
      if (msg.senderId === partnerId && msg.receiverId === viewerId && msg.status !== 'seen') {
        msg.status = 'seen';
        changed = true;
      }
    }
    if (changed) this.save();
  }

  getNotifications(userId: string): Notification[] {
    return this.data.notifications
      .filter(n => n.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** One rolling notification per sender: new messages update it instead of flooding the bell. */
  upsertMessageNotification(userId: string, actorId: string, message: string): Notification {
    const existing = this.data.notifications.find(
      n => n.userId === userId && n.actorId === actorId && n.type === 'message' && !n.read
    );
    if (existing) {
      existing.message = message;
      existing.createdAt = Date.now();
      this.save();
      return existing;
    }
    return this.addNotification({ userId, actorId, type: 'message', message, targetId: actorId, read: false });
  }

  markMessageNotificationsRead(userId: string, actorId: string): void {
    let changed = false;
    for (const n of this.data.notifications) {
      if (n.userId === userId && n.actorId === actorId && n.type === 'message' && !n.read) {
        n.read = true;
        changed = true;
      }
    }
    if (changed) this.save();
  }

  addNotification(notif: Omit<Notification, 'id' | 'createdAt'>): Notification {
    const newNotif: Notification = {
      id: 'notif_' + crypto.randomBytes(6).toString('hex'),
      ...notif,
      createdAt: Date.now()
    };
    this.data.notifications.unshift(newNotif);
    if (this.data.notifications.length > 500) {
      this.data.notifications = this.data.notifications.slice(0, 500);
    }
    this.save();
    return newNotif;
  }

  markNotificationsRead(userId: string, exceptTypes: string[] = []): void {
    let changed = false;
    for (const notif of this.data.notifications) {
      if (notif.userId === userId && !notif.read && !exceptTypes.includes(notif.type)) {
        notif.read = true;
        changed = true;
      }
    }
    if (changed) this.save();
  }

  createPasswordResetToken(email: string): string {
    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + 60 * 60 * 1000;
    if (!this.data.passwordResetTokens) this.data.passwordResetTokens = [];
    this.data.passwordResetTokens = this.data.passwordResetTokens.filter(t => t.email !== email);
    this.data.passwordResetTokens.push({ token, email, expiresAt });
    this.save();
    return token;
  }

  verifyAndResetPassword(token: string, newPassword: string): boolean {
    if (!this.data.passwordResetTokens) return false;
    const item = this.data.passwordResetTokens.find(t => t.token === token && t.expiresAt > Date.now());
    if (!item) return false;
    const user = this.getUserByEmail(item.email);
    if (!user) return false;
    user.passwordHash = hashPassword(newPassword);
    this.data.passwordResetTokens = this.data.passwordResetTokens.filter(t => t.token !== token);
    this.save();
    return true;
  }

  // ---------- Admin: audit trail ----------
  addAuditLog(entry: Omit<AuditLog, 'id' | 'createdAt'>): AuditLog {
    if (!this.data.auditLogs) this.data.auditLogs = [];
    const log: AuditLog = { id: 'log_' + crypto.randomBytes(6).toString('hex'), createdAt: Date.now(), ...entry };
    this.data.auditLogs.unshift(log);
    if (this.data.auditLogs.length > 2000) this.data.auditLogs.length = 2000; // keep the newest 2000
    this.save();
    return log;
  }

  getAuditLogs(limit = 200): AuditLog[] {
    return (this.data.auditLogs || []).slice(0, Math.max(1, Math.min(limit, 1000)));
  }

  toggleVerified(userId: string): User | null {
    const user = this.getUserById(userId);
    if (!user) return null;
    user.isVerified = !user.isVerified;
    this.save();
    return user;
  }

  /** Everyone gets one announcement notification (the sender and blocked accounts are skipped). */
  createAnnouncement(actorId: string, message: string): Notification[] {
    const created: Notification[] = [];
    for (const u of this.data.users) {
      if (u.id === actorId || u.isBlocked) continue;
      created.push(this.addNotification({ userId: u.id, actorId, type: 'announcement', message, read: false }));
    }
    return created;
  }

  // ---------- Admin: analytics ----------
  getAnalytics(days = 14) {
    const n = Math.max(7, Math.min(days, 60));
    const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
    const buckets = new Map<string, { date: string; signups: number; posts: number; messages: number; stories: number }>();
    for (let i = n - 1; i >= 0; i--) {
      const date = dayKey(Date.now() - i * 86400000);
      buckets.set(date, { date, signups: 0, posts: 0, messages: 0, stories: 0 });
    }
    const bump = (t: number, field: 'signups' | 'posts' | 'messages' | 'stories') => {
      const b = buckets.get(dayKey(t));
      if (b) b[field] += 1;
    };
    this.data.users.forEach(u => bump(u.createdAt, 'signups'));
    this.data.posts.forEach(p => bump(p.createdAt, 'posts'));
    this.data.messages.forEach(m => bump(m.createdAt, 'messages'));
    this.data.stories.forEach(s => bump(s.createdAt, 'stories'));

    const reactionCounts = new Map<string, number>();
    for (const p of this.data.posts) for (const r of p.reactions) reactionCounts.set(r.type, (reactionCounts.get(r.type) ?? 0) + 1);

    const authorCounts = new Map<string, number>();
    for (const p of this.data.posts) authorCounts.set(p.authorId, (authorCounts.get(p.authorId) ?? 0) + 1);

    const topPosts = [...this.data.posts]
      .map(p => ({
        id: p.id,
        snippet: (p.content || (p.mediaUrl ? '[photo/video]' : '')).slice(0, 90),
        authorName: this.getUserById(p.authorId)?.name ?? 'Former User',
        reactions: p.reactions.length,
        comments: p.comments.length,
        shares: p.sharesCount || 0,
        score: p.reactions.length + p.comments.length * 2 + (p.sharesCount || 0) * 3
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const topAuthors = [...authorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, posts]) => {
        const u = this.getUserById(id);
        return { id, name: u?.name ?? 'Former User', avatar: u?.avatar ?? '', posts };
      });

    return {
      days: [...buckets.values()],
      reactions: [...reactionCounts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
      topPosts,
      topAuthors,
      verifiedUsers: this.data.users.filter(u => u.isVerified).length,
      developers: this.data.users.filter(u => u.role === 'developer').length,
      totals: {
        users: this.data.users.length,
        posts: this.data.posts.length,
        messages: this.data.messages.length,
        stories: this.data.stories.length,
        pages: this.data.pages?.length ?? 0,
        groups: this.data.groups?.length ?? 0,
        events: this.data.events?.length ?? 0
      }
    };
  }

  getAdminStats(activeSocketsCount: number): AdminStats {
    const totalUsers = this.data.users.length;
    const onlineUsers = this.data.users.filter(u => u.isOnline).length;
    const blockedUsers = this.data.users.filter(u => u.isBlocked).length;
    const totalPosts = this.data.posts.length;
    const totalMessages = this.data.messages.length;
    const totalStories = this.data.stories.length;
    const pendingReports = this.data.posts.filter(p => p.isReported).length;
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    return {
      totalUsers,
      onlineUsers,
      blockedUsers,
      totalPosts,
      totalMessages,
      totalStories,
      pendingReports,
      activeSockets: activeSocketsCount,
      uptimeSeconds
    };
  }

  // --- PAGES ---
  getPages(): Page[] {
    if (!this.data.pages) this.data.pages = [];
    return this.data.pages.sort((a, b) => b.createdAt - a.createdAt);
  }

  getPageById(id: string): Page | undefined {
    return this.getPages().find(p => p.id === id);
  }

  createPage(data: { name: string; category: string; bio: string; cover: string; avatar?: string; ownerId: string; ownerName?: string }): Page {
    if (!this.data.pages) this.data.pages = [];
    const newPage: Page = {
      id: 'page_' + crypto.randomBytes(6).toString('hex'),
      name: data.name,
      category: data.category || 'General',
      bio: data.bio || '',
      cover: data.cover || '',
      avatar: data.avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(data.name)}`,
      ownerId: data.ownerId,
      ownerName: data.ownerName || 'Creator',
      followers: [data.ownerId],
      likes: [data.ownerId],
      posts: [],
      createdAt: Date.now()
    };
    this.data.pages.unshift(newPage);
    this.save();
    return newPage;
  }

  updatePage(
    pageId: string,
    updates: { name?: string; category?: string; bio?: string; avatar?: string; cover?: string }
  ): Page | null {
    const page = this.getPageById(pageId);
    if (!page) return null;
    if (updates.name !== undefined) page.name = updates.name;
    if (updates.category !== undefined) page.category = updates.category;
    if (updates.bio !== undefined) page.bio = updates.bio;
    if (updates.avatar !== undefined) page.avatar = updates.avatar;
    if (updates.cover !== undefined) page.cover = updates.cover;
    this.save();
    return page;
  }

  updateGroup(
    groupId: string,
    updates: { name?: string; description?: string; privacy?: 'public' | 'private'; avatar?: string; cover?: string }
  ): Group | null {
    const group = this.getGroupById(groupId);
    if (!group) return null;
    if (updates.name !== undefined) group.name = updates.name;
    if (updates.description !== undefined) group.description = updates.description;
    if (updates.privacy !== undefined) group.privacy = updates.privacy;
    if (updates.avatar !== undefined) group.avatar = updates.avatar;
    if (updates.cover !== undefined) group.cover = updates.cover;
    this.save();
    return group;
  }

  togglePageFollow(pageId: string, userId: string): Page | null {
    const page = this.getPageById(pageId);
    if (!page) return null;
    if (!page.followers) page.followers = [];
    if (page.followers.includes(userId)) {
      page.followers = page.followers.filter(id => id !== userId);
    } else {
      page.followers.push(userId);
    }
    this.save();
    return page;
  }

  togglePageLike(pageId: string, userId: string): Page | null {
    const page = this.getPageById(pageId);
    if (!page) return null;
    if (!page.likes) page.likes = [];
    if (page.likes.includes(userId)) {
      page.likes = page.likes.filter(id => id !== userId);
    } else {
      page.likes.push(userId);
    }
    this.save();
    return page;
  }

  addPagePost(pageId: string, postData: { authorId: string; content: string; mediaUrl?: string; mediaType?: 'image' | 'video' }): PagePost | null {
    const page = this.getPageById(pageId);
    if (!page) return null;
    if (!page.posts) page.posts = [];
    const newPost: PagePost = {
      id: 'ppost_' + crypto.randomBytes(6).toString('hex'),
      pageId,
      authorId: postData.authorId,
      content: postData.content,
      mediaUrl: postData.mediaUrl,
      mediaType: postData.mediaType,
      likes: [],
      comments: [],
      createdAt: Date.now()
    };
    page.posts.unshift(newPost);
    this.save();
    return newPost;
  }

  // --- GROUPS ---
  getGroups(): Group[] {
    if (!this.data.groups) this.data.groups = [];
    return this.data.groups.sort((a, b) => b.createdAt - a.createdAt);
  }

  getGroupById(id: string): Group | undefined {
    return this.getGroups().find(g => g.id === id);
  }

  createGroup(data: { name: string; privacy: 'public' | 'private'; cover: string; description: string; avatar?: string; ownerId: string; ownerName?: string }): Group {
    if (!this.data.groups) this.data.groups = [];
    const newGroup: Group = {
      id: 'group_' + crypto.randomBytes(6).toString('hex'),
      name: data.name,
      privacy: data.privacy || 'public',
      cover: data.cover || 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1200&q=80',
      description: data.description || '',
      avatar: data.avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(data.name)}`,
      ownerId: data.ownerId,
      ownerName: data.ownerName || 'Community Leader',
      members: [data.ownerId],
      posts: [],
      createdAt: Date.now()
    };
    this.data.groups.unshift(newGroup);
    this.save();
    return newGroup;
  }

  joinGroup(groupId: string, userId: string): Group | null {
    const group = this.getGroupById(groupId);
    if (!group) return null;
    if (!group.members) group.members = [];
    if (!group.members.includes(userId)) {
      group.members.push(userId);
      this.save();
    }
    return group;
  }

  leaveGroup(groupId: string, userId: string): Group | null {
    const group = this.getGroupById(groupId);
    if (!group) return null;
    if (!group.members) group.members = [];
    group.members = group.members.filter(id => id !== userId);
    this.save();
    return group;
  }

  addGroupPost(groupId: string, postData: { authorId: string; authorName: string; authorAvatar: string; content: string; mediaUrl?: string; mediaType?: 'image' | 'video' }): GroupPost | null {
    const group = this.getGroupById(groupId);
    if (!group) return null;
    if (!group.posts) group.posts = [];
    // If owner or public group without strict moderation, auto-approved
    const isOwner = group.ownerId === postData.authorId;
    const status: 'approved' | 'pending' = isOwner ? 'approved' : (group.privacy === 'public' ? 'approved' : 'pending');
    const newPost: GroupPost = {
      id: 'gpost_' + crypto.randomBytes(6).toString('hex'),
      groupId,
      authorId: postData.authorId,
      authorName: postData.authorName,
      authorAvatar: postData.authorAvatar,
      content: postData.content,
      mediaUrl: postData.mediaUrl,
      mediaType: postData.mediaType,
      status,
      likes: [],
      comments: [],
      createdAt: Date.now()
    };
    group.posts.unshift(newPost);
    this.save();
    return newPost;
  }

  approveGroupPost(groupId: string, postId: string, userId: string): boolean {
    const group = this.getGroupById(groupId);
    if (!group) return false;
    // Only owner or admin can approve
    const user = this.getUserById(userId);
    if (group.ownerId !== userId && user?.role !== 'developer') return false;
    const post = group.posts?.find(p => p.id === postId);
    if (!post) return false;
    post.status = 'approved';
    this.save();
    return true;
  }

  // --- EVENTS ---
  getEvents(): EventItem[] {
    if (!this.data.events) this.data.events = [];
    return this.data.events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  getEventById(id: string): EventItem | undefined {
    return this.getEvents().find(e => e.id === id);
  }

  createEvent(data: { title: string; date: string; location: string; cover: string; description: string; ownerId: string; ownerName?: string }): EventItem {
    if (!this.data.events) this.data.events = [];
    const newEvent: EventItem = {
      id: 'event_' + crypto.randomBytes(6).toString('hex'),
      title: data.title,
      date: data.date,
      location: data.location || 'Online',
      cover: data.cover || 'https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=1200&q=80',
      description: data.description || '',
      ownerId: data.ownerId,
      ownerName: data.ownerName || 'Host',
      going: [data.ownerId],
      interested: [],
      createdAt: Date.now()
    };
    this.data.events.unshift(newEvent);
    this.save();
    return newEvent;
  }

  toggleEventGoing(eventId: string, userId: string): EventItem | null {
    const event = this.getEventById(eventId);
    if (!event) return null;
    if (!event.going) event.going = [];
    if (!event.interested) event.interested = [];
    if (event.going.includes(userId)) {
      event.going = event.going.filter(id => id !== userId);
    } else {
      event.going.push(userId);
      event.interested = event.interested.filter(id => id !== userId);
    }
    this.save();
    return event;
  }

  toggleEventInterested(eventId: string, userId: string): EventItem | null {
    const event = this.getEventById(eventId);
    if (!event) return null;
    if (!event.going) event.going = [];
    if (!event.interested) event.interested = [];
    if (event.interested.includes(userId)) {
      event.interested = event.interested.filter(id => id !== userId);
    } else {
      event.interested.push(userId);
      event.going = event.going.filter(id => id !== userId);
    }
    this.save();
    return event;
  }

  // --- ACCOUNT DELETION ---
  deleteUser(userId: string): boolean {
    const user = this.getUserById(userId);
    if (!user) return false;
    // Protect primary developer account from accidental self-destruction
    if (user.email.toLowerCase() === 'eldermoses89@gmail.com') {
      return false;
    }
    this.data.users = this.data.users.filter(u => u.id !== userId);
    // Remove from other users' friends and friend requests
    this.data.users.forEach(u => {
      u.friends = (u.friends || []).filter(id => id !== userId);
      u.friendRequestsSent = (u.friendRequestsSent || []).filter(id => id !== userId);
      u.friendRequestsReceived = (u.friendRequestsReceived || []).filter(id => id !== userId);
    });
    // Remove user's posts
    this.data.posts = (this.data.posts || []).filter(p => p.authorId !== userId);
    // Remove user's stories
    this.data.stories = (this.data.stories || []).filter(s => s.authorId !== userId);
    this.save();
    return true;
  }
}

export const db = new Database();
