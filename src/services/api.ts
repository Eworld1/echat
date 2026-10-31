import { apiUrl, assetUrl } from './apiBase';
import type {
  User,
  Post,
  Story,
  Message,
  Notification,
  AdminStats,
  GlobalSearchResults,
  LiveStream,
  LiveComment,
  ReactionType,
  Page,
  PagePost,
  Group,
  GroupPost,
  EventItem
} from '../types';

async function readResponse<T>(res: Response, fallbackMessage = 'Request failed'): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const payload = isJson
    ? await res.json().catch(() => null)
    : await res.text().catch(() => '');

  if (!res.ok) {
    if (!isJson && (res.status === 404 || res.status === 405)) {
      throw new Error(
        'Cannot reach the Echat server. Set VITE_API_URL to your deployed backend and redeploy.'
      );
    }
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error?: unknown }).error || fallbackMessage)
        : (typeof payload === 'string' && payload.length < 200 && payload ? payload : fallbackMessage);
    throw new Error(message);
  }

  if (!isJson && typeof payload === 'string') {
    throw new Error(
      'Cannot reach the Echat server. Set VITE_API_URL to your deployed backend and redeploy.'
    );
  }

  return payload as T;
}

function getHeaders(customHeaders: Record<string, string> = {}) {
  const storage = typeof window !== 'undefined' ? window.localStorage : null;
  const currentUserId = storage?.getItem('echat_user_id') || '';
  const devKey = storage?.getItem('echat_dev_key') || '';
  return {
    'Content-Type': 'application/json',
    ...(currentUserId ? { 'x-user-id': currentUserId } : {}),
    ...(devKey ? { 'x-developer-key': devKey } : {}),
    ...customHeaders
  };
}

export const api = {
  // File upload (profile photos, cover photos, media). Returns a loadable URL.
  async uploadFile(file: File): Promise<string> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read the selected file'));
      reader.readAsDataURL(file);
    });
    const res = await fetch(apiUrl('/api/upload'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ dataUrl, filename: file.name })
    });
    const data = await readResponse<{ url: string }>(res, 'Upload failed');
    return assetUrl(data.url);
  },

  // Global Search
  async search(query: string): Promise<GlobalSearchResults> {
    const res = await fetch(apiUrl(`/api/search?q=${encodeURIComponent(query)}`), {
      headers: getHeaders()
    });
    return readResponse<GlobalSearchResults>(res, 'Search failed');
  },

  // Auth
  async register(data: {
    id?: string;
    name: string;
    email: string;
    password: string;
    dob: string;
    avatar?: string;
    bio?: string;
    location?: string;
    termsAccepted: boolean;
  }) {
    const res = await fetch(apiUrl('/api/auth/register'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return readResponse<{ user: User; token: string }>(res, 'Registration failed');
  },

  async login(data: { email: string; password: string }) {
    const res = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return readResponse<{ user: User; token: string }>(res, 'Login failed');
  },

  async forgotPassword(email: string): Promise<{ success: boolean; message: string; token?: string }> {
    const res = await fetch(apiUrl('/api/auth/forgot-password'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ email })
    });
    return readResponse<{ success: boolean; message: string; token: string }>(res, 'Failed to request reset token');
  },

  async resetPassword(token: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(apiUrl('/api/auth/reset-password'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ token, newPassword })
    });
    return readResponse<{ success: boolean; message: string }>(res, 'Password reset failed');
  },

  async getMe(): Promise<User | null> {
    const res = await fetch(apiUrl('/api/auth/me'), { headers: getHeaders() });
    if (res.status === 401 || res.status === 403) return null;
    const data = await readResponse<{ user: User }>(res, 'Failed to load current user');
    return data.user;
  },

  // Copies the real (Firebase) profile onto the server's placeholder account after login/session restore.
  async syncProfile(profile: Pick<User, 'name' | 'avatar' | 'coverPhoto' | 'bio' | 'location'>): Promise<void> {
    const res = await fetch(apiUrl('/api/auth/sync-profile'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(profile)
    });
    await readResponse<{ synced: boolean }>(res, 'Profile sync failed');
  },

  async quickSwitch(userId: string) {
    const res = await fetch(apiUrl('/api/auth/quick-switch'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ userId })
    });
    return readResponse<{ user: User; token: string }>(res, 'Switch failed');
  },

  // Users
  async getUsers(): Promise<User[]> {
    try {
      const res = await fetch(apiUrl('/api/users'), { headers: getHeaders() });
      if (!res.ok) return [];
      const data = await readResponse<User[] | { users: User[] }>(res);
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.users)) return data.users;
      return [];
    } catch (e) {
      console.warn('Failed to fetch users:', e);
      return [];
    }
  },

  async getUserProfile(id: string): Promise<{ user: User; posts: Post[]; friends: User[] }> {
    const res = await fetch(apiUrl(`/api/users/${id}`), { headers: getHeaders() });
    return readResponse<{ user: User; posts: Post[]; friends: User[] }>(res, 'User not found');
  },

  async updateProfile(id: string, updates: Partial<User>): Promise<User> {
    const res = await fetch(apiUrl(`/api/users/${id}`), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(updates)
    });
    return readResponse<User>(res, 'Update failed');
  },

  // Friends
  async sendFriendRequest(toUserId: string) {
    const res = await fetch(apiUrl('/api/friends/request'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ toUserId })
    });
    return readResponse(res);
  },

  async acceptFriendRequest(fromUserId: string) {
    const res = await fetch(apiUrl('/api/friends/accept'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ fromUserId })
    });
    return readResponse(res);
  },

  async rejectFriendRequest(fromUserId: string) {
    const res = await fetch(apiUrl('/api/friends/reject'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ fromUserId })
    });
    return readResponse(res);
  },

  async unfriend(friendId: string) {
    const res = await fetch(apiUrl('/api/friends/unfriend'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ friendId })
    });
    return readResponse(res);
  },

  // Posts
  async getPosts(): Promise<Post[]> {
    try {
      const res = await fetch(apiUrl('/api/posts'), { headers: getHeaders() });
      if (!res.ok) return [];
      const data = await readResponse<Post[]>(res);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },

  async createPost(data: {
    content: string;
    mediaUrl?: string;
    mediaType?: 'image' | 'video';
    feeling?: string;
    privacy?: 'public' | 'friends';
  }): Promise<Post> {
    const res = await fetch(apiUrl('/api/posts'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return readResponse<Post>(res, 'Failed to create post');
  },

  async reactToPost(postId: string, type: ReactionType | string): Promise<Post> {
    const res = await fetch(apiUrl(`/api/posts/${postId}/react`), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ type })
    });
    return readResponse<Post>(res);
  },

  async commentPost(postId: string, content: string): Promise<Post> {
    const res = await fetch(apiUrl(`/api/posts/${postId}/comment`), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ content })
    });
    return readResponse<Post>(res, 'Failed to post comment');
  },

  async sharePost(postId: string) {
    const res = await fetch(apiUrl(`/api/posts/${postId}/share`), {
      method: 'POST',
      headers: getHeaders()
    });
    return readResponse(res);
  },

  async reportPost(postId: string, reason: string) {
    const res = await fetch(apiUrl(`/api/posts/${postId}/report`), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ reason })
    });
    return readResponse(res);
  },

  async deletePost(postId: string) {
    const res = await fetch(apiUrl(`/api/posts/${postId}`), {
      method: 'DELETE',
      headers: getHeaders()
    });
    return readResponse(res);
  },

  // Stories
  async getStories(): Promise<Story[]> {
    try {
      const res = await fetch(apiUrl('/api/stories'), { headers: getHeaders() });
      if (!res.ok) return [];
      const data = await readResponse<Story[]>(res);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },

  async createStory(data: {
    type: 'text' | 'image' | 'video';
    mediaUrl?: string;
    text?: string;
    backgroundGradient?: string;
  }): Promise<Story> {
    const res = await fetch(apiUrl('/api/stories'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return readResponse<Story>(res);
  },

  async viewStory(id: string) {
    const res = await fetch(apiUrl(`/api/stories/${id}/view`), {
      method: 'POST',
      headers: getHeaders()
    });
    return readResponse(res);
  },

  // Messages
  async getMessages(partnerId: string): Promise<Message[]> {
    try {
      const res = await fetch(apiUrl(`/api/messages/${partnerId}`), { headers: getHeaders() });
      if (!res.ok) return [];
      const data = await readResponse<Message[]>(res);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },

  async sendMessage(data: {
    receiverId: string;
    text?: string;
    mediaUrl?: string;
    mediaType?: 'image' | 'video' | 'audio';
    audioDuration?: number;
  }): Promise<Message> {
    const res = await fetch(apiUrl('/api/messages'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return readResponse<Message>(res);
  },

  async markMessagesSeen(partnerId: string) {
    const res = await fetch(apiUrl('/api/messages/seen'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ partnerId })
    });
    return readResponse(res);
  },

  // Notifications
  async getNotifications(): Promise<Notification[]> {
    try {
      const res = await fetch(apiUrl('/api/notifications'), { headers: getHeaders() });
      if (!res.ok) {
        return [];
      }
      const data = await readResponse<Notification[]>(res, 'Failed to get notifications');
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },

  async markNotificationsRead() {
    const res = await fetch(apiUrl('/api/notifications/read'), {
      method: 'POST',
      headers: getHeaders()
    });
    if (res.status === 401) {
      return { success: true };
    }
    return readResponse(res);
  },

  // Admin / Developer
  async getAdminStats(): Promise<AdminStats> {
    const res = await fetch(apiUrl('/api/admin/stats'), { headers: getHeaders() });
    return readResponse<AdminStats>(res, 'Developer access denied');
  },

  async getAdminUsers(): Promise<User[]> {
    const res = await fetch(apiUrl('/api/admin/users'), { headers: getHeaders() });
    return readResponse<User[]>(res, 'Developer access denied');
  },

  async toggleBlockUser(userId: string): Promise<User> {
    const res = await fetch(apiUrl(`/api/admin/users/${userId}/toggle-block`), {
      method: 'POST',
      headers: getHeaders()
    });
    return readResponse<User>(res);
  },

  async getAdminReports(): Promise<Post[]> {
    const res = await fetch(apiUrl('/api/admin/reports'), { headers: getHeaders() });
    return readResponse<Post[]>(res);
  },

  async dismissReport(postId: string) {
    const res = await fetch(apiUrl(`/api/admin/reports/${postId}/dismiss`), {
      method: 'POST',
      headers: getHeaders()
    });
    return readResponse(res);
  },

  // Developer Profile Controls
  async updateDeveloperProfile(data: {
    name?: string;
    avatar?: string;
    bio?: string;
    location?: string;
    work?: string;
    education?: string;
    coverPhoto?: string;
  }): Promise<{ success: boolean; user: User }> {
    const res = await fetch(apiUrl('/api/admin/developer-profile'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return readResponse<{ success: boolean; user: User }>(res, 'Failed to update developer profile');
  },

  // Self-verify developer account
  async verifySelf(): Promise<{ success: boolean; user: User }> {
    const res = await fetch(apiUrl('/api/admin/verify-self'), {
      method: 'POST',
      headers: getHeaders()
    });
    return readResponse<{ success: boolean; user: User }>(res, 'Failed to verify account');
  },

  // Boost developer account
  async boostUser(userId: string): Promise<{ success: boolean; hasBoosted: boolean; boostsCount: number }> {
    const res = await fetch(apiUrl(`/api/users/${userId}/boost`), {
      method: 'POST',
      headers: getHeaders()
    });
    return readResponse<{ success: boolean; hasBoosted: boolean; boostsCount: number }>(res, 'Failed to boost user');
  },

  // Gated Go-Live System
  async getCurrentLive(): Promise<{ live: LiveStream | null }> {
    const res = await fetch(apiUrl('/api/live/current'), { headers: getHeaders() });
    if (!res.ok) return { live: null };
    return readResponse<{ live: LiveStream | null }>(res);
  },

  async startLive(title?: string): Promise<{ success: boolean; live: LiveStream }> {
    const res = await fetch(apiUrl('/api/live/start'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ title })
    });
    return readResponse(res, 'Failed to start live stream');
  },

  async stopLive(): Promise<{ success: boolean }> {
    const res = await fetch(apiUrl('/api/live/stop'), {
      method: 'POST',
      headers: getHeaders()
    });
    return readResponse(res);
  },

  async sendLiveComment(text: string): Promise<{ success: boolean; comment: LiveComment }> {
    const res = await fetch(apiUrl('/api/live/comment'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ text })
    });
    return readResponse(res, 'Failed to send comment');
  },

  async sendLiveReaction(emoji: string): Promise<{ success: boolean; reactionsCount: number }> {
    const res = await fetch(apiUrl('/api/live/reaction'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ emoji })
    });
    return readResponse(res);
  },

  async joinLive(): Promise<{ success: boolean; viewersCount: number }> {
    const res = await fetch(apiUrl('/api/live/join'), {
      method: 'POST',
      headers: getHeaders()
    });
    return readResponse(res);
  },

  async leaveLive(): Promise<{ success: boolean; viewersCount: number }> {
    const res = await fetch(apiUrl('/api/live/leave'), {
      method: 'POST',
      headers: getHeaders()
    });
    return readResponse(res);
  },

  // Pages
  async getPages(): Promise<Page[]> {
    try {
      const res = await fetch(apiUrl('/api/pages'), { headers: getHeaders() });
      if (!res.ok) return [];
      const data = await readResponse<Page[]>(res);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },

  async getPage(id: string): Promise<Page> {
    const res = await fetch(apiUrl(`/api/pages/${id}`), { headers: getHeaders() });
    return readResponse<Page>(res, 'Page not found');
  },

  async createPage(data: { name: string; category: string; bio: string; cover: string; avatar?: string }): Promise<Page> {
    const res = await fetch(apiUrl('/api/pages'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return readResponse<Page>(res, 'Failed to create page');
  },

  async togglePageFollow(pageId: string): Promise<Page> {
    const res = await fetch(apiUrl(`/api/pages/${pageId}/follow`), {
      method: 'POST',
      headers: getHeaders()
    });
    return readResponse<Page>(res, 'Failed to toggle follow');
  },

  async togglePageLike(pageId: string): Promise<Page> {
    const res = await fetch(apiUrl(`/api/pages/${pageId}/like`), {
      method: 'POST',
      headers: getHeaders()
    });
    return readResponse<Page>(res, 'Failed to toggle like');
  },

  async createPagePost(pageId: string, data: { content: string; mediaUrl?: string; mediaType?: 'image' | 'video' }): Promise<PagePost> {
    const res = await fetch(apiUrl(`/api/pages/${pageId}/posts`), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return readResponse<PagePost>(res, 'Failed to publish post');
  },

  // Groups
  async getGroups(): Promise<Group[]> {
    try {
      const res = await fetch(apiUrl('/api/groups'), { headers: getHeaders() });
      if (!res.ok) return [];
      const data = await readResponse<Group[]>(res);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },

  async getGroup(id: string): Promise<Group> {
    const res = await fetch(apiUrl(`/api/groups/${id}`), { headers: getHeaders() });
    return readResponse<Group>(res, 'Group not found');
  },

  async createGroup(data: { name: string; privacy: 'public' | 'private'; description: string; cover: string; avatar?: string }): Promise<Group> {
    const res = await fetch(apiUrl('/api/groups'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return readResponse<Group>(res, 'Failed to create group');
  },

  async joinGroup(groupId: string): Promise<Group> {
    const res = await fetch(apiUrl(`/api/groups/${groupId}/join`), {
      method: 'POST',
      headers: getHeaders()
    });
    return readResponse<Group>(res, 'Failed to join group');
  },

  async leaveGroup(groupId: string): Promise<Group> {
    const res = await fetch(apiUrl(`/api/groups/${groupId}/leave`), {
      method: 'POST',
      headers: getHeaders()
    });
    return readResponse<Group>(res, 'Failed to leave group');
  },

  async createGroupPost(groupId: string, data: { content: string; mediaUrl?: string; mediaType?: 'image' | 'video' }): Promise<GroupPost> {
    const res = await fetch(apiUrl(`/api/groups/${groupId}/posts`), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return readResponse<GroupPost>(res, 'Failed to post in group');
  },

  async approveGroupPost(groupId: string, postId: string): Promise<{ success: boolean; group: Group }> {
    const res = await fetch(apiUrl(`/api/groups/${groupId}/posts/${postId}/approve`), {
      method: 'POST',
      headers: getHeaders()
    });
    return readResponse<{ success: boolean; group: Group }>(res, 'Failed to approve post');
  },

  // Events
  async getEvents(): Promise<EventItem[]> {
    try {
      const res = await fetch(apiUrl('/api/events'), { headers: getHeaders() });
      if (!res.ok) return [];
      const data = await readResponse<EventItem[]>(res);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },

  async getEvent(id: string): Promise<EventItem> {
    const res = await fetch(apiUrl(`/api/events/${id}`), { headers: getHeaders() });
    return readResponse<EventItem>(res, 'Event not found');
  },

  async createEvent(data: { title: string; date: string; location: string; cover: string; description: string }): Promise<EventItem> {
    const res = await fetch(apiUrl('/api/events'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return readResponse<EventItem>(res, 'Failed to create event');
  },

  async toggleEventGoing(eventId: string): Promise<EventItem> {
    const res = await fetch(apiUrl(`/api/events/${eventId}/going`), {
      method: 'POST',
      headers: getHeaders()
    });
    return readResponse<EventItem>(res, 'Failed to update RSVP');
  },

  async toggleEventInterested(eventId: string): Promise<EventItem> {
    const res = await fetch(apiUrl(`/api/events/${eventId}/interested`), {
      method: 'POST',
      headers: getHeaders()
    });
    return readResponse<EventItem>(res, 'Failed to update interest');
  },

  // Account Settings
  async changePassword(userId: string, data: { currentPassword?: string; newPassword: string }): Promise<{ success: boolean; message: string }> {
    const res = await fetch(apiUrl(`/api/users/${userId}/change-password`), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return readResponse<{ success: boolean; message: string }>(res, 'Failed to change password');
  },

  async deleteAccount(userId: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(apiUrl(`/api/users/${userId}`), {
      method: 'DELETE',
      headers: getHeaders()
    });
    return readResponse<{ success: boolean; message: string }>(res, 'Failed to delete account');
  }
};