import { apiUrl } from './apiBase';
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  limit,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { auth, db } from './firebase';
import type { 
  User, 
  Post, 
  Story, 
  Message, 
  Notification, 
  ReactionType, 
  Reaction,
  Comment,
  AdminStats 
} from '../types';

export const ADMIN_EMAIL = 'eldermoses89@gmail.com';

export function hashPassword(password: string): string {
  return 'hashed_' + btoa(password || '');
}

// ----------------- USERS -----------------

export async function getUserByEmail(email: string): Promise<User | null> {
  const cleanEmail = email.toLowerCase().trim();
  try {
    const q = query(collection(db, 'users'), where('email', '==', cleanEmail), limit(1));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
      return querySnapshot.docs[0].data() as User;
    }
  } catch (error: any) {
    if (!error?.message?.includes('offline') && error?.code !== 'unavailable') {
      console.warn('getUserByEmail Firestore notice:', error?.message || error);
    }
  }

  // Fallback to server API
  try {
    const res = await fetch(apiUrl('/api/users'));
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) {
        const found = list.find((u: any) => u.email?.toLowerCase().trim() === cleanEmail);
        if (found) return found;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

export async function getUserById(id: string): Promise<User | null> {
  if (!id) return null;
  try {
    const docRef = doc(db, 'users', id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data() as User;
    }
  } catch (error: any) {
    if (!error?.message?.includes('offline') && error?.code !== 'unavailable') {
      console.warn('getUserById Firestore notice:', error?.message || error);
    }
  }

  // Graceful fallback to server API if Firestore is offline
  try {
    const res = await fetch(apiUrl(`/api/users/${encodeURIComponent(id)}`));
    if (res.ok) {
      const data = await res.json();
      if (data?.user) return data.user as User;
    }
  } catch {
    // ignore
  }

  return null;
}

export async function getAllUsers(): Promise<User[]> {
  try {
    const querySnapshot = await getDocs(collection(db, 'users'));
    if (!querySnapshot.empty) {
      const users: User[] = [];
      querySnapshot.forEach((doc) => {
        users.push(doc.data() as User);
      });
      return users;
    }
  } catch (error: any) {
    if (!error?.message?.includes('offline') && error?.code !== 'unavailable') {
      console.warn('getAllUsers Firestore notice:', error?.message || error);
    }
  }

  // Graceful fallback to server API
  try {
    const res = await fetch(apiUrl('/api/users'));
    if (res.ok) {
      const users = await res.json();
      if (Array.isArray(users)) return users;
    }
  } catch {
    // ignore
  }

  return [];
}

export async function createUser(data: {
  name: string;
  email: string;
  password?: string;
  dob: string;
  avatar?: string;
  coverPhoto?: string;
  bio?: string;
  location?: string;
  work?: string;
  education?: string;
  termsAccepted?: boolean;
}): Promise<User> {
  const cleanEmail = data.email.toLowerCase().trim();
  const password = data.password || 'ChangeMe123!';

  // 1. FIRST call createUserWithEmailAndPassword in Firebase Auth
  const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
  const uid = userCredential.user.uid;
  const isDeveloper = cleanEmail === ADMIN_EMAIL;

  const newUser: User = {
    id: uid,
    name: data.name,
    email: cleanEmail,
    dob: data.dob,
    passwordHash: hashPassword(password),
    avatar: data.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
    coverPhoto: data.coverPhoto || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1400&q=80',
    bio: data.bio || 'Excited to be on Echat! 👋',
    location: data.location || 'Global',
    work: data.work || '',
    education: data.education || '',
    role: isDeveloper ? 'developer' : 'user',
    isVerified: isDeveloper,
    isOfficialDeveloper: isDeveloper,
    boostsCount: isDeveloper ? 420 : 0,
    boostedBy: [],
    isBlocked: false,
    isOnline: true,
    lastSeen: Date.now(),
    createdAt: Date.now(),
    friends: [],
    friendRequestsSent: [],
    friendRequestsReceived: []
  };

  // 2. THEN create document in users collection with that uid as id
  await setDoc(doc(db, 'users', uid), newUser);
  return newUser;
}

export async function loginUser(email: string, password: string): Promise<User> {
  const cleanEmail = email.toLowerCase().trim();
  const userCredential = await signInWithEmailAndPassword(auth, cleanEmail, password);
  const uid = userCredential.user.uid;

  let user = await getUserById(uid);
  if (!user) {
    user = await getUserByEmail(cleanEmail);
    if (user) {
      await setDoc(doc(db, 'users', uid), { ...user, id: uid }, { merge: true });
      user = { ...user, id: uid };
    } else {
      const isDeveloper = cleanEmail === ADMIN_EMAIL;
      user = {
        id: uid,
        name: userCredential.user.displayName || cleanEmail.split('@')[0],
        email: cleanEmail,
        dob: '2000-01-01',
        passwordHash: '',
        avatar: userCredential.user.photoURL || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
        coverPhoto: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1400&q=80',
        bio: 'Excited to be on Echat! 👋',
        location: 'Global',
        work: '',
        education: '',
        role: isDeveloper ? 'developer' : 'user',
        isVerified: isDeveloper,
        isOfficialDeveloper: isDeveloper,
        boostsCount: isDeveloper ? 420 : 0,
        boostedBy: [],
        isBlocked: false,
        isOnline: true,
        lastSeen: Date.now(),
        createdAt: Date.now(),
        friends: [],
        friendRequestsSent: [],
        friendRequestsReceived: []
      };
      await setDoc(doc(db, 'users', uid), user);
    }
  }

  await updateDoc(doc(db, 'users', uid), {
    isOnline: true,
    lastSeen: Date.now()
  }).catch(() => {});

  return user;
}

export async function logoutUser(): Promise<void> {
  const current = auth.currentUser;
  if (current) {
    await updateDoc(doc(db, 'users', current.uid), {
      isOnline: false,
      lastSeen: Date.now()
    }).catch(() => {});
  }
  await signOut(auth);
}

export async function updateUser(id: string, updates: Partial<User>): Promise<User | null> {
  const docRef = doc(db, 'users', id);
  await updateDoc(docRef, updates as any);
  return getUserById(id);
}

// Ensure SEED user eldermoses89@gmail.com exists
export async function ensureSeedAdminUser(): Promise<void> {
  try {
    const existing = await getUserByEmail(ADMIN_EMAIL);
    if (!existing) {
      console.log('Seed user not found in Firestore, ensuring existence...');
      try {
        await createUser({
          name: 'Elder Moses',
          email: ADMIN_EMAIL,
          password: 'admin123',
          dob: '1995-06-15',
          bio: 'Founder & Super Admin at Echat.',
          location: 'Sierra Leone, SL',
          work: 'Lead Architect @ Echat Network',
          education: 'Computer Science'
        });
        console.log('Seed admin user created successfully.');
      } catch (authErr: any) {
        if (authErr?.code === 'auth/email-already-in-use') {
          console.log('Seed user already in Auth, creating firestore doc.');
          const seedUid = 'user_admin_elder';
          const seedUser: User = {
            id: seedUid,
            name: 'Elder Moses',
            email: ADMIN_EMAIL,
            dob: '1995-06-15',
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
          };
          await setDoc(doc(db, 'users', seedUid), seedUser, { merge: true });
        }
      }
    }
  } catch (err) {
    console.error('ensureSeedAdminUser check failed:', err);
  }
}

// ----------------- POSTS -----------------

export async function getPosts(): Promise<Post[]> {
  try {
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    const posts: Post[] = [];
    snapshot.forEach(d => {
      posts.push({ id: d.id, ...d.data() } as Post);
    });
    return posts;
  } catch (err) {
    console.error('getPosts error:', err);
    return [];
  }
}

export async function getPostById(id: string): Promise<Post | null> {
  try {
    const snap = await getDoc(doc(db, 'posts', id));
    if (snap.exists()) {
      return { id: snap.id, ...snap.data() } as Post;
    }
    return null;
  } catch {
    return null;
  }
}

export async function createPost(postData: {
  authorId: string;
  content: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  feeling?: string;
  privacy?: 'public' | 'friends';
}): Promise<Post> {
  const id = 'post_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  const author = await getUserById(postData.authorId);

  const newPost: Post = {
    id,
    authorId: postData.authorId,
    author: author || undefined,
    content: postData.content,
    mediaUrl: postData.mediaUrl,
    mediaType: postData.mediaType,
    feeling: postData.feeling,
    privacy: postData.privacy || 'public',
    reactions: [],
    comments: [],
    sharesCount: 0,
    isReported: false,
    createdAt: Date.now()
  };
  await setDoc(doc(db, 'posts', id), newPost);
  return newPost;
}

export async function toggleReaction(postId: string, userId: string, type: ReactionType): Promise<Post | null> {
  const post = await getPostById(postId);
  if (!post) return null;

  const currentReactions: Reaction[] = post.reactions || [];
  const existingIndex = currentReactions.findIndex(r => r.userId === userId);

  let updatedReactions: Reaction[];
  if (existingIndex > -1) {
    if (currentReactions[existingIndex].type === type) {
      // Remove
      updatedReactions = currentReactions.filter(r => r.userId !== userId);
    } else {
      // Replace
      updatedReactions = currentReactions.map(r => r.userId === userId ? { userId, type, createdAt: Date.now() } : r);
    }
  } else {
    // Add
    updatedReactions = [...currentReactions, { userId, type, createdAt: Date.now() }];
  }

  await updateDoc(doc(db, 'posts', postId), { reactions: updatedReactions });
  return { ...post, reactions: updatedReactions };
}

export async function addComment(postId: string, authorId: string, content: string): Promise<Post | null> {
  const post = await getPostById(postId);
  if (!post) return null;

  const author = await getUserById(authorId);
  const comment: Comment = {
    id: 'comment_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    postId,
    authorId,
    author: author ? { id: author.id, name: author.name, avatar: author.avatar } : undefined,
    content,
    createdAt: Date.now(),
    likes: []
  };

  const updatedComments = [...(post.comments || []), comment];
  await updateDoc(doc(db, 'posts', postId), { comments: updatedComments });
  return { ...post, comments: updatedComments };
}

export async function sharePost(postId: string, userId: string): Promise<Post | null> {
  const post = await getPostById(postId);
  if (!post) return null;
  const newSharesCount = (post.sharesCount || 0) + 1;
  await updateDoc(doc(db, 'posts', postId), { sharesCount: newSharesCount });
  return { ...post, sharesCount: newSharesCount };
}

export async function deletePost(postId: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, 'posts', postId));
    return true;
  } catch {
    return false;
  }
}

// ----------------- STORIES -----------------

export async function getStories(): Promise<Story[]> {
  try {
    const q = query(collection(db, 'stories'), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    const stories: Story[] = [];
    const now = Date.now();
    snapshot.forEach(d => {
      const story = { id: d.id, ...d.data() } as Story;
      if (story.expiresAt > now) {
        stories.push(story);
      }
    });
    return stories;
  } catch (err) {
    console.error('getStories error:', err);
    return [];
  }
}

export async function createStory(storyData: {
  authorId: string;
  type: 'text' | 'image' | 'video';
  mediaUrl?: string;
  text?: string;
  backgroundGradient?: string;
}): Promise<Story> {
  const id = 'story_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  const author = await getUserById(storyData.authorId);

  const newStory: Story = {
    id,
    authorId: storyData.authorId,
    author: author || undefined,
    type: storyData.type,
    mediaUrl: storyData.mediaUrl,
    text: storyData.text,
    backgroundGradient: storyData.backgroundGradient,
    viewers: [],
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000
  };
  await setDoc(doc(db, 'stories', id), newStory);
  return newStory;
}

// ----------------- MESSAGES -----------------

export async function getMessages(userId1: string, userId2: string): Promise<Message[]> {
  try {
    const snapshot = await getDocs(collection(db, 'messages'));
    const messages: Message[] = [];
    snapshot.forEach(d => {
      const msg = { id: d.id, ...d.data() } as Message;
      if (
        (msg.senderId === userId1 && msg.receiverId === userId2) ||
        (msg.senderId === userId2 && msg.receiverId === userId1)
      ) {
        messages.push(msg);
      }
    });
    return messages.sort((a, b) => a.createdAt - b.createdAt);
  } catch (err) {
    console.error('getMessages error:', err);
    return [];
  }
}

export async function sendMessage(data: {
  senderId: string;
  receiverId: string;
  text?: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio';
  audioDuration?: number;
}): Promise<Message> {
  const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  const newMsg: Message = {
    id,
    senderId: data.senderId,
    receiverId: data.receiverId,
    text: data.text,
    mediaUrl: data.mediaUrl,
    mediaType: data.mediaType,
    audioDuration: data.audioDuration,
    status: 'sent',
    createdAt: Date.now()
  };
  await setDoc(doc(db, 'messages', id), newMsg);
  return newMsg;
}

// ----------------- NOTIFICATIONS -----------------

export async function getNotifications(userId: string): Promise<Notification[]> {
  try {
    const q = query(
      collection(db, 'notifications'), 
      where('userId', '==', userId)
    );
    const snapshot = await getDocs(q);
    const notifs: Notification[] = [];
    snapshot.forEach(d => {
      notifs.push({ id: d.id, ...d.data() } as Notification);
    });
    return notifs.sort((a, b) => b.createdAt - a.createdAt);
  } catch (err) {
    console.error('getNotifications error:', err);
    return [];
  }
}

export async function createNotification(notif: {
  userId: string;
  actorId: string;
  type: 'friend_request' | 'friend_accept' | 'post_reaction' | 'post_comment' | 'message' | 'missed_call' | 'call';
  message: string;
  targetId?: string;
  callType?: 'audio' | 'video';
}): Promise<Notification> {
  const id = 'notif_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  const actor = await getUserById(notif.actorId);

  const newNotif: Notification = {
    id,
    userId: notif.userId,
    actorId: notif.actorId,
    actor: actor || null,
    type: notif.type,
    message: notif.message,
    targetId: notif.targetId,
    callType: notif.callType,
    createdAt: Date.now(),
    read: false
  };
  await setDoc(doc(db, 'notifications', id), newNotif);
  return newNotif;
}

export async function markNotificationsRead(userId: string): Promise<boolean> {
  try {
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', userId),
      where('read', '==', false)
    );
    const snapshot = await getDocs(q);
    const updates = snapshot.docs.map(d => updateDoc(doc(db, 'notifications', d.id), { read: true }));
    await Promise.all(updates);
    return true;
  } catch (err) {
    console.error('markNotificationsRead error:', err);
    return false;
  }
}

// ----------------- FRIEND REQUESTS -----------------

export async function sendFriendRequest(fromUserId: string, toUserId: string): Promise<boolean> {
  if (fromUserId === toUserId) return false;
  const fromUser = await getUserById(fromUserId);
  const toUser = await getUserById(toUserId);
  if (!fromUser || !toUser) return false;

  await updateDoc(doc(db, 'users', fromUserId), {
    friendRequestsSent: arrayUnion(toUserId)
  });
  await updateDoc(doc(db, 'users', toUserId), {
    friendRequestsReceived: arrayUnion(fromUserId)
  });

  await createNotification({
    userId: toUserId,
    actorId: fromUserId,
    type: 'friend_request',
    message: `${fromUser.name} sent you a friend request.`,
    targetId: fromUserId
  });

  return true;
}

export async function acceptFriendRequest(userId: string, requesterId: string): Promise<boolean> {
  const user = await getUserById(userId);
  const requester = await getUserById(requesterId);
  if (!user || !requester) return false;

  await updateDoc(doc(db, 'users', userId), {
    friendRequestsReceived: arrayRemove(requesterId),
    friends: arrayUnion(requesterId)
  });
  await updateDoc(doc(db, 'users', requesterId), {
    friendRequestsSent: arrayRemove(userId),
    friends: arrayUnion(userId)
  });

  await createNotification({
    userId: requesterId,
    actorId: userId,
    type: 'friend_accept',
    message: `${user.name} accepted your friend request.`,
    targetId: userId
  });

  return true;
}

export async function rejectFriendRequest(userId: string, requesterId: string): Promise<boolean> {
  await updateDoc(doc(db, 'users', userId), {
    friendRequestsReceived: arrayRemove(requesterId)
  });
  await updateDoc(doc(db, 'users', requesterId), {
    friendRequestsSent: arrayRemove(userId)
  });
  return true;
}

export async function unfriend(userId: string, friendId: string): Promise<boolean> {
  await updateDoc(doc(db, 'users', userId), {
    friends: arrayRemove(friendId)
  });
  await updateDoc(doc(db, 'users', friendId), {
    friends: arrayRemove(userId)
  });
  return true;
}

// ----------------- ADMIN STATS -----------------

export async function getAdminStats(): Promise<AdminStats> {
  const [users, posts, stories, messages] = await Promise.all([
    getAllUsers(),
    getPosts(),
    getStories(),
    getDocs(collection(db, 'messages')).then(s => s.size).catch(() => 0)
  ]);

  const totalUsers = users.length;
  const onlineUsers = users.filter(u => u.isOnline).length;
  const blockedUsers = users.filter(u => u.isBlocked).length;
  const totalPosts = posts.length;
  const totalStories = stories.length;
  const totalMessages = typeof messages === 'number' ? messages : 0;
  const pendingReports = posts.filter(p => p.isReported).length;

  return {
    totalUsers,
    onlineUsers,
    blockedUsers,
    totalPosts,
    totalMessages,
    totalStories,
    pendingReports,
    activeSockets: onlineUsers,
    uptimeSeconds: Math.floor(performance.now() / 1000)
  };
}

// Export db object matching interface for direct usage
export const firestoreDb = {
  getUserByEmail,
  getUserById,
  getAllUsers,
  createUser,
  loginUser,
  logoutUser,
  updateUser,
  getPosts,
  getPostById,
  createPost,
  toggleReaction,
  addComment,
  sharePost,
  deletePost,
  getStories,
  createStory,
  getMessages,
  sendMessage,
  getNotifications,
  createNotification,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  unfriend,
  getAdminStats,
  ensureSeedAdminUser
};

export default firestoreDb;
