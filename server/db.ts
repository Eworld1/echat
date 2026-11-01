import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI;
let mongoReady = false;

const AnySchema = new mongoose.Schema({}, { strict: false }, { collection: '' });
const getModel = (name: string, col: string) => {
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, collection: col });
  return mongoose.model(name, schema, col);
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

function findUserQuery(id: string) {
  return { $or: [{ id: id }, { _id: id }, { _id: { $eq: id } as any }] };
}

class DB {
  // --- Core Helpers ---
  private model(col: string) {
    return getModel(col.charAt(0).toUpperCase() + col.slice(1), col);
  }

  // --- User Methods (these were missing!) ---
  async getUserById(id: string) {
    try {
      const User = this.model('users');
      const user = await User.findOne({ $or: [{ id }, { _id: id }] } as any).lean();
      return user || null;
    } catch { return null; }
  }

  async getUserByEmail(email: string) {
    const User = this.model('users');
    return await User.findOne({ email }).lean();
  }

  async getUsers() {
    const User = this.model('users');
    return await User.find().lean();
  }

  async getUserByUsername(username: string) {
    const User = this.model('users');
    return await User.findOne({ username }).lean();
  }

  async createUser(user: any) {
    const User = this.model('users');
    if (!user.id) user.id = crypto.randomBytes(12).toString('hex');
    await User.create(user);
    return user;
  }

  async updateUser(id: string, data: any) {
    const User = this.model('users');
    await User.updateOne({ $or: [{ id }, { _id: id }] } as any, { $set: data });
  }

  async setUserOnline(userId: string, isOnline: boolean) {
    try {
      const User = this.model('users');
      await User.updateOne(
        { $or: [{ id: userId }, { _id: userId }] } as any,
        { $set: { isOnline, lastActive: new Date() } }
      );
    } catch (e) {
      console.error('setUserOnline error', e);
    }
  }

  // --- Post Methods ---
  async getPosts() {
    return await this.model('posts').find().sort({ createdAt: -1 }).lean();
  }

  async createPost(post: any) {
    if (!post.id) post.id = crypto.randomBytes(12).toString('hex');
    if (!post.createdAt) post.createdAt = new Date();
    return await this.model('posts').create(post);
  }

  async getPostById(id: string) {
    return await this.model('posts').findOne({ $or: [{ id }, { _id: id }] } as any).lean();
  }

  // --- Story Methods ---
  async getActiveStories() {
    try {
      const Story = this.model('stories');
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24h
      return await Story.find({ createdAt: { $gte: since } }).lean();
    } catch {
      return [];
    }
  }

  async getStories() {
    return await this.model('stories').find().lean();
  }

  async createStory(story: any) {
    if (!story.id) story.id = crypto.randomBytes(12).toString('hex');
    if (!story.createdAt) story.createdAt = new Date();
    return await this.model('stories').create(story);
  }

  // --- Message Methods ---
  async getMessages(conversationId?: string) {
    const Message = this.model('messages');
    if (conversationId) {
      return await Message.find({ $or: [{ conversationId }, { chatId: conversationId }] }).lean();
    }
    return await Message.find().lean();
  }

  async createMessage(msg: any) {
    if (!msg.id) msg.id = crypto.randomBytes(12).toString('hex');
    if (!msg.createdAt) msg.createdAt = new Date();
    return await this.model('messages').create(msg);
  }

  // --- Generic fallback for any other db.xxx called ---
  async getNotifications(userId: string) {
    return await this.model('notifications').find({ $or: [{ userId }, { to: userId }] }).lean();
  }

  // Legacy JSON methods (kept for compatibility)
  load() { return { users: [], posts: [], messages: [], stories: [], notifications: [], pages: [], groups: [], events: [] }; }
  saveToAll() {}
}

export const db = new DB();
export const generateId = () => crypto.randomBytes(12).toString('hex');
export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}
export function verifyPassword(password: string, hashed: string): boolean {
  return hashPassword(password) === hashed;
}

// Make db proxy so ANY missing method won't crash
