import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { User, Post, Story, Message, Notification, Comment, ReactionType, AdminStats, Page, PagePost, Group, GroupPost, EventItem } from './types.js';

const MONGO_URI = process.env.MONGO_URI;
let mongoReady = false;

const AnySchema = new mongoose.Schema({}, { strict: false, _id: false });
const getModel = (name: string, col: string) => {
  return mongoose.models[name] || mongoose.model(name, AnySchema, col);
};

async function connectMongo() {
  if (!MONGO_URI) { console.log('[DB] No MONGO_URI - using JSON fallback'); return false; }
  if (mongoReady) return true;
  try {
    await mongoose.connect(MONGO_URI);
    mongoReady = true;
    console.log('[DB] MongoDB Connected ✅');
    return true;
  } catch (e) {
    console.error('[DB] Mongo connect failed', e);
    return false;
  }
}
connectMongo();

async function saveToMongo(data: any) {
  if (!mongoReady) return;
  try {
    const UserModel = getModel('User', 'users');
    await UserModel.deleteMany({});
    if(data.users?.length) await UserModel.insertMany(data.users);
    const MessageModel = getModel('Message', 'messages');
    await MessageModel.deleteMany({});
    if(data.messages?.length) await MessageModel.insertMany(data.messages);
    const PostModel = getModel('Post', 'posts');
    await PostModel.deleteMany({});
    if(data.posts?.length) await PostModel.insertMany(data.posts);
  } catch (e) {
    console.error('[DB] Mongo save error', e);
  }
}

async function loadFromMongo(): Promise<any> {
  if (!mongoReady) {
    const ok = await connectMongo();
    if (!ok) return null;
  }
  try {
    const users = await getModel('User','users').find().lean() as any[];
    if (!users || users.length === 0) return null;
    const messages = await getModel('Message','messages').find().lean() as any[];
    const posts = await getModel('Post','posts').find().lean() as any[];
    const stories = await getModel('Story','stories').find().lean() as any[];
    const notifications = await getModel('Notification','notifications').find().lean() as any[];
    const pages = await getModel('Page','pages').find().lean() as any[];
    const groups = await getModel('Group','groups').find().lean() as any[];
    const events = await getModel('Event','events').find().lean() as any[];
    return { users, posts, messages, stories, notifications, passwordResetTokens: [], pages, groups, events };
  } catch { return null; }
}
const AnySchema = new mongoose.Schema({}, { strict: false, _id: false });
const getModel = (name: string, col: string) => {
  return mongoose.models[name] || mongoose.model(name, AnySchema, col);
};
async function connectMongo() {
  if (!MONGO_URI) { console.log('[DB] No MONGO_URI - using JSON fallback'); return false; }
  if (mongoReady) return true;
  try {
    await mongoose.connect(MONGO_URI);
    mongoReady = true;
    console.log('[DB] MongoDB Connected ✅ - Messages are now PERMANENT!');
    return true;
  } catch (e) {
    console.error('[DB] Mongo connect failed', e);
    return false;
  }
}
connectMongo();

async function saveToMongo(data: any) {
  if (!mongoReady) return;
  try {
    const UserModel = getModel('User', 'users');
    await UserModel.deleteMany({});
    if(data.users?.length) await UserModel.insertMany(data.users);
    const MessageModel = getModel('Message', 'messages');
    await MessageModel.deleteMany({});
    if(data.messages?.length) await MessageModel.insertMany(data.messages);
    const PostModel = getModel('Post', 'posts');
    await PostModel.deleteMany({});
    if(data.posts?.length) await PostModel.insertMany(data.posts);
    console.log(`[DB] Saved to MongoDB: ${data.users.length} users, ${data.messages.length} msgs`);
  } catch (e) {
    console.error('[DB] Mongo save error', e);
  }
}

async function loadFromMongo(): Promise<any> {
  if (!mongoReady) {
    const ok = await connectMongo();
    if (!ok) return null;
  }
  try {
    const users = await getModel('User','users').find().lean() as any[];
    if (!users || users.length === 0) return null;
    const messages = await getModel('Message','messages').find().lean() as any[];
    const posts = await getModel('Post','posts').find().lean() as any[];
    const stories = await getModel('Story','stories').find().lean() as any[];
    const notifications = await getModel('Notification','notifications').find().lean() as any[];
    const pages = await getModel('Page','pages').find().lean() as any[];
    const groups = await getModel('Group','groups').find().lean() as any[];
    const events = await getModel('Event','events').find().lean() as any[];
    console.log(`[DB] Loaded FROM MONGODB: ${users.length} users, ${messages.length} msgs`);
    return { users, posts, messages, stories, notifications, passwordResetTokens: [], pages, groups, events };
  } catch (e) {
    console.error('[DB] Mongo load error', e);
    return null;
  }
}

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
}

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + '_echat_salt_2026').digest('hex');
}

const SEED_USERS: User[] = [
  {
    id: 'user_admin_elder',
    name: 'Elder Moses',
    email: 'eldermoses89@gmail.com',
    dob: '1997-06-12',
    passwordHash: hashPassword('admin123'),
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
    coverPhoto: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1400&q=80',
    bio: 'Founder & Super Admin at Echat.',
    location: 'Sierra Leone, SL',
    work: 'Lead Architect @ Echat Network',
    education: 'Computer Science',
    role: 'developer',
    isVerified: true,
    isOfficialDeveloper: true,
    boostsCount: 420,
    boostedBy: [],
    isBlocked: false,
    isOnline: true,
    lastSeen: Date.now(),
    createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    friends: [],
    friendRequestsSent: [],
    friendRequestsReceived: []
  }
];

const SEED_PAGES: Page[] = [
  {
    id: 'page_tech_hub',
    name: 'Tech & Code Community',
    category: 'Technology & Gaming',
    bio: 'Official Echat Developer & Tech enthusiast community. Coding, architecture, and innovation.',
    cover: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
    avatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80',
    ownerId: 'user_admin_elder',
    ownerName: 'Elder Moses',
    followers: ['user_admin_elder'],
    likes: ['user_admin_elder'],
    posts: [
      {
        id: 'ppost_1',
        pageId: 'page_tech_hub',
        authorId: 'user_admin_elder',
        content: 'Welcome to the Tech & Code page! We are excited to build high-performance WebRTC and real-time social tools.',
        mediaUrl: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=1200&q=80',
        mediaType: 'image',
        createdAt: Date.now() - 3600000,
        likes: ['user_admin_elder'],
        comments: []
      }
    ],
    createdAt: Date.now() - 86400000
  },
  {
    id: 'page_echat_hq',
    name: 'Echat Official',
    category: 'Social Network',
    bio: 'Official news, release updates, and announcements from the Echat platform team.',
    cover: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?auto=format&fit=crop&w=1200&q=80',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
    ownerId: 'user_admin_elder',
    ownerName: 'Elder Moses',
    followers: ['user_admin_elder'],
    likes: ['user_admin_elder'],
    posts: [
      {
        id: 'ppost_2',
        pageId: 'page_echat_hq',
        authorId: 'user_admin_elder',
        content: '🎉 Echat upgrade deployed: Pages, Groups, Events, and full Settings & Privacy are now live!',
        mediaUrl: '',
        createdAt: Date.now() - 1800000,
        likes: ['user_admin_elder'],
        comments: []
      }
    ],
    createdAt: Date.now() - 172800000
  }
];

const SEED_GROUPS: Group[] = [
  {
    id: 'group_react_devs',
    name: 'React & Modern Web Masters',
    privacy: 'public',
    description: 'A global community sharing tips, performance tricks, UI patterns, and Vite/React architecture.',
    cover: 'https://images.unsplash.com/photo-1633356122544-f134324a6cee?auto=format&fit=crop&w=1200&q=80',
    avatar: 'https://images.unsplash.com/photo-1633356122544-f134324a6cee?auto=format&fit=crop&w=400&q=80',
    ownerId: 'user_admin_elder',
    ownerName: 'Elder Moses',
    members: ['user_admin_elder'],
    posts: [
      {
        id: 'gpost_1',
        groupId: 'group_react_devs',
        authorId: 'user_admin_elder',
        authorName: 'Elder Moses',
        authorAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
        content: 'What are your favorite practices for low-latency WebRTC and state synchronization in React 18+?',
        status: 'approved',
        likes: ['user_admin_elder'],
        comments: [],
        createdAt: Date.now() - 7200000
      }
    ],
    createdAt: Date.now() - 86400000 * 2
  },
  {
    id: 'group_creators',
    name: 'Global Creators & Innovators',
    privacy: 'public',
    description: 'Connect with artists, video editors, music makers, and digital creators on Echat.',
    cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1200&q=80',
    avatar: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=400&q=80',
    ownerId: 'user_admin_elder',
    ownerName: 'Elder Moses',
    members: ['user_admin_elder'],
    posts: [],
    createdAt: Date.now() - 86400000 * 3
  }
];

const SEED_EVENTS: EventItem[] = [
  {
    id: 'event_hackathon_2026',
    title: 'Echat Global Hackathon 2026',
    date: '2026-11-15T18:00:00.000Z',
    location: 'Virtual Live Stream & Freetown Tech Center',
    cover: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1200&q=80',
    description: 'Join developers, designers, and entrepreneurs from around the globe to build next-generation social apps.',
    ownerId: 'user_admin_elder',
    ownerName: 'Elder Moses',
    going: ['user_admin_elder'],
    interested: [],
    createdAt: Date.now() - 86400000
  },
  {
    id: 'event_founder_talk',
    title: 'Founder Live Q&A: The Future of Echat',
    date: '2026-11-20T17:00:00.000Z',
    location: 'Echat Video Auditorium',
    cover: 'https://images.unsplash.com/photo-1475721027785-f74eccf877e2?auto=format&fit=crop&w=1200&q=80',
    description: 'Elder Moses answers questions about upcoming features, WebRTC audio/video quality, and developer tooling.',
    ownerId: 'user_admin_elder',
    ownerName: 'Elder Moses',
    going: ['user_admin_elder'],
    interested: [],
    createdAt: Date.now() - 43200000
  }
];

class Database {
  private data: DatabaseSchema;
  private startTime = Date.now();
  private currentDbPath: string;

  constructor() {
    const loaded = this.load();
    this.data = loaded.data;
    this.currentDbPath = loaded.path;
    console.log(`[DB] Loaded ${this.data.users.length} users, ${this.data.pages?.length || 0} pages, ${this.data.groups?.length || 0} groups, ${this.data.events?.length || 0} events from ${this.currentDbPath}`);
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
          // MERGE: Keep all existing users, just ensure Elder Moses exists
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
              pages: (Array.isArray(parsed.pages) && parsed.pages.length > 0) ? parsed.pages : SEED_PAGES,
              groups: (Array.isArray(parsed.groups) && parsed.groups.length > 0) ? parsed.groups : SEED_GROUPS,
              events: (Array.isArray(parsed.events) && parsed.events.length > 0) ? parsed.events : SEED_EVENTS
            },
            path: found.path
          };
        }
      }
    } catch (e) {
      console.warn('[DB] Could not read existing database, will create new:', e);
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
      pages: SEED_PAGES,
      groups: SEED_GROUPS,
      events: SEED_EVENTS
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
        fs.writeFileSync(file, JSON.stringify(dataToSave, null, 2), 'utf-8');
      } catch (e) {
        // ignore write errors for secondary locations
      }
    }
  }

  private save(dataToSave?: DatabaseSchema) {
    const toWrite = dataToSave || this.data;
    this.saveToAll(toWrite);
  }

  // --- Add backup export for you ---
  exportBackup(): DatabaseSchema {
    return this.data;
  }

  importBackup(json: DatabaseSchema): boolean {
    if (!json || !Array.isArray(json.users) || json.users.length === 0) return false;
    this.data = json;
    this.save();
    console.log(`[DB] Restored backup with ${json.users.length} users`);
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
    const isDev = user.email.toLowerCase().trim() === 'eldermoses89@gmail.com';
    const newUser: User = {
      id: user.id || ('user_' + crypto.randomBytes(6).toString('hex')),
      name: user.name,
      email: user.email.toLowerCase().trim(),
      dob: user.dob,
      passwordHash: hashPassword(user.password || ''),
      avatar: user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user.name)}`,
      coverPhoto: user.coverPhoto || 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?auto=format&fit=crop&w=1200&q=80',
      bio: user.bio || 'Hello, I am on Echat!',
      location: user.location || 'Earth',
      work: user.work || '',
      education: user.education || '',
      role: isDev ? 'developer' : (user.role || 'user'),
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

  sanitizeUser(user: User): Omit<User, 'passwordHash'> {
    const { passwordHash, ...safe } = user;
    return safe;
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

  getPosts(viewerId?: string): Post[] {
    return this.data.posts
      .filter(p => !p.isReported || (viewerId && this.getUserById(viewerId)?.role === 'developer'))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getPostById(id: string): Post | undefined {
    return this.data.posts.find(p => p.id === id);
  }

  createPost(
    authorId: string,
    content: string,
    mediaUrl?: string,
    mediaType?: 'image' | 'video',
    feeling?: string,
    privacy: 'public' | 'friends' = 'public'
  ): Post {
    const newPost: Post = {
      id: 'post_' + crypto.randomBytes(6).toString('hex'),
      authorId,
      content,
      mediaUrl,
      mediaType,
      feeling,
      privacy,
      reactions: [],
      comments: [],
      sharesCount: 0,
      viewsCount: 0,
      views: [],
      isReported: false,
      createdAt: Date.now()
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

  getConversation(userA: string, userB: string): Message[] {
    return this.data.messages
      .filter(m =>
        (m.senderId === userA && m.receiverId === userB) ||
        (m.senderId === userB && m.receiverId === userA)
      )
      .sort((a, b) => a.createdAt - b.createdAt);
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
      status: msg.status || 'sent',
      createdAt: Date.now()
    };
    this.data.messages.push(newMsg);
    this.save();
    return newMsg;
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

  markNotificationsRead(userId: string): void {
    let changed = false;
    for (const notif of this.data.notifications) {
      if (notif.userId === userId && !notif.read) {
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
      cover: data.cover || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80',
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