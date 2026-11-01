import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { User, Post, Story, Message, Notification, Comment, ReactionType, AdminStats, Page, PagePost, Group, GroupPost, EventItem } from './types.js';

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + '_echat_salt_2026').digest('hex');
}

// --- MONGO SETUP ---
const MONGO_URI = process.env.MONGO_URI;
const FlexibleSchema = new mongoose.Schema({}, { strict: false, collection: undefined });
const UserModel = mongoose.models.User || mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');
const PostModel = mongoose.models.Post || mongoose.model('Post', new mongoose.Schema({}, { strict: false }), 'posts');
const StoryModel = mongoose.models.Story || mongoose.model('Story', new mongoose.Schema({}, { strict: false }), 'stories');
const MessageModel = mongoose.models.Message || mongoose.model('Message', new mongoose.Schema({}, { strict: false }), 'messages');
const NotificationModel = mongoose.models.Notification || mongoose.model('Notification', new mongoose.Schema({}, { strict: false }), 'notifications');
const PageModel = mongoose.models.Page || mongoose.model('Page', new mongoose.Schema({}, { strict: false }), 'pages');
const GroupModel = mongoose.models.Group || mongoose.model('Group', new mongoose.Schema({}, { strict: false }), 'groups');
const EventModel = mongoose.models.Event || mongoose.model('Event', new mongoose.Schema({}, { strict: false }), 'events');

let isMongoConnected = false;

export async function connectDB() {
  if (!MONGO_URI) {
    console.log('[DB] No MONGO_URI - using JSON fallback (messages will be lost on restart!)');
    return false;
  }
  if (isMongoConnected) return true;
  try {
    await mongoose.connect(MONGO_URI);
    isMongoConnected = true;
    console.log('[DB] MongoDB Connected ✅ - Messages are now PERMANENT!');
    return true;
  } catch (e) {
    console.error('[DB] MongoDB connect failed:', e);
    return false;
  }
}

// --- OLD JSON FALLBACK (only if Mongo not set) ---
const POSSIBLE_DATA_DIRS = [
  path.resolve(process.cwd(), 'data'),
  path.resolve('/tmp', 'echat_data'),
  path.resolve(process.cwd(), '..', 'data'),
];
const DB_FILENAME = 'echat_db.json';

function getDataDir() {
  for (const dir of POSSIBLE_DATA_DIRS) {
    try { fs.mkdirSync(dir, { recursive: true }); return dir; } catch {}
  }
  return POSSIBLE_DATA_DIRS[0];
}

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

export let dbCache: DatabaseSchema | null = null;

export async function loadDatabase(): Promise<DatabaseSchema> {
  const mongoOk = await connectDB();
  if (mongoOk) {
    const [users, posts, stories, messages, notifications, pages, groups, events] = await Promise.all([
      UserModel.find().lean(),
      PostModel.find().lean(),
      StoryModel.find().lean(),
      MessageModel.find().lean(),
      NotificationModel.find().lean(),
      PageModel.find().lean(),
      GroupModel.find().lean(),
      EventModel.find().lean(),
    ]);
    const data: DatabaseSchema = {
      users: users as any,
      posts: posts as any,
      stories: stories as any,
      messages: messages as any,
      notifications: notifications as any,
      passwordResetTokens: [],
      pages: pages as any,
      groups: groups as any,
      events: events as any,
    };
    dbCache = data;
    console.log(`[DB] Loaded FROM MONGODB: ${users.length} users, ${messages.length} messages, ${posts.length} posts`);
    return data;
  }
  // JSON fallback
  try {
    const dir = getDataDir();
    const file = path.join(dir, DB_FILENAME);
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf-8');
      const data = JSON.parse(raw) as DatabaseSchema;
      dbCache = data;
      console.log(`[DB] Loaded FROM JSON: ${data.messages.length} messages (TEMPORARY!)`);
      return data;
    }
  } catch {}
  const empty: DatabaseSchema = { users: [], posts: [], stories: [], messages: [], notifications: [], passwordResetTokens: [], pages: [], groups: [], events: [] };
  dbCache = empty;
  return empty;
}

export async function saveDatabase(data: DatabaseSchema) {
  if (isMongoConnected) {
    // In Mongo mode, we save individually in routes, so skip bulk save
    return;
  }
  try {
    const dir = getDataDir();
    const file = path.join(dir, DB_FILENAME);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch {}
}

// For saving single docs to Mongo
export const DbModels = { UserModel, PostModel, StoryModel, MessageModel, NotificationModel, PageModel, GroupModel, EventModel };