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
    const StoryModel = getModel('Story', 'stories');
    await StoryModel.deleteMany({});
    if(data.stories?.length) await StoryModel.insertMany(data.stories);
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
    console.log(`[DB] Loaded FROM MONGODB: ${users.length} users`);
    return { users, posts, messages, stories, notifications, passwordResetTokens: [], pages, groups, events };
  } catch (e) {
    console.error('[DB] Mongo load error', e);
    return null;
  }
}

const POSSIBLE_DATA_DIRS = [
  path.join(process.cwd(), 'data'),
  path.join(process.cwd(), 'src', 'server', 'data'),
  path.join(process.cwd(), '..', 'data'),
  '/tmp/data'
];

function getDataDir() {
  for (const dir of POSSIBLE_DATA_DIRS) {
    if (fs.existsSync(dir)) return dir;
  }
  const dir = POSSIBLE_DATA_DIRS[0];
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(fileName: string, fallback: any) {
  try {
    const filePath = path.join(getDataDir(), fileName);
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { return fallback; }
}

function writeJson(fileName: string, data: any) {
  try {
    const dir = getDataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fileName), JSON.stringify(data, null, 2));
  } catch (e) { console.error('Write failed', e); }
}

class DB {
  load() {
    const mongoData = loadFromMongo();
    // Note: loadFromMongo is async, but we try sync fallback first then async will load on startup
    // For simplicity, we will let connectMongo load async and overwrite memory
    // This sync part loads JSON as fallback
    const data = {
      users: readJson('users.json', []),
      posts: readJson('posts.json', []),
      messages: readJson('messages.json', []),
      stories: readJson('stories.json', []),
      notifications: readJson('notifications.json', []),
      passwordResetTokens: readJson('tokens.json', []),
      pages: readJson('pages.json', []),
      groups: readJson('groups.json', []),
      events: readJson('events.json', [])
    };
    // Async mongo load will happen in background and update if found
    loadFromMongo().then(mongo => {
      if (mongo) {
        Object.assign(data, mongo);
        console.log('[DB] Overwrote with MongoDB data');
      }
    });
    return data;
  }

  saveToAll(data: any) {
    writeJson('users.json', data.users);
    writeJson('posts.json', data.posts);
    writeJson('messages.json', data.messages);
    writeJson('stories.json', data.stories);
    writeJson('notifications.json', data.notifications);
    writeJson('tokens.json', data.passwordResetTokens || []);
    writeJson('pages.json', data.pages || []);
    writeJson('groups.json', data.groups || []);
    writeJson('events.json', data.events || []);
    saveToMongo(data).catch(()=>{});
  }
}

export const db = new DB();
export const generateId = () => crypto.randomBytes(12).toString('hex');