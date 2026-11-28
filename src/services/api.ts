import { LEGACY_API_URL, apiUrl } from './apiBase';
import { MAX_VIDEO_UPLOAD_BYTES, UploadCancelledError, uploadToCloudinary } from './upload';

const cloudinaryFolderFor = (file: File) => file.type.startsWith('video/') ? 'echat/videos' : file.type.startsWith('image/') ? 'echat/images' : file.type.startsWith('audio/') ? 'echat/audio' : 'echat/files';
import type { AdminAnalytics, AdminSystemInfo, AuditEntry } from '../types/admin';
import type {
  User,
  Post,
  Story,
  Message,
  MessageAttachment,
  Notification,
  AdminStats,
  GlobalSearchResults,
  LiveStream,
  LiveComment,
  LiveAccessRequest,
  LiveAccessMode,
  ReactionType,
  Page,
  PagePost,
  Group,
  GroupPost,
  EventItem,
  JobItem
} from '../types';
import { auth } from './firebase';

const API_READ_CACHE_TTL_MS = 30_000;
type ApiReadCacheEntry = { expiresAt: number; value?: unknown; promise?: Promise<unknown> };
const apiReadCache = new Map<string, ApiReadCacheEntry>();

function getApiCacheUserId(userId?: string): string {
  return userId || (typeof window !== 'undefined' ? window.localStorage.getItem('echat_user_id') : null) || auth.currentUser?.uid || 'anonymous';
}

function getApiCacheKey(key: string, userId?: string): string {
  return `${getApiCacheUserId(userId)}:${key}`;
}

export function invalidateApiReadCache(key: string, userId?: string): void {
  apiReadCache.delete(getApiCacheKey(key, userId));
}

function cachedApiRead<T>(key: string, load: () => Promise<T>, userId?: string): Promise<T> {
  const cacheKey = getApiCacheKey(key, userId);
  const cached = apiReadCache.get(cacheKey);
  if (cached?.promise) return cached.promise as Promise<T>;
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value as T);

  const promise = load().then(value => {
    apiReadCache.set(cacheKey, { expiresAt: Date.now() + API_READ_CACHE_TTL_MS, value });
    return value;
  }, error => {
    apiReadCache.delete(cacheKey);
    throw error;
  });
  apiReadCache.set(cacheKey, { expiresAt: 0, promise });
  return promise;
}

export interface DirectMessage {
  _id: string;
  senderId: string;
  receiverId: string;
  text: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'file';
  audioDuration?: number;
  attachments?: MessageAttachment[];
  createdAt: number;
  readAt: number | null;
  /** Edited by the sender (shows "Edited"). */
  editedAt?: number;
  /** Deleted for everyone: no content, shows "This message was deleted". */
  deletedForEveryone?: boolean;
  deletedAt?: number;
  /** Swipe-to-reply quote. */
  replyTo?: { id: string; senderId: string; senderName: string; preview: string };
}

export interface DirectConversation {
  user: User;
  lastMessage: DirectMessage;
  unreadCount: number;
}

interface DashboardResponse {
  stats: { views: number; likes: number; comments: number; followers: number; posts: number };
  viewsByDay: { date: string; views: number }[];
  posts: Post[];
  reels?: Post[];
}

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
    const detailText =
      payload && typeof payload === 'object' && 'detail' in payload && typeof (payload as { detail?: unknown }).detail === 'string'
        ? ` (${(payload as { detail: string }).detail})`
        : '';
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error?: unknown }).error || fallbackMessage)
        : (typeof payload === 'string' && payload.length < 200 && payload ? payload : fallbackMessage);
    const error = new Error(message + detailText) as Error & { code?: string; status?: number };
    if (payload && typeof payload === 'object') {
      const serverCode = (payload as { code?: unknown }).code;
      if (typeof serverCode === 'string') error.code = serverCode;
      const retryAfter = (payload as { retryAfter?: unknown }).retryAfter;
      if (typeof retryAfter === 'number') (error as Error & { retryAfter?: number }).retryAfter = retryAfter;
    }
    error.status = res.status;
    throw error;
  }

  if (!isJson && typeof payload === 'string') {
    throw new Error(
      'Cannot reach the Echat server. Set VITE_API_URL to your deployed backend and redeploy.'
    );
  }

  return payload as T;
}

function reelUploadAbortError() {
  return new DOMException('Upload cancelled', 'AbortError');
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs: number
) {
  if (signal?.aborted) throw reelUploadAbortError();
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (signal?.aborted) throw reelUploadAbortError();
    if (controller.signal.aborted) throw new Error('Request timed out. Check your connection and retry.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

function getHeaders(customHeaders: Record<string, string> = {}) {
  const storage = typeof window !== 'undefined' ? window.localStorage : null;
  const currentUserId = storage?.getItem('echat_user_id') || '';
  const devKey = storage?.getItem('echat_dev_key') || '';
  const pageIdentity = storage?.getItem('echat_active_page') || '';
  return {
    'Content-Type': 'application/json',
    ...(currentUserId ? { 'x-user-id': currentUserId } : {}),
    ...(devKey ? { 'x-developer-key': devKey } : {}),
    ...(pageIdentity ? { 'x-page-id': pageIdentity } : {}),
    ...customHeaders
  };
}

/**
 * Headers for private data (DMs, notifications, unread counts): the server also checks this Firebase
 * ID token, so nobody can read someone else's messages by typing their user id.
 */
async function privateHeaders(customHeaders: Record<string, string> = {}) {
  const token = await auth.currentUser?.getIdToken().catch(() => '') || '';
  return getHeaders({ ...(token ? { 'x-firebase-id-token': token } : {}), ...customHeaders });
}

/** Same auth headers, but without Content-Type so the browser sets the multipart boundary. */
function getMultipartHeaders() {
  const { 'Content-Type': _json, ...rest } = getHeaders();
  void _json;
  return rest;
}

/** Text fields + optional photo for Jobs / Events. `removeImage` clears the current photo on edit. */
export interface ListingFormInput {
  fields: Record<string, string>;
  image?: File | null;
  removeImage?: boolean;
}

function toListingFormData({ fields, image, removeImage }: ListingFormInput): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (image) form.append('image', image, image.name || 'photo.jpg');
  else if (removeImage) form.append('removeImage', 'true');
  return form;
}

async function fetchDmRequest(path: string, init: RequestInit): Promise<Response> {
  const url = apiUrl(path);
  const method = init.method || 'GET';
  try {
    const response = await fetch(url, init);
    if (!response.ok) {
      console.error('[DM] Request returned an error', { url, method, status: response.status });
    }
    return response;
  } catch (error) {
    console.error('[DM] Network request failed', {
      url,
      method,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

async function getVercelLiveHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const proof = typeof window !== 'undefined' ? window.localStorage.getItem('echat_live_auth') || '' : '';
  const currentUserId = typeof window !== 'undefined' ? window.localStorage.getItem('echat_user_id') || '' : '';
  if (auth.currentUser) {
    const firebaseIdToken = await auth.currentUser.getIdToken(forceRefresh);
    const response = await fetch(apiUrl('/api/live/auth'), { method: 'POST', headers: getHeaders({ 'x-firebase-id-token': firebaseIdToken }), body: '{}' });
    const session = await readResponse<{ liveAuthToken: string; userId: string }>(response, 'Could not refresh live sign-in');
    if (currentUserId && session.userId !== currentUserId) throw new Error('The signed-in account changed. Refresh and try again.');
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('echat_live_auth', session.liveAuthToken);
    }
    return getHeaders({ 'x-user-id': session.userId, 'x-live-auth-token': session.liveAuthToken });
  }
  return getHeaders(proof ? { 'x-live-auth-token': proof } : {});
}

/** Render's live-access/admin endpoints use a server-signed session, separate from Vercel's Firebase token. */
async function getLegacyLiveHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const proof = typeof window !== 'undefined' ? window.localStorage.getItem('echat_live_auth') || '' : '';
  const currentUserId = typeof window !== 'undefined' ? window.localStorage.getItem('echat_user_id') || '' : '';
  if (auth.currentUser) {
    const firebaseIdToken = await auth.currentUser.getIdToken(forceRefresh);
    const response = await fetch(`${LEGACY_API_URL}/api/live/auth`, {
      method: 'POST',
      headers: getHeaders({ 'x-firebase-id-token': firebaseIdToken }),
      body: '{}'
    });
    const session = await readResponse<{ liveAuthToken: string; userId: string }>(response, 'Could not refresh live sign-in');
    if (currentUserId && session.userId !== currentUserId) throw new Error('The signed-in account changed. Refresh and try again.');
    if (typeof window !== 'undefined') window.localStorage.setItem('echat_live_auth', session.liveAuthToken);
    return getHeaders({ 'x-user-id': session.userId, 'x-live-auth-token': session.liveAuthToken });
  }
  return getHeaders(proof ? { 'x-live-auth-token': proof } : {});
}

export const api = {
  /** LiveKit relay room for a 1:1 call (fallback when P2P/TURN can't connect). Vercel route. */
  async getCallRelayToken(callId: string): Promise<{ url: string; token: string; room: string }> {
    const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : '';
    const res = await fetch(apiUrl('/api/live/call-relay'), { method: 'POST', headers: idToken ? getHeaders({ 'x-firebase-id-token': idToken }) : await getVercelLiveHeaders(), body: JSON.stringify({ callId }), cache: 'no-store' });
    return readResponse<{ url: string; token: string; room: string }>(res, 'Could not start the call relay');
  },
  async getCallIceConfig(signal?: AbortSignal, userId?: string): Promise<RTCConfiguration & { provider?: string; hasTurn?: boolean; ttlSeconds?: number }> {
    const res = await fetch(apiUrl('/api/calls/ice-config'), { headers: getHeaders(userId ? { 'x-user-id': userId } : {}), cache: 'no-store', signal });
    return readResponse<RTCConfiguration & { provider?: string; hasTurn?: boolean; ttlSeconds?: number }>(res, 'Could not load call network configuration');
  },
  // File upload (profile photos, cover photos, media). Returns a loadable URL.
  /** Uploads any file (photo, video, attachment) to Cloudinary and returns its https URL. */
  async uploadFile(file: File, signal?: AbortSignal): Promise<string> {
    try {
      return await uploadToCloudinary(file, { folder: cloudinaryFolderFor(file), signal }).promise;
    } catch (error) {
      if (error instanceof UploadCancelledError) throw reelUploadAbortError();
      throw error;
    }
  },

  /**
   * Video upload with progress (posts / reels / old stories / chat videos), now via Cloudinary.
   * Same signature as before so every caller keeps working; uploadId is no longer used.
   */
  async uploadReelFile(
    file: File,
    onProgress: (percent: number, status?: string) => void,
    options: { signal?: AbortSignal; maxBytes?: number; maxAttempts?: number; chunkTimeoutMs?: number } = {}
  ): Promise<{ url: string; uploadId: string }> {
    if (file.size > Math.min(options.maxBytes ?? MAX_VIDEO_UPLOAD_BYTES, MAX_VIDEO_UPLOAD_BYTES)) throw new Error('Video must be 30MB or less');
    if (options.signal?.aborted) throw reelUploadAbortError();
    const toMb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
    try {
      const url = await uploadToCloudinary(file, {
        folder: 'echat/videos',
        signal: options.signal,
        onProgress: percent => onProgress(percent, percent >= 100 ? 'Upload complete' : `Uploading ${toMb((file.size * percent) / 100)} / ${toMb(file.size)} MB (${percent}%)`)
      }).promise;
      onProgress(100, 'Upload complete');
      return { url, uploadId: '' };
    } catch (error) {
      if (error instanceof UploadCancelledError) throw reelUploadAbortError();
      throw error;
    }
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
    return readResponse<{ user: User; token: string; liveAuthToken?: string }>(res, 'Registration failed');
  },

  async login(data: { email: string; password: string }) {
    const res = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return readResponse<{ user: User; token: string; liveAuthToken?: string }>(res, 'Login failed');
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
  async getConversationPartners(): Promise<string[]> {
    const res = await fetch(apiUrl('/api/conversations'), { headers: await privateHeaders() });
    return readResponse<string[]>(res, 'Could not load conversations');
  },
  async getDmConversations(authUserId?: string): Promise<DirectConversation[]> {
    return cachedApiRead('dm:conversations', async () => {
      const headers = authUserId ? await privateHeaders({ 'x-user-id': authUserId }) : await privateHeaders();
      const res = await fetchDmRequest('/api/dm/conversations', { headers, cache: 'no-store' });
      const data = await readResponse<{ conversations: DirectConversation[] }>(res, 'Could not load direct messages');
      return Array.isArray(data.conversations) ? data.conversations : [];
    }, authUserId);
  },
  async getDmConversation(userId: string, authUserId?: string): Promise<DirectMessage[]> {
    return cachedApiRead(`dm:conversation:${userId}`, async () => {
      const headers = authUserId ? await privateHeaders({ 'x-user-id': authUserId }) : await privateHeaders();
      const res = await fetchDmRequest(`/api/dm/${encodeURIComponent(userId)}`, { headers, cache: 'no-store' });
      return readResponse<DirectMessage[]>(res, 'Could not load this conversation');
    }, authUserId);
  },
  async sendDm(userId: string, text: string, attachments?: MessageAttachment[], authUserId?: string, replyToId?: string): Promise<DirectMessage> {
    const headers = authUserId ? await privateHeaders({ 'x-user-id': authUserId }) : await privateHeaders();
    const res = await fetchDmRequest(`/api/dm/${encodeURIComponent(userId)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, attachments, ...(replyToId ? { replyToId } : {}) })
    });
    const message = await readResponse<DirectMessage>(res, 'Could not send this message');
    invalidateApiReadCache('dm:conversations', authUserId);
    invalidateApiReadCache(`dm:conversation:${userId}`, authUserId);
    return message;
  },
  /** Edit my own text message (within 15 minutes). */
  async editDm(messageId: string, text: string): Promise<DirectMessage> {
    const res = await fetch(apiUrl(`/api/dm/message/${encodeURIComponent(messageId)}`), { method: 'PATCH', headers: await privateHeaders(), body: JSON.stringify({ text }) });
    invalidateApiReadCache('dm:conversations');
    return readResponse<DirectMessage>(res, 'Could not edit this message');
  },
  /** Delete for everyone (my own messages) or only for me. */
  async deleteDm(messageId: string, scope: 'everyone' | 'me'): Promise<void> {
    const res = await fetch(apiUrl(`/api/dm/message/${encodeURIComponent(messageId)}/delete`), { method: 'POST', headers: await privateHeaders(), body: JSON.stringify({ scope }) });
    await readResponse<{ success: boolean }>(res, 'Could not delete this message');
    invalidateApiReadCache('dm:conversations');
  },
  /** Clear chat for me only (the other person keeps their copy). */
  async clearDmChat(partnerId: string): Promise<void> {
    const res = await fetch(apiUrl(`/api/dm/${encodeURIComponent(partnerId)}/clear`), { method: 'POST', headers: await privateHeaders() });
    await readResponse<{ success: boolean }>(res, 'Could not clear this chat');
    invalidateApiReadCache('dm:conversations');
    invalidateApiReadCache(`dm:conversation:${partnerId}`);
  },
  async markDmRead(userId: string, authUserId?: string): Promise<void> {
    const headers = authUserId ? await privateHeaders({ 'x-user-id': authUserId }) : await privateHeaders();
    const res = await fetchDmRequest(`/api/dm/${encodeURIComponent(userId)}/read`, { method: 'POST', headers });
    await readResponse<{ success: boolean }>(res, 'Could not mark messages as read');
    invalidateApiReadCache('dm:conversations', authUserId);
    invalidateApiReadCache(`dm:conversation:${userId}`, authUserId);
  },
  async getSiteConfig(): Promise<import('../types').SiteConfig> {
    const res = await fetch(apiUrl('/api/site-config'));
    return readResponse<import('../types').SiteConfig>(res, 'Could not load welcome page settings');
  },
  async updateSiteConfig(config: import('../types').SiteConfig): Promise<import('../types').SiteConfig> {
    const res = await fetch(apiUrl('/api/admin/site-config'), { method: 'PUT', headers: getHeaders(), body: JSON.stringify(config) });
    return readResponse<import('../types').SiteConfig>(res, 'Could not save welcome page settings');
  },

  async getUserProfile(id: string): Promise<{ user: User; posts: Post[]; reels?: Post[]; friends: User[] }> {
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
    return cachedApiRead('posts', async () => {
      try {
        const res = await fetch(apiUrl('/api/posts'), { headers: getHeaders() });
        if (!res.ok) return [];
        const data = await readResponse<{ posts: Post[]; nextCursor: string | null }>(res);
        return Array.isArray(data.posts) ? data.posts : [];
      } catch {
        return [];
      }
    });
  },
  async getPostsPage(cursor?: string): Promise<{ posts: Post[]; nextCursor: string | null }> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const res = await fetch(apiUrl(`/api/posts${query}`), { headers: getHeaders(), cache: 'no-store' });
    const data = await readResponse<{ posts: Post[]; nextCursor: string | null }>(res, 'Could not load posts');
    if (!Array.isArray(data.posts) || (data.nextCursor !== null && typeof data.nextCursor !== 'string')) throw new Error('The server returned an invalid feed page. Refresh and try again.');
    return data;
  },
  async getReels(cursor?: string): Promise<{ reels: Post[]; nextCursor: string | null }> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const res = await fetch(apiUrl(`/api/reels${query}`), { headers: getHeaders(), cache: 'no-store' });
    const data = await readResponse<{ reels: Post[]; nextCursor: string | null }>(res, 'Could not load Reels');
    if (!data || !Array.isArray(data.reels) || (data.nextCursor !== null && typeof data.nextCursor !== 'string')) {
      throw new Error('The server returned an invalid Reels page. Refresh to try again.');
    }
    return data;
  },
  async getDashboard(): Promise<DashboardResponse> {
    return cachedApiRead<DashboardResponse>('dashboard', async () => {
      const res = await fetch(apiUrl('/api/dashboard'), { headers: getHeaders() });
      return readResponse<DashboardResponse>(res, 'Could not load dashboard');
    });
  },

  async createPost(data: {
    content: string;
    mediaUrl?: string;
    mediaUrls?: string[];
    images?: string[];
    imagesCount?: number;
    v2?: { feeling?: string; privacy?: 'public' | 'friends' | 'only_me'; [key: string]: unknown };
    mediaType?: 'image' | 'video' | 'audio';
    type?: 'post' | 'reel';
    thumbnailUrl?: string;
    mediaDuration?: number;
    mediaSize?: number;
    feeling?: string;
    privacy?: 'public' | 'friends' | 'only_me';
    taggedUserIds?: string[];
  }, signal?: AbortSignal): Promise<Post> {
    const res = await fetchWithTimeout(apiUrl('/api/posts'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
      signal
    }, signal, 60_000);
    const post = await readResponse<Post>(res, 'Failed to create post');
    invalidateApiReadCache('posts');
    invalidateApiReadCache('dashboard');
    return post;
  },

  async toggleSavePost(postId: string): Promise<{ saved: boolean; savedPosts: string[] }> {
    const res = await fetch(apiUrl(`/api/posts/${postId}/save`), { method: 'POST', headers: getHeaders() });
    return readResponse<{ saved: boolean; savedPosts: string[] }>(res, 'Could not save this post');
  },
  async recordPostView(postId: string): Promise<{ viewsCount: number }> {
    const res = await fetch(apiUrl(`/api/posts/${postId}/view`), { method: 'POST', headers: getHeaders() });
    return readResponse<{ viewsCount: number }>(res, 'Could not record post view');
  },
  async getPostViewers(postId: string): Promise<{ id: string; name: string; avatar: string; viewedAt: number }[]> {
    const res = await fetch(apiUrl(`/api/posts/${postId}/viewers`), { headers: getHeaders() });
    return readResponse<{ id: string; name: string; avatar: string; viewedAt: number }[]>(res, 'Could not load post viewers');
  },
  async getSavedPosts(): Promise<Post[]> {
    const res = await fetch(apiUrl('/api/saved'), { headers: getHeaders() });
    return readResponse<Post[]>(res, 'Could not load saved posts');
  },
  async getTrending(): Promise<{ tag: string; count: number }[]> {
    try {
      const res = await fetch(apiUrl('/api/trending'), { headers: getHeaders() });
      if (!res.ok) return [];
      return await readResponse<{ tag: string; count: number }[]>(res);
    } catch {
      return [];
    }
  },
  async editPost(postId: string, data: { content?: string; privacy?: 'public' | 'friends' | 'only_me'; feeling?: string }): Promise<Post> {
    const res = await fetch(apiUrl(`/api/posts/${postId}`), { method: 'PUT', headers: getHeaders(), body: JSON.stringify(data) });
    const post = await readResponse<Post>(res, 'Failed to edit post');
    invalidateApiReadCache('posts');
    invalidateApiReadCache('dashboard');
    return post;
  },
  async reactToPost(postId: string, type: ReactionType | string): Promise<Post> {
    const res = await fetch(apiUrl(`/api/posts/${postId}/react`), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ type })
    });
    const post = await readResponse<Post>(res);
    invalidateApiReadCache('posts');
    invalidateApiReadCache('dashboard');
    return post;
  },

  async commentPost(postId: string, content: string, audio?: { url: string; duration: number }): Promise<Post> {
    const res = await fetch(apiUrl(`/api/posts/${postId}/comment`), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(audio ? { content, audioUrl: audio.url, audioDuration: audio.duration } : { content })
    });
    const post = await readResponse<Post>(res, 'Failed to post comment');
    invalidateApiReadCache('posts');
    invalidateApiReadCache('dashboard');
    return post;
  },

  /** Without options: counts a share made outside Echat. With toTimeline: re-shares onto your own timeline. */
  async sharePost(
    postId: string,
    options?: { toTimeline?: boolean; comment?: string; privacy?: 'public' | 'friends' | 'only_me' }
  ): Promise<{ success: boolean; sharesCount?: number; post?: Post }> {
    const res = await fetch(apiUrl(`/api/posts/${postId}/share`), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(options ?? {})
    });
    const result = await readResponse<{ success: boolean; sharesCount?: number; post?: Post }>(res, 'Could not share this post');
    invalidateApiReadCache('posts');
    invalidateApiReadCache('dashboard');
    return result;
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
    const result = await readResponse(res);
    invalidateApiReadCache('posts');
    invalidateApiReadCache('dashboard');
    return result;
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

  async viewStory(id: string): Promise<{ success: boolean; story: Story | null }> {
    const res = await fetch(apiUrl(`/api/stories/${id}/view`), {
      method: 'POST',
      headers: getHeaders()
    });
    return readResponse<{ success: boolean; story: Story | null }>(res);
  },

  // Messages
  async getMessages(partnerId: string): Promise<Message[]> {
    return cachedApiRead(`messages:${partnerId}`, async () => {
      try {
        const res = await fetch(apiUrl(`/api/messages/${partnerId}`), { headers: await privateHeaders() });
        if (!res.ok) return [];
        const data = await readResponse<Message[]>(res);
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    });
  },

  async sendMessage(data: {
    receiverId: string;
    text?: string;
    mediaUrl?: string;
    mediaType?: 'image' | 'video' | 'audio';
    audioDuration?: number;
    attachments?: MessageAttachment[];
    v2_market_order?: Message['v2_market_order'];
  }): Promise<Message> {
    const res = await fetch(apiUrl('/api/messages'), {
      method: 'POST',
      headers: await privateHeaders(),
      body: JSON.stringify(data)
    });
    const message = await readResponse<Message>(res);
    invalidateApiReadCache(`messages:${data.receiverId}`);
    return message;
  },

  async editMessage(messageId: string, text: string): Promise<Message> {
    const res = await fetch(apiUrl(`/api/messages/${messageId}`), { method: 'PUT', headers: await privateHeaders(), body: JSON.stringify({ text }) });
    return readResponse<Message>(res, 'Could not edit this message');
  },

  async deleteMessage(messageId: string): Promise<void> {
    const res = await fetch(apiUrl(`/api/messages/${messageId}`), { method: 'DELETE', headers: await privateHeaders() });
    await readResponse<{ success: boolean }>(res, 'Could not delete this message');
  },

  async markMessagesSeen(partnerId: string) {
    const res = await fetch(apiUrl('/api/messages/seen'), {
      method: 'POST',
      headers: await privateHeaders(),
      body: JSON.stringify({ partnerId })
    });
    const result = await readResponse(res);
    invalidateApiReadCache('notifications');
    // lets the navbar refresh its unread-message badge straight away
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('echat:messages-seen'));
    return result;
  },

  // Notifications
  /** Unread messages + unread notifications (the same numbers the live badges show). */
  async getUnreadCounts(): Promise<{ messages: number; notifications: number }> {
    const res = await fetch(apiUrl('/api/unread'), { headers: await privateHeaders(), cache: 'no-store' });
    return readResponse<{ messages: number; notifications: number }>(res, 'Could not load unread counts');
  },
  /** Tell the owner about a like / comment stored in Firestore (Marketplace item, profile picture). */
  async notifyActivity(kind: 'market_like' | 'photo_like' | 'photo_comment', targetId: string): Promise<void> {
    await fetch(apiUrl('/api/notifications/notify'), { method: 'POST', headers: await privateHeaders(), body: JSON.stringify({ kind, targetId }) }).catch(() => {});
    invalidateApiReadCache('notifications');
  },
  async getBirthdays(): Promise<{ user: User; daysUntil: number; turns?: number }[]> {
    const res = await fetch(apiUrl('/api/birthdays'), { headers: getHeaders() });
    return readResponse<{ user: User; daysUntil: number; turns?: number }[]>(res, 'Failed to load birthdays');
  },

  async getNotifications(): Promise<Notification[]> {
    return cachedApiRead('notifications', async () => {
      try {
        const res = await fetch(apiUrl('/api/notifications'), { headers: await privateHeaders() });
        if (!res.ok) {
          return [];
        }
        const data = await readResponse<Notification[]>(res, 'Failed to get notifications');
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    });
  },

  async markNotificationsRead(options: { exceptMessages?: boolean } = {}) {
    const res = await fetch(apiUrl('/api/notifications/read'), {
      method: 'POST',
      headers: await privateHeaders(),
      body: JSON.stringify(options)
    });
    if (res.status === 401) {
      return { success: true };
    }
    const result = await readResponse(res);
    invalidateApiReadCache('notifications');
    return result;
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

  async claimAdmin(setupPassword: string): Promise<{ user: User }> {
    const res = await fetch(apiUrl('/api/admin/claim'), { method: 'POST', headers: getHeaders(), body: JSON.stringify({ setupPassword }) });
    return readResponse<{ user: User }>(res, 'Could not claim admin access');
  },
  async getAdminAnalytics(days = 14): Promise<AdminAnalytics> {
    const res = await fetch(apiUrl(`/api/admin/analytics?days=${days}`), { headers: getHeaders() });
    return readResponse<AdminAnalytics>(res, 'Could not load analytics');
  },
  async getAdminSystem(): Promise<AdminSystemInfo> {
    const res = await fetch(apiUrl('/api/admin/system'), { headers: getHeaders() });
    return readResponse<AdminSystemInfo>(res, 'Could not load system status');
  },
  async getAdminAudit(limit = 300): Promise<AuditEntry[]> {
    const res = await fetch(apiUrl(`/api/admin/audit?limit=${limit}`), { headers: getHeaders() });
    return readResponse<AuditEntry[]>(res, 'Could not load the activity log');
  },
  async sendAnnouncement(message: string): Promise<{ success: boolean; sent: number }> {
    const res = await fetch(apiUrl('/api/admin/announce'), { method: 'POST', headers: getHeaders(), body: JSON.stringify({ message }) });
    return readResponse<{ success: boolean; sent: number }>(res, 'Could not send the announcement');
  },
  async toggleVerifyUser(userId: string): Promise<User> {
    const res = await fetch(apiUrl(`/api/admin/users/${userId}/verify`), { method: 'POST', headers: getHeaders() });
    return readResponse<User>(res, 'Could not change verification');
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

  // Admin-controlled Go-Live access
  async getLiveAccess(forceRefresh = false): Promise<{ liveAccess: NonNullable<User['liveAccess']>; mode: LiveAccessMode; canGoLive: boolean; request: LiveAccessRequest | null; accountAgeDays: number; daysUntilEligible: number; autoApproved: boolean }> {
    const res = await fetch(LEGACY_API_URL + '/api/live/access', { headers: await getLegacyLiveHeaders(forceRefresh) });
    return readResponse(res, 'Could not check Go Live access');
  },

  async requestLiveAccess(reason: string): Promise<{ success: boolean; liveAccess: 'pending'; request: LiveAccessRequest }> {
    const res = await fetch(LEGACY_API_URL + '/api/live/request', { method: 'POST', headers: await getLegacyLiveHeaders(), body: JSON.stringify({ reason }) });
    return readResponse(res, 'Could not send Go Live request');
  },

  async cancelLiveAccessRequest(): Promise<{ success: boolean; liveAccess: 'none' }> {
    const res = await fetch(LEGACY_API_URL + '/api/live/request/cancel', { method: 'POST', headers: await getLegacyLiveHeaders() });
    return readResponse(res, 'Could not cancel Go Live request');
  },

  async getAdminLiveAccess(): Promise<{ requests: LiveAccessRequest[]; mode: LiveAccessMode; users: User[] }> {
    const res = await fetch(LEGACY_API_URL + '/api/admin/live-access', { headers: await getLegacyLiveHeaders() });
    return readResponse(res, 'Could not load Go Live access requests');
  },

  async reviewLiveAccessRequest(requestId: string, decision: 'approved' | 'rejected' | 'blocked'): Promise<void> {
    const res = await fetch(LEGACY_API_URL + `/api/admin/live-access/requests/${encodeURIComponent(requestId)}/review`, { method: 'POST', headers: await getLegacyLiveHeaders(), body: JSON.stringify({ decision }) });
    await readResponse(res, 'Could not review Go Live request');
  },

  async updateUserLiveAccess(userId: string, action: 'grant' | 'revoke' | 'block' | 'unblock'): Promise<User> {
    const res = await fetch(LEGACY_API_URL + `/api/admin/live-access/users/${encodeURIComponent(userId)}`, { method: 'POST', headers: await getLegacyLiveHeaders(), body: JSON.stringify({ action }) });
    return readResponse(res, 'Could not change user Go Live access');
  },

  async updateLiveAccessMode(mode: LiveAccessMode): Promise<void> {
    const res = await fetch(LEGACY_API_URL + '/api/admin/live-access/settings', { method: 'PUT', headers: await getLegacyLiveHeaders(), body: JSON.stringify({ mode }) });
    await readResponse(res, 'Could not update Go Live settings');
  },

  // Live broadcast system
  /** The newest live that is on air now, or a specific one by host id / stream id (share links). */
  async getCurrentLive(id?: string): Promise<{ live: LiveStream | null }> {
    const path = id ? `/api/live/current?id=${encodeURIComponent(id)}` : '/api/live/current';
    return cachedApiRead(id ? `live:current:${id}` : 'live:current', async () => {
      const res = await fetch(apiUrl(path), { headers: getHeaders(), cache: 'no-store' });
      if (!res.ok) return { live: null };
      return readResponse<{ live: LiveStream | null }>(res);
    });
  },

  /** Streaming software: is MY OBS / RTMP app on air right now? (asks LiveKit; starts / ends the live to match) */
  async getRtmpStatus(): Promise<{ publishing: boolean; ingressStatus: number; hasIngress: boolean; held: boolean; live: LiveStream | null; input?: { videoKbps: number; width: number; height: number; framerate: number; audioKbps: number; channels: number; sampleRate: number } | null }> {
    const res = await fetch(apiUrl('/api/live/rtmp-status'), { headers: await getVercelLiveHeaders(), cache: 'no-store' });
    return readResponse(res, 'Could not check your streaming app');
  },

  /** Re-check which lives are on air (server also confirms streaming-app lives with LiveKit). Not cached. */
  async syncLives(): Promise<void> {
    await fetch(apiUrl('/api/live/current'), { cache: 'no-store' }).catch(() => undefined);
  },

  /** One host's live right now, never cached (player). status: 'live' | 'ended' | 'missing'. */
  async getLiveState(id: string): Promise<{ live: LiveStream | null; state?: { status: 'live' | 'ended' | 'missing'; endedAt: number | null; stale: boolean; hostId?: string } }> {
    const res = await fetch(apiUrl(`/api/live/current?id=${encodeURIComponent(id)}`), { cache: 'no-store' });
    return readResponse(res, 'Could not check this live');
  },

  /** Like (1) / dislike (-1) / clear (0) a live; returns my vote + live counts. value omitted = just read. */
  async voteLive(streamId: string, value?: 1 | -1 | 0): Promise<{ myVote: number; likesCount: number; dislikesCount: number }> {
    const res = value === undefined
      ? await fetch(apiUrl(`/api/live/like?streamId=${encodeURIComponent(streamId)}`), { headers: await getVercelLiveHeaders(), cache: 'no-store' })
      : await fetch(apiUrl('/api/live/like'), { method: 'POST', headers: await getVercelLiveHeaders(), body: JSON.stringify({ streamId, value }) });
    return readResponse(res, 'Could not update your like');
  },

  /** Host heartbeat (every 10 s while live). Throws an error with code 'live-ended' (410) when the live is over. */
  async sendLiveHeartbeat(streamId: string): Promise<void> {
    const res = await fetch(apiUrl('/api/live/heartbeat'), { method: 'POST', headers: await getVercelLiveHeaders(), body: JSON.stringify({ streamId }), cache: 'no-store' });
    await readResponse(res, 'Live heartbeat failed');
  },

  /** End my live while the page is closing (keepalive, cached sign-in token). */
  async endLiveOnPageClose(streamId: string): Promise<void> {
    const idToken = await auth.currentUser?.getIdToken().catch(() => '') || '';
    if (!idToken) return;
    await fetch(apiUrl('/api/live/end'), { method: 'POST', headers: getHeaders({ 'x-firebase-id-token': idToken }), body: JSON.stringify({ streamId }), keepalive: true }).catch(() => undefined);
  },

  async startLive(title?: string, taggedPageIds: string[] = [], options: { category?: string; location?: string } = {}): Promise<{ success: boolean; live: LiveStream; liveKitUrl?: string; liveKitToken?: string }> {
    const res = await fetch(apiUrl('/api/live/start'), {
      method: 'POST',
      headers: await getVercelLiveHeaders(),
      body: JSON.stringify({ title, taggedPageIds, ...options })
    });
    const result = await readResponse<{ success: boolean; live: LiveStream; liveKitUrl?: string; liveKitToken?: string }>(res, 'Failed to start live stream');
    invalidateApiReadCache('live:current');
    return result;
  },

  async stopLive(streamId?: string, signal?: AbortSignal): Promise<{ success: boolean; live?: LiveStream }> {
    const res = await fetch(apiUrl('/api/live/end'), {
      method: 'POST',
      headers: await getVercelLiveHeaders(),
      body: JSON.stringify({ streamId }),
      signal
    });
    const result = await readResponse<{ success: boolean; live?: LiveStream }>(res);
    invalidateApiReadCache('live:current');
    return result;
  },

  async getLiveStreamKey(): Promise<{ success: boolean; streamKey: string; serverUrl: string; ingestConfigured: boolean }> {
    const res = await fetch(apiUrl('/api/live/stream-key'), {
      headers: await getVercelLiveHeaders(),
      cache: 'no-store'
    });
    return readResponse(res, 'Could not load your stream key');
  },

  async resetLiveStreamKey(): Promise<{ success: boolean; streamKey: string; serverUrl: string; ingestConfigured: boolean }> {
    const res = await fetch(apiUrl('/api/live/stream-key/reset'), {
      method: 'POST',
      headers: await getVercelLiveHeaders(),
      body: JSON.stringify({})
    });
    return readResponse(res, 'Could not reset your stream key');
  },

  /** Viewer token for the host's CURRENT live room (looked up by host on the server). */
  async getLiveKitViewerToken(streamId: string, hostId?: string): Promise<{ url: string; token: string; streamId?: string }> {
    const params = new URLSearchParams({ streamId, ...(hostId ? { hostId } : {}) });
    const res = await fetch(apiUrl(`/api/live/watch?${params}`), { headers: await getVercelLiveHeaders(), cache: 'no-store' });
    return readResponse(res, 'Could not join this live stream');
  },

  async getLiveKitHostToken(streamId: string): Promise<{ url: string; token: string }> {
    const res = await fetch(apiUrl('/api/live/publish'), { method: 'POST', headers: await getVercelLiveHeaders(), body: JSON.stringify({ streamId }), cache: 'no-store' });
    return readResponse(res, 'Could not publish your live broadcast');
  },

  /** Which live settings the server has (booleans only). */
  async getLiveConfigStatus(): Promise<{ ready: boolean; missing: string[]; liveKitUrlLooksValid: boolean; webhookUrl: string; liveKitAuthOk?: boolean | null; liveKitError?: string }> {
    const res = await fetch(apiUrl('/api/live/status'), { cache: 'no-store' });
    return readResponse(res, 'Could not check the live server configuration');
  },

  /** Count this user as a viewer of a LiveKit live (one per account). */
  async joinLiveStream(streamId: string): Promise<{ success: boolean; viewersCount: number }> {
    const res = await fetch(apiUrl('/api/live/viewer/join'), { method: 'POST', headers: await getVercelLiveHeaders(), body: JSON.stringify({ streamId }), cache: 'no-store' });
    return readResponse(res, 'Could not join this live stream');
  },

  /** Leave a live. keepalive lets it finish while the page closes. */
  async leaveLiveStream(streamId: string): Promise<void> {
    // Cached Firebase ID token (no extra round trip), so this also works while the page is closing.
    const idToken = await auth.currentUser?.getIdToken().catch(() => '') || '';
    if (!idToken) return;
    await fetch(apiUrl('/api/live/viewer/leave'), { method: 'POST', headers: getHeaders({ 'x-firebase-id-token': idToken }), body: JSON.stringify({ streamId }), keepalive: true }).catch(() => undefined);
  },

  /** Send a batch of hearts / reactions for a LiveKit live. */
  async sendLiveStreamReaction(streamId: string, emoji: string, count: number): Promise<void> {
    const res = await fetch(apiUrl('/api/live/react'), { method: 'POST', headers: await getVercelLiveHeaders(), body: JSON.stringify({ streamId, emoji, count }) });
    await readResponse(res, 'Could not send reaction');
  },

  async getRtmpStreamDetails(): Promise<{ title: string; category: string; location: string }> {
    const res = await fetch(apiUrl('/api/live/rtmp-details'), { headers: await getVercelLiveHeaders(), cache: 'no-store' });
    return readResponse(res, 'Could not load your stream details');
  },

  async saveRtmpStreamDetails(details: { title: string; category: string; location: string }): Promise<{ title: string; category: string; location: string }> {
    const res = await fetch(apiUrl('/api/live/rtmp-details'), { method: 'POST', headers: await getVercelLiveHeaders(), body: JSON.stringify(details) });
    return readResponse(res, 'Could not save your stream details');
  },

  async sendLiveComment(text: string): Promise<{ success: boolean; comment: LiveComment }> {
    const res = await fetch(LEGACY_API_URL + '/api/live/comment', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ text })
    });
    return readResponse(res, 'Failed to send comment');
  },

  async sendLiveReaction(emoji: string): Promise<{ success: boolean; reactionsCount: number }> {
    const res = await fetch(LEGACY_API_URL + '/api/live/reaction', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ emoji })
    });
    return readResponse(res);
  },

  async joinLive(): Promise<{ success: boolean; viewersCount: number }> {
    const res = await fetch(LEGACY_API_URL + '/api/live/join', {
      method: 'POST',
      headers: getHeaders()
    });
    return readResponse(res);
  },

  async leaveLive(): Promise<{ success: boolean; viewersCount: number }> {
    const res = await fetch(LEGACY_API_URL + '/api/live/leave', {
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
  async getMyPages(): Promise<Page[]> {
    const res = await fetch(apiUrl('/api/my-pages'), { headers: getHeaders() });
    return readResponse<Page[]>(res, 'Could not load your pages');
  },

  async createPage(data: { name: string; category: string; bio: string; cover: string; avatar?: string }): Promise<Page> {
    const res = await fetch(apiUrl('/api/pages'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return readResponse<Page>(res, 'Failed to create page');
  },

  async updatePage(pageId: string, data: { name?: string; category?: string; bio?: string; avatar?: string; cover?: string }): Promise<Page> {
    const res = await fetch(apiUrl(`/api/pages/${pageId}`), { method: 'PUT', headers: getHeaders(), body: JSON.stringify(data) });
    return readResponse<Page>(res, 'Could not update the page');
  },
  async updateGroup(groupId: string, data: { name?: string; description?: string; privacy?: 'public' | 'private'; avatar?: string; cover?: string }): Promise<Group> {
    const res = await fetch(apiUrl(`/api/groups/${groupId}`), { method: 'PUT', headers: getHeaders(), body: JSON.stringify(data) });
    return readResponse<Group>(res, 'Could not update the group');
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

  async createEventWithPhoto(input: ListingFormInput): Promise<EventItem> {
    const res = await fetch(apiUrl('/api/events'), { method: 'POST', headers: getMultipartHeaders(), body: toListingFormData(input) });
    return readResponse<EventItem>(res, 'Failed to create event');
  },

  async updateEvent(eventId: string, input: ListingFormInput): Promise<EventItem> {
    const res = await fetch(apiUrl(`/api/events/${eventId}`), { method: 'PUT', headers: getMultipartHeaders(), body: toListingFormData(input) });
    return readResponse<EventItem>(res, 'Failed to update event');
  },

  async deleteEvent(eventId: string): Promise<{ success: boolean }> {
    const res = await fetch(apiUrl(`/api/events/${eventId}`), { method: 'DELETE', headers: getHeaders() });
    return readResponse<{ success: boolean }>(res, 'Failed to delete event');
  },

  // Jobs
  async getJobs(): Promise<JobItem[]> {
    const res = await fetch(apiUrl('/api/jobs'), { headers: getHeaders() });
    const data = await readResponse<JobItem[]>(res, 'Could not load jobs');
    return Array.isArray(data) ? data : [];
  },

  async createJob(input: ListingFormInput): Promise<JobItem> {
    const res = await fetch(apiUrl('/api/jobs'), { method: 'POST', headers: getMultipartHeaders(), body: toListingFormData(input) });
    return readResponse<JobItem>(res, 'Failed to post job');
  },

  async updateJob(jobId: string, input: ListingFormInput): Promise<JobItem> {
    const res = await fetch(apiUrl(`/api/jobs/${jobId}`), { method: 'PUT', headers: getMultipartHeaders(), body: toListingFormData(input) });
    return readResponse<JobItem>(res, 'Failed to update job');
  },

  async deleteJob(jobId: string): Promise<{ success: boolean }> {
    const res = await fetch(apiUrl(`/api/jobs/${jobId}`), { method: 'DELETE', headers: getHeaders() });
    return readResponse<{ success: boolean }>(res, 'Failed to delete job');
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
