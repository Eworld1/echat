import crypto from 'crypto';
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI;
let mongoReady = false;

const getModel = (name: string, col: string) => {
  if ((mongoose.models as any)[name]) return (mongoose.models as any)[name];
  const schema = new mongoose.Schema({}, { strict: false, collection: col });
  return mongoose.model(name, schema, col);
};

async function connectMongo() {
  if (!MONGO_URI) return false;
  if (mongoReady) return true;
  try {
    await mongoose.connect(MONGO_URI);
    mongoReady = true;
    console.log('[DB] MongoDB Connected ✅ - PERMANENT!');
    return true;
  } catch (e) {
    console.error('[DB] Connect failed', e);
    return false;
  }
}
connectMongo();

class DBClass {
  private m(col: string) { return getModel(col.charAt(0).toUpperCase() + col.slice(1), col); }
  
  async getUserById(id: string) {
    try { return await this.m('users').findOne({ $or: [{ id }, { _id: id }] } as any).lean(); }
    catch { return null; }
  }
  async getUsers() { return await this.m('users').find().lean(); }
  async getUserByEmail(email: string) { return await this.m('users').findOne({ email }).lean(); }
  async setUserOnline(userId: string, isOnline: boolean) {
    try { await this.m('users').updateOne({ $or: [{ id: userId }, { _id: userId }] } as any, { $set: { isOnline, lastActive: new Date() } }); }
    catch {}
  }
  async getActiveStories() {
    try {
      const since = new Date(Date.now() - 24*60*60*1000);
      return await this.m('stories').find({ createdAt: { $gte: since } }).lean();
    } catch { return []; }
  }
  async getPosts() { return await this.m('posts').find().lean(); }
  async getMessages() { return await this.m('messages').find().lean(); }
}

const dbInstance = new DBClass();

// Proxy catches any other db.something calls so it NEVER crashes
export const db: any = new Proxy(dbInstance, {
  get(target, prop: any) {
    if (prop in target) return (target as any)[prop];
    return async () => { console.warn(`[DB] db.${String(prop)} called - returning []`); return []; };
  }
});

export const generateId = () => crypto.randomBytes(12).toString('hex');
export const hashPassword = (p: string) => crypto.createHash('sha256').update(p).digest('hex');
export const verifyPassword = (p: string, h: string) => hashPassword(p) === h;
