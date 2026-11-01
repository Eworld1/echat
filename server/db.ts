import crypto from 'crypto';
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI;
let mongoReady = false;

const getModel = (name: string, col: string) => {
  if ((mongoose.models as any)[name]) return (mongoose.models as any)[name];
  const schema = new mongoose.Schema({}, { strict: false, collection: col }, { timestamps: false });
  return mongoose.model(name, schema, col);
};

async function connectMongo() {
  if (!MONGO_URI) return false;
  if (mongoReady) return true;
  try {
    await mongoose.connect(MONGO_URI);
    mongoReady = true;
    console.log('[DB] MongoDB Connected ✅');
    return true;
  } catch (e) {
    console.error('[DB] Connect failed', e);
    return false;
  }
}
connectMongo();

class DBClass {
  private m(col: string) { return getModel(col.charAt(0).toUpperCase() + col.slice(1), col); }

  // USERS
  async getUserById(id: string) {
    try { return await this.m('users').findOne({ $or: [{ id }, { _id: id }, { userId: id }] } as any).lean(); }
    catch { return null; }
  }
  async getUserByUsername(u: string) { return await this.m('users').findOne({ username: u }).lean(); }
  async getUserByEmail(e: string) { return await this.m('users').findOne({ email: e }).lean(); }
  async getUsers() { return await this.m('users').find().lean(); }
  async setUserOnline(userId: string, isOnline: boolean) {
    try { await this.m('users').updateOne({ $or: [{ id: userId }, { _id: userId }] } as any, { $set: { isOnline, lastActive: new Date() } }); } catch {}
  }

  // POSTS - THE IMPORTANT PART
  async getPosts() { return await this.m('posts').find().sort({ _id: -1 }).lean(); }
  async createPost(data: any) {
    console.log('[DB] Creating post:', data);
    const col = this.m('posts');
    const toSave = { ...data, _id: data.id || data._id || crypto.randomBytes(12).toString('hex'), createdAt: new Date(), id: data.id || crypto.randomBytes(12).toString('hex') };
    const res = await col.create(toSave);
    return res.toObject();
  }
  async addPost(data: any) { return this.createPost(data); }
  async savePost(data: any) { return this.createPost(data); }

  // STORIES
  async getActiveStories() {
    try {
      const since = new Date(Date.now() - 24*60*60*1000);
      return await this.m('stories').find({ createdAt: { $gte: since } }).lean();
    } catch { return []; }
  }
  async createStory(data: any) { return await this.m('stories').create({ ...data, createdAt: new Date() }); }

  // MESSAGES
  async getMessages() { return await this.m('messages').find().sort({ _id: -1 }).lean(); }
  async createMessage(data: any) { return await this.m('messages').create({ ...data, createdAt: new Date() }); }

  // GENERIC FALLBACKS
  async getNotifications(userId: string) { return await this.m('notifications').find({ $or: [{ toUserId: userId }, { userId }] }).lean(); }
}

const dbInstance = new DBClass();

export const db: any = new Proxy(dbInstance, {
  get(target, prop: any) {
    const p = String(prop);
    if (p in target) return (target as any)[p];
    
    // SMART FALLBACK - guesses what you want
    return async (...args: any[]) => {
      console.log(`[DB] Fallback called: db.${p}`, args[0]);
      try {
        if (p.toLowerCase().includes('post')) {
          if (p.toLowerCase().startsWith('get')) return await (target as any).getPosts();
          if (p.toLowerCase().startsWith('create') || p.toLowerCase().startsWith('add')) return await (target as any).createPost(args[0]);
        }
        if (p.toLowerCase().includes('user')) {
          if (p.toLowerCase().startsWith('get')) return await (target as any).getUsers();
        }
        if (p.toLowerCase().includes('message')) {
           if (p.toLowerCase().startsWith('get')) return await (target as any).getMessages();
           return await (target as any).createMessage(args[0]);
        }
      } catch(e) { console.error('Proxy fallback error', e); }
      return [];
    };
  }
});

export const generateId = () => crypto.randomBytes(12).toString('hex');
export const hashPassword = (p: string) => crypto.createHash('sha256').update(p).digest('hex');
export const verifyPassword = (p: string, h: string) => hashPassword(p) === h;
