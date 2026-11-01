import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';

export function hashPassword(p: string){ 
  return crypto.createHash('sha256').update(p+'_echat_salt_2026').digest('hex'); 
}

const MONGO_URI = process.env.MONGO_URI;
let isMongo = false;

export async function connectDB(){
  if(!MONGO_URI){ console.log('[DB] No MONGO_URI'); return false; }
  if(isMongo) return true;
  try{
    await mongoose.connect(MONGO_URI);
    isMongo = true;
    console.log('[DB] MongoDB Connected ✅');
    return true;
  }catch(e){ 
    console.error('[DB] Mongo fail', e); 
    return false; 
  }
}

// Models - flexible schema so it accepts any fields
const AnySchema = new mongoose.Schema({}, {strict:false});
const UserModel = mongoose.models.User || mongoose.model('User', AnySchema, 'users');
const PostModel = mongoose.models.Post || mongoose.model('Post', AnySchema, 'posts');
const MessageModel = mongoose.models.Message || mongoose.model('Message', AnySchema, 'messages');
const StoryModel = mongoose.models.Story || mongoose.model('Story', AnySchema, 'stories');
const NotificationModel = mongoose.models.Notification || mongoose.model('Notification', AnySchema, 'notifications');
const PageModel = mongoose.models.Page || mongoose.model('Page', AnySchema, 'pages');
const GroupModel = mongoose.models.Group || mongoose.model('Group', AnySchema, 'groups');
const EventModel = mongoose.models.Event || mongoose.model('Event', AnySchema, 'events');

// Keep old JSON logic as fallback
const DB_FILE = path.join(process.cwd(), 'data', 'echat_db.json');
function ensureDir(){ try{ fs.mkdirSync(path.dirname(DB_FILE), {recursive:true}); }catch{} }

export async function loadDatabase(): Promise<any>{
  const ok = await connectDB();
  if(ok){
    try{
      const [users, posts, messages, stories, notifications, pages, groups, events] = await Promise.all([
        UserModel.find().lean(), PostModel.find().lean(), MessageModel.find().lean(),
        StoryModel.find().lean(), NotificationModel.find().lean(), PageModel.find().lean(),
        GroupModel.find().lean(), EventModel.find().lean()
      ]);
      console.log(`[DB] FROM MONGODB: ${users.length} users, ${messages.length} msgs`);
      return { users, posts, messages, stories, notifications, pages, groups, events, passwordResetTokens: [] };
    }catch(e){ console.error('[DB] Mongo load error', e); }
  }
  ensureDir();
  if(fs.existsSync(DB_FILE)){
    try{ 
      const data = JSON.parse(fs.readFileSync(DB_FILE,'utf-8'));
      console.log(`[DB] FROM JSON: ${data.messages?.length||0} msgs`);
      return data;
    }catch{}
  }
  return { users:[], posts:[], messages:[], stories:[], notifications:[], passwordResetTokens:[], pages:[], groups:[], events:[] };
}

export async function saveDatabase(data:any){
  if(isMongo){
    // In Mongo mode, saving is done directly in routes, skip file save
    try{
      if(data.users?.length) await UserModel.deleteMany({}).then(()=>UserModel.insertMany(data.users)).catch(()=>{});
      if(data.messages?.length) await MessageModel.deleteMany({}).then(()=>MessageModel.insertMany(data.messages)).catch(()=>{});
    }catch{}
    return;
  }
  ensureDir();
  try{ fs.writeFileSync(DB_FILE, JSON.stringify(data,null,2)); }catch{}
}

export const DbModels = { UserModel, PostModel, MessageModel, StoryModel, NotificationModel, PageModel, GroupModel, EventModel };