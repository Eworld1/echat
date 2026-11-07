export interface AnalyticsDay { date: string; signups: number; posts: number; messages: number; stories: number }

export interface AdminAnalytics {
  days: AnalyticsDay[];
  reactions: { type: string; count: number }[];
  topPosts: { id: string; snippet: string; authorName: string; reactions: number; comments: number; shares: number; score: number }[];
  topAuthors: { id: string; name: string; avatar: string; posts: number }[];
  verifiedUsers: number;
  developers: number;
  totals: { users: number; posts: number; messages: number; stories: number; pages: number; groups: number; events: number };
}

export interface AdminSystemInfo {
  serverTime: number;
  uptimeSeconds: number;
  nodeVersion: string;
  memoryMB: number;
  heapMB: number;
  storage: string | { driver?: string; flushes: number; upserts: number; deletes: number };
  onlineUsers: number;
  activeSockets: number;
  environment: 'production' | 'development';
}

export interface AuditEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  targetType?: string;
  targetId?: string;
  targetName?: string;
  details?: string;
  createdAt: number;
}
