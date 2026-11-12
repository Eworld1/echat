import { API_URL, LEGACY_API_URL, apiUrl, assetUrl } from './apiBase';
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
  EventItem
} from '../types';
import { auth } from './firebase';

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

async function getLiveHeaders(forceRefresh = false): Promise<Record<string, string>> {
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

export const api = {
  async getCallIceConfig(): Promise<RTCConfiguration> {
    const res = await fetch(apiUrl('/api/calls/ice-config'), { headers: getHeaders(), cache: 'no-store' });
    return readResponse<RTCConfiguration>(res, 'Could not load call network configuration');
  },
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

  async uploadReelFile(file: File, onProgress: (percent: number, status?: string) => void): Promise<{ url: string; uploadId: string }> {
    const maxBytes = 250 * 1024 * 1024;
    if (file.size > maxBytes) throw new Error('Video too large - Max 250MB. Please compress or trim your video.');
    if (!API_URL && typeof window !== 'undefined' && window.location.hostname.endsWith('.vercel.app')) {
      throw new Error('Reel uploads need the backend URL. Set VITE_API_URL to your deployed backend in Vercel, then redeploy the frontend.');
    }
    const resumeKey = `echat_reel_upload:${file.name}:${file.size}:${file.lastModified}`;
    const savedId = typeof window !== 'undefined' ? window.localStorage.getItem(resumeKey) : null;
    const headers = getHeaders();
    let uploadId = savedId || '';
    let uploadState: { uploadId: string; fileName: string; mimeType: string; size: number; chunkSize: number; totalChunks: number; receivedChunks: number[]; completedUrl?: string } | null = null;

    if (uploadId) {
      let response: Response;
      try {
        response = await fetch(apiUrl(`/api/reels/upload/${encodeURIComponent(uploadId)}`), { headers });
      } catch {
        throw new Error(typeof navigator !== 'undefined' && !navigator.onLine ? 'You are offline. Check your connection and tap Retry.' : 'Could not check saved Reel progress. Your upload is preserved; tap Retry when your connection is stable.');
      }
      if (response.ok) uploadState = await response.json();
      else if (response.status === 404) uploadId = '';
      else if (response.status === 401) throw new Error('Your session expired. Sign in again, then tap Retry to resume.');
      else if (response.status === 413) throw new Error('File too large - Max 250MB.');
      else throw new Error(response.status >= 500 ? 'Server error while checking Reel upload progress. Please try again in 1 min.' : `Could not check Reel upload progress (HTTP ${response.status}). Tap Retry to resume.`);
      if (uploadState && (uploadState.size !== file.size || uploadState.fileName !== file.name)) uploadId = '';
      if (!uploadId && typeof window !== 'undefined') window.localStorage.removeItem(resumeKey);
      if (uploadState?.completedUrl) {
        if (typeof window !== 'undefined') window.localStorage.removeItem(resumeKey);
        onProgress(100);
        return { url: assetUrl(uploadState.completedUrl), uploadId };
      }
    }

    const startUpload = async () => {
      const response = await fetch(apiUrl('/api/reels/upload/init'), {
        method: 'POST', headers,
        body: JSON.stringify({ fileName: file.name, mimeType: file.type || 'video/mp4', size: file.size })
      });
      const init = await readResponse<{ uploadId: string; chunkSize: number; totalChunks: number }>(response, 'Could not start Reel upload');
      uploadId = init.uploadId;
      if (typeof window !== 'undefined') window.localStorage.setItem(resumeKey, uploadId);
      uploadState = { uploadId, fileName: file.name, mimeType: file.type, size: file.size, chunkSize: init.chunkSize, totalChunks: init.totalChunks, receivedChunks: [] };
    };
    if (!uploadId) await startUpload();

    if (!uploadState) throw new Error('Upload session unavailable. Tap Retry to resume.');
    let received = new Set(uploadState.receivedChunks || []);
    console.info('[Echat] Resuming Reel upload', { uploadId, lastSuccessfulChunk: received.size ? Math.max(...received) : -1 });
    let completedBytes = Array.from(received).reduce((sum, index) => sum + Math.min(uploadState!.chunkSize, file.size - index * uploadState!.chunkSize), 0);
    const progressStatus = (bytes: number) => `Uploading ${(bytes / (1024 * 1024)).toFixed(1)} MB / ${(file.size / (1024 * 1024)).toFixed(1)} MB`;
    onProgress(Math.min(99, Math.round((completedBytes / file.size) * 100)), progressStatus(completedBytes));
    const uploadChunk = (index: number): Promise<void> => new Promise((resolve, reject) => {
      const start = index * uploadState!.chunkSize;
      const chunk = file.slice(start, Math.min(file.size, start + uploadState!.chunkSize));
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', apiUrl(`/api/reels/upload/${encodeURIComponent(uploadId)}/chunk/${index}`));
      xhr.timeout = 10 * 60 * 1000;
      Object.entries(getHeaders({ 'Content-Type': 'application/octet-stream' })).forEach(([name, value]) => xhr.setRequestHeader(name, value));
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) {
          const loadedBytes = completedBytes + event.loaded;
          onProgress(Math.min(99, Math.round((loadedBytes / file.size) * 100)), progressStatus(loadedBytes));
        }
      };
      xhr.onerror = () => {
        const message = typeof navigator !== 'undefined' && !navigator.onLine ? 'You are offline. Check your connection and retry this chunk.' : `Connection dropped while sending chunk ${index + 1}. Its progress is saved; tap Retry to resume.`;
        console.error('[Echat] Reel chunk transport error', { uploadId, chunkIndex: index, status: xhr.status, error: message });
        reject(new Error(message));
      };
      xhr.ontimeout = () => {
        const message = 'Upload timed out - your connection is slow. Tap Retry to resume.';
        console.error('[Echat] Reel chunk timeout', { uploadId, chunkIndex: index, status: xhr.status, error: message });
        reject(new Error(message));
      };
      xhr.onload = () => {
        let payload: { error?: string } = {};
        try { payload = JSON.parse(xhr.responseText); } catch { /* use fallback below */ }
        if (xhr.status < 200 || xhr.status >= 300) {
          const message = xhr.status === 413 ? 'File too large - Max 250MB.' : xhr.status >= 500 ? 'Server error while uploading. Please try again in 1 min.' : payload.error || `Upload chunk failed (HTTP ${xhr.status}). Tap Retry to resume.`;
          console.error('[Echat] Reel chunk response error', { uploadId, chunkIndex: index, status: xhr.status, error: message });
          reject(new Error(message));
        }
        else resolve();
      };
      xhr.send(chunk);
    });

    let index = 0;
    let sessionRestarts = 0;
    while (index < uploadState.totalChunks) {
      if (received.has(index)) { index++; continue; }
      let lastError: unknown;
      let restartSession = false;
      for (let attempt = 0; attempt < 9; attempt++) {
        try { await uploadChunk(index); lastError = null; break; }
        catch (error) {
          lastError = error;
          const message = error instanceof Error ? error.message : String(error);
          console.error('[Echat] Reel chunk upload failed', { uploadId, chunkIndex: index, attempt: attempt + 1, error: message });
          // The server may have stored the chunk even when its response was
          // lost (common on mobile networks). Check durable progress before
          // retrying, so we don't report a false failure or resend it forever.
          try {
            const statusResponse = await fetch(apiUrl(`/api/reels/upload/${encodeURIComponent(uploadId)}`), { headers });
            if (statusResponse.ok) {
              const status = await statusResponse.json() as { receivedChunks?: number[] };
              if (status.receivedChunks?.includes(index)) {
                lastError = null;
                break;
              }
            } else if (statusResponse.status === 401) {
              throw new Error('Your session expired. Sign in again, then tap Retry to resume.');
            } else if (statusResponse.status === 404) {
              if (sessionRestarts >= 2) throw new Error('The upload session keeps disappearing. Confirm the backend uses one shared persistent upload disk, then retry.');
              await startUpload();
              sessionRestarts++;
              received = new Set<number>();
              completedBytes = 0;
              index = 0;
              onProgress(0, 'Reconnecting upload session…');
              restartSession = true;
              lastError = null;
              break;
            }
          } catch (statusError) {
            if (statusError instanceof Error && statusError.message.startsWith('Your session expired')) throw statusError;
            if (statusError instanceof Error && statusError.message.startsWith('Could not start Reel upload')) throw statusError;
            if (statusError instanceof Error && statusError.message.startsWith('The upload session keeps disappearing')) throw statusError;
          }
          if (attempt < 8) {
            const delay = Math.min(20_000, 1000 * (2 ** Math.min(attempt, 4))) + Math.floor(Math.random() * 500);
            onProgress(Math.min(99, Math.round((completedBytes / file.size) * 100)), `Reconnecting and resuming chunk ${index + 1}/${uploadState!.totalChunks}…`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      if (restartSession) continue;
      if (lastError) throw lastError instanceof Error ? lastError : new Error('Reel upload failed. Progress is saved; tap Retry to resume.');
      received.add(index);
      const sentBytes = Array.from(received).reduce((sum, part) => sum + Math.min(uploadState!.chunkSize, file.size - part * uploadState!.chunkSize), 0);
      onProgress(Math.min(99, Math.round((sentBytes / file.size) * 100)), progressStatus(sentBytes));
      index++;
    }

    let completeResponse: Response;
    try {
      completeResponse = await fetch(apiUrl(`/api/reels/upload/${encodeURIComponent(uploadId)}/complete`), { method: 'POST', headers, body: '{}' });
    } catch {
      throw new Error(typeof navigator !== 'undefined' && !navigator.onLine ? 'You are offline. The uploaded chunks are saved; reconnect and tap Retry to finish.' : 'Connection dropped while finalizing. The uploaded chunks are saved; tap Retry to finish.');
    }
    if (!completeResponse.ok) {
      const details = await completeResponse.json().catch(() => ({})) as { error?: string };
      const message = completeResponse.status === 413 ? 'File too large - Max 250MB.' : completeResponse.status >= 500 ? 'Server error while finishing the upload. Please try again in 1 min.' : details.error || 'Could not finish Reel upload. Tap Retry to resume.';
      throw new Error(message);
    }
    const result = await completeResponse.json() as { url: string };
    if (typeof window !== 'undefined') window.localStorage.removeItem(resumeKey);
    onProgress(100, 'Upload complete');
    return { url: assetUrl(result.url), uploadId };
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
  async getConversationPartners(): Promise<string[]> {
    const res = await fetch(apiUrl('/api/conversations'), { headers: getHeaders() });
    return readResponse<string[]>(res, 'Could not load conversations');
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
    try {
      const res = await fetch(apiUrl('/api/posts'), { headers: getHeaders() });
      if (!res.ok) return [];
      const data = await readResponse<Post[]>(res);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
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
  async getDashboard(): Promise<{ stats: { views: number; likes: number; comments: number; followers: number; posts: number }; viewsByDay: { date: string; views: number }[]; posts: Post[]; reels?: Post[] }> {
    const res = await fetch(apiUrl('/api/dashboard'), { headers: getHeaders() });
    return readResponse(res, 'Could not load dashboard');
  },

  async createPost(data: {
    content: string;
    mediaUrl?: string;
    mediaUrls?: string[];
    images?: string[];
    imagesCount?: number;
    v2?: { feeling?: string; privacy?: 'public' | 'friends' | 'only_me'; [key: string]: unknown };
    mediaType?: 'image' | 'video';
    type?: 'post' | 'reel';
    thumbnailUrl?: string;
    mediaDuration?: number;
    mediaSize?: number;
    feeling?: string;
    privacy?: 'public' | 'friends' | 'only_me';
    taggedUserIds?: string[];
  }): Promise<Post> {
    const res = await fetch(apiUrl('/api/posts'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return readResponse<Post>(res, 'Failed to create post');
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
    return readResponse<Post>(res, 'Failed to edit post');
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
    return readResponse<{ success: boolean; sharesCount?: number; post?: Post }>(res, 'Could not share this post');
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

  async viewStory(id: string): Promise<{ success: boolean; story: Story | null }> {
    const res = await fetch(apiUrl(`/api/stories/${id}/view`), {
      method: 'POST',
      headers: getHeaders()
    });
    return readResponse<{ success: boolean; story: Story | null }>(res);
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
    attachments?: MessageAttachment[];
    v2_market_order?: Message['v2_market_order'];
  }): Promise<Message> {
    const res = await fetch(apiUrl('/api/messages'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return readResponse<Message>(res);
  },

  async editMessage(messageId: string, text: string): Promise<Message> {
    const res = await fetch(apiUrl(`/api/messages/${messageId}`), { method: 'PUT', headers: getHeaders(), body: JSON.stringify({ text }) });
    return readResponse<Message>(res, 'Could not edit this message');
  },

  async deleteMessage(messageId: string): Promise<void> {
    const res = await fetch(apiUrl(`/api/messages/${messageId}`), { method: 'DELETE', headers: getHeaders() });
    await readResponse<{ success: boolean }>(res, 'Could not delete this message');
  },

  async markMessagesSeen(partnerId: string) {
    const res = await fetch(apiUrl('/api/messages/seen'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ partnerId })
    });
    const result = await readResponse(res);
    // lets the navbar refresh its unread-message badge straight away
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('echat:messages-seen'));
    return result;
  },

  // Notifications
  async getBirthdays(): Promise<{ user: User; daysUntil: number; turns?: number }[]> {
    const res = await fetch(apiUrl('/api/birthdays'), { headers: getHeaders() });
    return readResponse<{ user: User; daysUntil: number; turns?: number }[]>(res, 'Failed to load birthdays');
  },

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

  async markNotificationsRead(options: { exceptMessages?: boolean } = {}) {
    const res = await fetch(apiUrl('/api/notifications/read'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(options)
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
    const res = await fetch(LEGACY_API_URL + '/api/live/access', { headers: await getLiveHeaders(forceRefresh) });
    return readResponse(res, 'Could not check Go Live access');
  },

  async requestLiveAccess(reason: string): Promise<{ success: boolean; liveAccess: 'pending'; request: LiveAccessRequest }> {
    const res = await fetch(LEGACY_API_URL + '/api/live/request', { method: 'POST', headers: await getLiveHeaders(), body: JSON.stringify({ reason }) });
    return readResponse(res, 'Could not send Go Live request');
  },

  async cancelLiveAccessRequest(): Promise<{ success: boolean; liveAccess: 'none' }> {
    const res = await fetch(LEGACY_API_URL + '/api/live/request/cancel', { method: 'POST', headers: await getLiveHeaders() });
    return readResponse(res, 'Could not cancel Go Live request');
  },

  async getAdminLiveAccess(): Promise<{ requests: LiveAccessRequest[]; mode: LiveAccessMode; users: User[] }> {
    const res = await fetch(LEGACY_API_URL + '/api/admin/live-access', { headers: await getLiveHeaders() });
    return readResponse(res, 'Could not load Go Live access requests');
  },

  async reviewLiveAccessRequest(requestId: string, decision: 'approved' | 'rejected' | 'blocked'): Promise<void> {
    const res = await fetch(LEGACY_API_URL + `/api/admin/live-access/requests/${encodeURIComponent(requestId)}/review`, { method: 'POST', headers: await getLiveHeaders(), body: JSON.stringify({ decision }) });
    await readResponse(res, 'Could not review Go Live request');
  },

  async updateUserLiveAccess(userId: string, action: 'grant' | 'revoke' | 'block' | 'unblock'): Promise<User> {
    const res = await fetch(LEGACY_API_URL + `/api/admin/live-access/users/${encodeURIComponent(userId)}`, { method: 'POST', headers: await getLiveHeaders(), body: JSON.stringify({ action }) });
    return readResponse(res, 'Could not change user Go Live access');
  },

  async updateLiveAccessMode(mode: LiveAccessMode): Promise<void> {
    const res = await fetch(LEGACY_API_URL + '/api/admin/live-access/settings', { method: 'PUT', headers: await getLiveHeaders(), body: JSON.stringify({ mode }) });
    await readResponse(res, 'Could not update Go Live settings');
  },

  // Live broadcast system
  async getCurrentLive(): Promise<{ live: LiveStream | null }> {
    const res = await fetch(apiUrl('/api/live/current'), { headers: getHeaders(), cache: 'no-store' });
    if (!res.ok) return { live: null };
    return readResponse<{ live: LiveStream | null }>(res);
  },

  async startLive(title?: string, taggedPageIds: string[] = []): Promise<{ success: boolean; live: LiveStream; liveKitUrl?: string; liveKitToken?: string }> {
    const res = await fetch(apiUrl('/api/live/start'), {
      method: 'POST',
      headers: await getLiveHeaders(),
      body: JSON.stringify({ title, taggedPageIds })
    });
    return readResponse(res, 'Failed to start live stream');
  },

  async stopLive(streamId?: string): Promise<{ success: boolean; live?: LiveStream }> {
    const res = await fetch(apiUrl('/api/live/end'), {
      method: 'POST',
      headers: await getLiveHeaders(),
      body: JSON.stringify({ streamId })
    });
    return readResponse(res);
  },

  async getLiveKitViewerToken(streamId: string): Promise<{ url: string; token: string }> {
    const res = await fetch(apiUrl(`/api/live/watch?streamId=${encodeURIComponent(streamId)}`), { headers: await getLiveHeaders(), cache: 'no-store' });
    return readResponse(res, 'Could not join this live stream');
  },

  async getLiveKitHostToken(streamId: string): Promise<{ url: string; token: string }> {
    const res = await fetch(apiUrl('/api/live/publish'), { method: 'POST', headers: await getLiveHeaders(), body: JSON.stringify({ streamId }), cache: 'no-store' });
    return readResponse(res, 'Could not publish your live broadcast');
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
