export type ReactionType = 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry';
export interface Reaction { userId: string; type: ReactionType; createdAt: number; }
export interface User {
  id: string; name: string; email: string; passwordHash?: string;
  avatar: string; coverPhoto: string; bio: string; location: string;
  dob?: string; work?: string; education?: string;
  role: 'user' | 'admin' | 'developer';
  isVerified?: boolean; isOfficialDeveloper?: boolean;
  boostsCount?: number; boostedBy?: string[];
  isBlocked: boolean; isOnline: boolean; lastSeen: number; createdAt: number; lastLogin?: number;
  friends: string[]; friendRequestsSent: string[]; friendRequestsReceived: string[];
  blockedUsers?: string[]; privacySettings?: any;
}
export interface Comment { id: string; postId: string; authorId: string; author?: { id: string; name: string; avatar: string; }; content: string; createdAt: number; likes: string[]; }
export interface Post { id: string; authorId: string; author?: any; content: string; mediaUrl?: string; mediaType?: 'image' | 'video'; feeling?: string; privacy: 'public' | 'friends'; reactions: Reaction[]; comments: Comment[]; sharesCount: number; viewsCount?: number; views?: string[]; isReported: boolean; reportReason?: string; createdAt: number; }
export interface Story { id: string; authorId: string; author?: any; type: 'text' | 'image' | 'video'; mediaUrl?: string; text?: string; backgroundGradient?: string; viewers: { userId: string; viewedAt: number }[]; createdAt: number; expiresAt: number; }
export interface Message { id: string; conversationId?: string; senderId: string; receiverId: string; text?: string; mediaUrl?: string; mediaType?: 'image' | 'video' | 'audio'; audioDuration?: number; status: 'sent' | 'delivered' | 'seen'; createdAt: number; }
export interface Notification { id: string; userId: string; actorId: string; actor?: any; type: 'friend_request' | 'friend_accept' | 'post_reaction' | 'post_comment' | 'message' | 'missed_call' | 'call'; targetId?: string; message: string; read: boolean; createdAt: number; }
export interface AdminStats { totalUsers: number; onlineUsers: number; blockedUsers: number; totalPosts: number; totalMessages: number; totalStories: number; pendingReports: number; activeSockets: number; uptimeSeconds: number; }
export interface GlobalSearchResults { users: User[]; posts: Post[]; }
export interface LiveComment { id: string; userId: string; userName: string; userAvatar: string; text: string; createdAt: number; }
export interface LiveStream { id: string; hostId: string; hostName: string; hostAvatar: string; hostEmail: string; isHostVerified?: boolean; title: string; viewersCount: number; reactionsCount: number; startedAt: number; isActive: boolean; comments: LiveComment[]; }
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
export interface SavedItem { id: string; userId: string; postId: string; type: 'post' | 'page' | 'reel' | 'event'; title?: string; subtitle?: string; mediaUrl?: string; savedAt: number; }
export interface ReelComment { id: string; userId: string; userName: string; userAvatar: string; text: string; createdAt: number; }
export interface ReelItem { id: string; videoUrl: string; caption: string; ownerId: string; ownerName?: string; ownerAvatar?: string; likes: string[]; likesCount?: number; comments: ReelComment[]; sharesCount?: number; createdAt: number; }
export interface SiteConfig { welcomeTitle?: string; welcomeSubtitle?: string; welcomeBgImage?: string; welcomeLogo?: string; primaryButtonText?: string; secondaryText?: string; bannerEnabled?: boolean; bannerText?: string; maintenanceMode?: boolean; appName?: string; themeColor?: string; updatedAt?: number; welcomePage?: any; }
export interface DeviceSession { id: string; deviceName: string; browser: string; os: string; location: string; isCurrent: boolean; lastActive: number; }