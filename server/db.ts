import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { User, Post, Story, Message, Notification, Page, Group, EventItem } from './types.js';

export function hashPassword(p: string){ return crypto.createHash('sha256').update(p+'_echat_salt_2026').digest('hex'); }

const MONGO_URI = process.env.MONGO_URI;
let isMongo = false;

export async function connectDB(){
  if(!MONGO_URI){ console.log('[DB] No MONGO_URI found'); return false; }
  if(isMongo) return true;
  try{
    await mongoose.connect(MONGO_URI);
    isMongo = true;
    console.log('[DB] MongoDB Connected ✅ - Messages are now PERMANENT!');
    return true;
  }catch(e){ console.error('[DB] Mongo connect fail', e); return false; }
}

const UserModel = mongoose.models.User || mongoose.model('User', new mongoose.Schema({}, {strict:false}), 'users');
const PostModel = mongoose.models.Post || mongoose.model('Post', new mongoose.Schema({}, {strict:false}), 'posts');
const StoryModel = mongoose.models.Story || mongoose.model('Story', new mongoose.Schema({}, {strict:false}), 'stories');
const MessageModel = mongoose.models.Message || mongoose.model('Message', new mongoose.Schema({}, {strict:false}), 'messages');
const NotificationModel = mongoose.models.Notification || mongoose.model('Notification', new mongoose.Schema({}, {strict:false}), 'notifications');
const PageModel = mongoose.models.Page || mongoose.model('Page', new mongoose.Schema({}, {strict:false}), 'pages');
const GroupModel = mongoose.models.Group || mongoose.model('Group', new mongoose.Schema({}, {strict:false}), 'groups');
const EventModel = mongoose.models.Event || mongoose.model('Event', new mongoose.Schema({}, {strict:false}), 'events');

const POSSIBLE_DATA_DIRS = [path.resolve(process.cwd(),'data'), path.resolve('/tmp','echat_data'), path.resolve(process.cwd(),'..','data')];
const DB_FILENAME = 'echat_db.json';
function getDataDir(){ for(const d of POSSIBLE_DATA_DIRS){ try{ fs.mkdirSync(d,{recursive:true}); return d; }catch{} } return POSSIBLE_DATA_DIRS[0]; }

export interface DatabaseSchema { users: User[]; posts: Post[]; stories: Story[]; messages: Message[]; notifications: Notification[]; passwordResetTokens: any[]; pages: Page[]; groups: Group[]; events: EventItem[]; }

export async function loadDatabase(): Promise<DatabaseSchema>{
  const ok = await connectDB();
  if(ok){
    const [users, posts, stories, messages, notifications, pages, groups, events] = await Promise.all([UserModel.find().lean(), PostModel.find().lean(), StoryModel.find().lean(), MessageModel.find().lean(), NotificationModel.find().lean(), PageModel.find().lean(), GroupModel.find().lean(), EventModel.find().lean()]);
    console.log(`[DB] Loaded FROM MONGODB: ${users.length} users, ${messages.length} messages`);
    return { users: users as any, posts: posts as any, stories: stories as any, messages: messages as any, notifications: notifications as any, passwordResetTokens: [], pages: pages as any, groups: groups as any, events: events as any };
  }
  try{
    const file = path.join(getDataDir(), DB_FILENAME);
    if(fs.existsSync(file)){ const data = JSON.parse(fs.readFileSync(file,'utf-8')); console.log(`[DB] Loaded FROM JSON TEMP: ${data.messages?.length} messages`); return data; }
  }catch{}
  return { users:[], posts:[], stories:[], messages:[], notifications:[], passwordResetTokens:[], pages:[], groups:[], events:[] };
}

export async function saveDatabase(data: DatabaseSchema){
  if(isMongo) return;
  try{ fs.writeFileSync(path.join(getDataDir(), DB_FILENAME), JSON.stringify(data,null,2)); }catch{}
}

export const DbModels = { UserModel, PostModel, StoryModel, MessageModel, NotificationModel, PageModel, GroupModel, EventModel };