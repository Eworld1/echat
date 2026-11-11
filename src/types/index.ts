export type ReactionType = 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry';

export interface Reaction { userId: string; type: ReactionType; createdAt: number; }

export interface User {
  id: string; name: string; email: string; passwordHash?: string; // FIX: Added
  avatar: string; coverPhoto: string; bio: string; location: string;
  dob?: string; dobMonthDay?: string; dobVisibility?: 'public' | 'friends' | 'only_me' | 'month_day_only'; birthdayReminderEnabled?: boolean; work?: string; education?: string;
  role: 'user' | 'admin' | 'developer';
  isVerified?: boolean; isOfficialDeveloper?: boolean;
  boostsCount?: number; boostedBy?: string[];
  isBlocked: boolean; isOnline: boolean; lastSeen: number; createdAt: number;
  lastLogin?: number;
  friends: string[]; friendRequestsSent: string[]; friendRequestsReceived: string[];
  blockedUsers?: string[]; // FIX
  privacySettings?: any;
  savedPosts?: string[];
}

export interface Comment {
  id: string; postId: string; authorId: string;
  author?: { id: string; name: string; avatar: string }; // FIX: optional partial
  content: string; createdAt: number; likes: string[];
}

export interface Post {
  id: string; authorId: string; author?: User; // FIX: optional
  type?: 'post' | 'reel';
  content: string; mediaUrl?: string; mediaUrls?: string[]; mediaType?: 'image' | 'video'; thumbnailUrl?: string; mediaDuration?: number; mediaSize?: number;
  feeling?: string; privacy: 'public' | 'friends' | 'only_me';
  reactions: Reaction[]; comments: Comment[]; sharesCount: number;
  viewsCount?: number; views?: string[]; isReported: boolean;
  pageId?: string;
  viewRecords?: { userId: string; viewedAt: number }[];
  reportReason?: string; createdAt: number; editedAt?: number;
  taggedUserIds?: string[];
  taggedUsers?: { id: string; name: string; avatar: string }[];
  sharedPostId?: string;
  /** Embedded original when this post is a re-share (null when the original was deleted/private). */
  sharedPost?: { id: string; content: string; mediaUrl?: string; mediaType?: 'image' | 'video'; createdAt: number; author: { id?: string; name: string; avatar: string } } | null;
}

export interface Story {
  id: string; authorId: string; author?: User; // FIX: optional
  type: 'text' | 'image' | 'video'; mediaUrl?: string; text?: string;
  backgroundGradient?: string; viewers: { userId: string; viewedAt: number; user?: Pick<User, 'id' | 'name' | 'avatar'> | null }[];
  createdAt: number; expiresAt: number;
}

export interface MessageAttachment { url: string; name: string; mimeType: string; size: number; }
export interface Message {
  id: string; conversationId?: string; // Optional
  senderId: string; receiverId: string;
  text?: string; mediaUrl?: string; mediaType?: 'image' | 'video' | 'audio';
  audioDuration?: number; attachments?: MessageAttachment[]; status: 'sent' | 'delivered' | 'seen'; createdAt: number; editedAt?: number; editHistory?: { text: string; editedAt: number }[]; deletedFor?: string[];
}

export interface Notification {
  id: string; userId: string; actorId: string; actor?: User | null;
  type: 'friend_request' | 'friend_accept' | 'post_reaction' | 'post_comment' | 'message' | 'missed_call' | 'call' | 'post_tag' | 'post_share' | 'post_new' | 'live_stream' | 'page_follow' | 'announcement' | 'birthday' | 'birthday_reminder' | 'birthday_today'; // FIX: Added
  targetId?: string; message: string; read: boolean; createdAt: number;
  callType?: 'audio' | 'video';
}

export interface AdminStats { totalUsers: number; onlineUsers: number; blockedUsers: number; totalPosts: number; totalMessages: number; totalStories: number; pendingReports: number; activeSockets: number; uptimeSeconds: number; }
export interface SiteConfig { welcomeTitle?: string; welcomeSubtitle?: string; welcomeBgImage?: string; welcomeLogo?: string; primaryButtonText?: string; secondaryText?: string; appName?: string; }
export interface GlobalSearchResults { users: User[]; posts: Post[]; }
export interface LiveComment { id: string; userId: string; userName: string; userAvatar: string; text: string; createdAt: number; }
export interface LiveStream { id: string; hostId: string; hostName: string; hostAvatar: string; hostEmail: string; isHostVerified?: boolean; title: string; taggedPageIds?: string[]; viewersCount: number; reactionsCount: number; startedAt: number; isActive: boolean; comments: LiveComment[]; }

export interface PagePost {
  id: string;
  pageId: string;
  authorId: string;
  content: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  createdAt: number;
  likes: string[];
  comments: Comment[];
}

export interface Page {
  id: string;
  name: string;
  category: string;
  bio: string;
  cover: string;
  avatar?: string;
  ownerId: string;
  ownerName?: string;
  followers: string[];
  likes: string[];
  posts: PagePost[];
  createdAt: number;
}

export interface GroupPost {
  id: string;
  groupId: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  content: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  status: 'approved' | 'pending';
  likes: string[];
  comments: Comment[];
  createdAt: number;
}

export interface Group {
  id: string;
  name: string;
  privacy: 'public' | 'private';
  cover: string;
  description: string;
  avatar?: string;
  ownerId: string;
  ownerName?: string;
  members: string[];
  posts: GroupPost[];
  createdAt: number;
}

export interface EventItem {
  id: string;
  title: string;
  date: string;
  location: string;
  cover: string;
  description: string;
  ownerId: string;
  ownerName?: string;
  going: string[];
  interested: string[];
  createdAt: number;
}
