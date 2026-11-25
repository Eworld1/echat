import { usePreferences } from '../context/PreferencesContext';
import { UserAvatar } from './UserAvatar';
import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api, invalidateApiReadCache } from '../services/api';
import { LiveStream, Post, User } from '../types';
import { StoriesBar } from './StoriesBar';
import { PostCard } from './PostCard';
import { ProfilePhotoPostCard } from './ProfilePhotoPostCard';
import { listenProfilePhotoPosts, type ProfilePhotoPost } from '../services/profilePhotoPosts';
import { CreatePostModal } from './CreatePostModal';
import { DashboardHeader } from './DashboardHeader';
import { LiveFeedBanner } from './LiveFeedBanner';
import { useLowDataMode } from '../services/lowData';
import { Video, Image, Smile, PenSquare, RefreshCw, ArrowDown } from 'lucide-react';

interface FeedProps {
  onOpenChat: (user: User) => void;
  onViewProfile: (userId: string) => void;
  onOpenGoLive: () => void;
  /** Open a live from the LIVE NOW banner. */
  onWatchLive?: (stream: LiveStream) => void;
  /** Stat cards on the dashboard header open these sections. */
  onOpenSection?: (target: 'profile' | 'live' | 'messages' | 'marketplace') => void;
}

export const Feed: React.FC<FeedProps> = ({
  onOpenChat,
  onViewProfile,
  onOpenGoLive,
  onWatchLive,
  onOpenSection,
}) => {
  const { user } = useAuth();
  const { t } = usePreferences();
  const { onNewPost, onPostUpdated, onPostDeleted } = useSocket();
  const [posts, setPosts] = useState<Post[]>([]);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // "[Name] updated their profile picture" posts live in Firestore; merged into the stream by time.
  const [photoPosts, setPhotoPosts] = useState<ProfilePhotoPost[]>([]);
  useEffect(() => listenProfilePhotoPosts(setPhotoPosts), []);
  const touchStartY = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  // Low Data Mode: 10 posts at a time and only when "Load More" is tapped (no automatic preloading).
  const [lowData] = useLowDataMode();

  const isFeedPost = (post: Post) => post.type === 'post' && post.isReel !== true && post.videoType !== 'reel';

  /** silent = refresh in place (pull to refresh / after posting) without blanking the feed. */
  const loadPosts = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const data = await api.getPostsPage();
      setNextCursor(data.nextCursor);
      setPosts(data.posts.filter(isFeedPost));
    } catch (err) {
      console.error('Failed to load posts:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPosts();

    const unsubNew = onNewPost((newPost) => {
      if (newPost.type === 'post' && newPost.isReel !== true && newPost.videoType !== 'reel') {
        invalidateApiReadCache('posts');
        setPosts(prev => [newPost, ...prev.filter(p => p.id !== newPost.id)]);
      }
    });

    const unsubUpdate = onPostUpdated((updatedPost) => {
      invalidateApiReadCache('posts');
      setPosts(prev => updatedPost.type === 'post' && updatedPost.isReel !== true && updatedPost.videoType !== 'reel'
        ? prev.map(p => p.id === updatedPost.id ? updatedPost : p)
        : prev.filter(p => p.id !== updatedPost.id));
    });

    const unsubDelete = onPostDeleted((postId) => {
      invalidateApiReadCache('posts');
      setPosts(prev => prev.filter(p => p.id !== postId));
    });

    return () => {
      unsubNew();
      unsubUpdate();
      unsubDelete();
    };
  }, []);

  const handlePostDeleted = (postId: string) => {
    setPosts(prev => prev.filter(p => p.id !== postId));
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await api.getPostsPage(nextCursor);
      setPosts(current => [...current, ...page.posts.filter(isFeedPost).filter(post => !current.some(item => item.id === post.id))]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      console.error('Failed to load more posts:', error);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  // Infinite scroll: load the next page when the bottom marker comes near the screen.
  useEffect(() => {
    const marker = loadMoreRef.current;
    if (lowData || !marker || !nextCursor || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void loadMore(); }, { rootMargin: '800px 0px' });
    observer.observe(marker);
    return () => observer.disconnect();
  }, [nextCursor, posts.length, lowData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pull to refresh (at the top of the page, drag down).
  const PULL_TRIGGER = 80;
  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartY.current;
    if (start === null || window.scrollY > 4 || isRefreshing) return;
    const distance = (event.touches[0]?.clientY ?? start) - start;
    setPullDistance(distance > 0 ? Math.min(120, distance * 0.6) : 0);
  };
  const handleTouchEnd = () => {
    const pulled = pullDistance;
    touchStartY.current = null;
    setPullDistance(0);
    if (pulled < PULL_TRIGGER * 0.6 || isRefreshing) return;
    setIsRefreshing(true);
    invalidateApiReadCache('posts');
    loadPosts(true).finally(() => setIsRefreshing(false));
  };

  return (
    <div className="max-w-[620px] mx-auto pb-16 space-y-4" onTouchStart={event => { touchStartY.current = window.scrollY <= 4 ? event.touches[0]?.clientY ?? null : null; }} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      {(pullDistance > 0 || isRefreshing) && (
        <div className="flex justify-center overflow-hidden transition-[height]" style={{ height: isRefreshing ? 44 : pullDistance * 0.6 }} aria-live="polite">
          <span className="mt-1 grid h-9 w-9 place-items-center rounded-full bg-white text-[#1877F2] shadow-md">
            {isRefreshing ? <RefreshCw size={18} className="animate-spin" /> : <ArrowDown size={18} style={{ transform: `rotate(${pullDistance >= PULL_TRIGGER * 0.6 ? 180 : 0}deg)`, transition: 'transform .15s' }} />}
          </span>
          {isRefreshing && <span className="sr-only">Refreshing feed</span>}
        </div>
      )}

      {/* Welcome, today's date, Go Live and my stats */}
      <DashboardHeader onGoLive={onOpenGoLive} onOpen={target => (target === 'profile' && user ? onViewProfile(user.id) : onOpenSection?.(target))} />

      {/* LIVE NOW: everyone who is live right now (realtime) */}
      {onWatchLive && <LiveFeedBanner onWatch={onWatchLive} onSeeAll={() => onOpenSection?.('live')} />}

      {/* 24-Hour Stories (circles) */}
      <div className="ec-card bg-white px-3 pt-3 dark:bg-[#161033]">
        <StoriesBar onOpenChatWithUser={onOpenChat} />
      </div>

      {/* Post Composer Card */}
      <div className="ec-card bg-white p-4 dark:bg-[#161033]">
        <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-white/10">
          <span className="ec-story-ring shrink-0 rounded-full p-[2px]"><UserAvatar src={user?.avatar} name={user?.name || 'You'} size={40} onClick={() => user && onViewProfile(user.id)} className="ring-2 ring-white dark:ring-[#161033]" /></span>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex-1 rounded-full bg-violet-50 px-4 py-3 text-left text-sm text-slate-500 transition hover:bg-violet-100/80 cursor-pointer dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10"
          >
            {t('composer_mind', { name: user?.name?.split(' ')[0] || '' })}
          </button>
        </div>

        <div className="grid grid-cols-3 pt-2 text-xs font-semibold text-slate-600">
          <button
            onClick={onOpenGoLive}
            className="py-2 hover:bg-pink-50 rounded-xl flex items-center justify-center gap-2 transition cursor-pointer text-pink-600 font-bold dark:hover:bg-white/5"
          >
            <Video size={18} className="text-rose-500" />
            <span className="hidden sm:inline">{t('go_live')}</span>
          </button>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="py-2 hover:bg-slate-50 rounded-xl flex items-center justify-center gap-2 transition cursor-pointer text-emerald-500"
          >
            <Image size={18} />
            <span className="text-slate-600 hidden sm:inline">{t('photo_video')}</span>
          </button>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="py-2 hover:bg-slate-50 rounded-xl flex items-center justify-center gap-2 transition cursor-pointer text-amber-500"
          >
            <Smile size={18} />
            <span className="text-slate-600 hidden sm:inline">{t('feeling_activity')}</span>
          </button>
        </div>
      </div>


      {/* Posts Stream */}
      {isLoading ? (
        <div className="space-y-4" aria-label={t('loading_feed')} role="status">
          {[0, 1, 2].map(index => <PostSkeleton key={index} withImage={index !== 1} />)}
        </div>
      ) : posts.length === 0 && photoPosts.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
          <svg viewBox="0 0 160 120" className="mx-auto mb-4 h-28 w-36" aria-hidden="true">
            <rect x="18" y="22" width="124" height="84" rx="14" fill="#E7F0FD" />
            <rect x="32" y="36" width="34" height="34" rx="17" fill="#1877F2" opacity=".85" />
            <rect x="74" y="40" width="54" height="8" rx="4" fill="#9CC2F8" />
            <rect x="74" y="56" width="38" height="8" rx="4" fill="#C6DCFB" />
            <rect x="32" y="80" width="96" height="10" rx="5" fill="#C6DCFB" />
            <circle cx="130" cy="24" r="14" fill="#FDE68A" />
            <path d="M124 24h12M130 18v12" stroke="#F59E0B" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <p className="text-lg font-extrabold text-slate-900">No posts yet</p>
          <p className="mt-1 text-sm text-slate-500">{t('no_posts_hint')}</p>
          <button type="button" onClick={() => setIsCreateModalOpen(true)} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#1877F2] px-5 text-sm font-bold text-white hover:bg-[#166FE5]"><PenSquare size={16} />Create a post</button>
        </div>
      ) : (
        <>
        {mergeFeed(posts, photoPosts, Boolean(nextCursor)).map((item) => item.kind === 'photo' ? (
          <ProfilePhotoPostCard key={item.post.id} post={item.post} onViewProfile={onViewProfile} />
        ) : (
          <PostCard
            key={item.post.id}
            post={item.post}
            onPostUpdated={(updated) => {
              setPosts(prev => prev.map(p => p.id === updated.id ? updated : p));
            }}
            onPostDeleted={handlePostDeleted}
            onViewProfile={onViewProfile}
          />
        ))}
        <div ref={loadMoreRef} aria-live="polite">
          {loadingMore && <PostSkeleton withImage={false} />}
          {nextCursor && !loadingMore && <button type="button" onClick={() => void loadMore()} className={`w-full rounded-xl border py-3 text-sm font-semibold ${lowData ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200' : 'border-slate-200 bg-white text-slate-700'}`}>{lowData ? 'Load More (10 posts)' : 'Load more posts'}</button>}
          {!nextCursor && posts.length > 3 && <p className="py-4 text-center text-xs font-semibold text-slate-400">You're all caught up ✨</p>}
        </div>
        </>
      )}

      {/* Create Post Modal */}
      <CreatePostModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onPostCreated={() => loadPosts(true)}
      />
    </div>
  );
};

/** Grey placeholder shaped like a post while the feed loads. */
type FeedItem = { kind: 'post'; post: Post; at: number } | { kind: 'photo'; post: ProfilePhotoPost; at: number };

/**
 * Newest first. A profile-picture post only appears once the loaded server posts reach back to its
 * time (or all are loaded), so it never jumps above newer posts that haven't loaded yet.
 */
function mergeFeed(posts: Post[], photoPosts: ProfilePhotoPost[], hasMore: boolean): FeedItem[] {
  const oldestLoaded = posts.length ? Math.min(...posts.map(post => Number(post.createdAt) || 0)) : 0;
  const photos = photoPosts.filter(post => !hasMore || post.createdAt >= oldestLoaded);
  return [
    ...posts.map(post => ({ kind: 'post' as const, post, at: Number(post.createdAt) || 0 })),
    ...photos.map(post => ({ kind: 'photo' as const, post, at: post.createdAt }))
  ].sort((a, b) => b.at - a.at);
}

const PostSkeleton: React.FC<{ withImage?: boolean }> = ({ withImage = true }) => (
  <div className="animate-pulse overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm" aria-hidden="true">
    <div className="flex items-center gap-3 p-4">
      <div className="h-10 w-10 rounded-full bg-slate-200" />
      <div className="flex-1 space-y-2"><div className="h-3 w-36 rounded bg-slate-200" /><div className="h-2.5 w-20 rounded bg-slate-100" /></div>
    </div>
    <div className="space-y-2 px-4 pb-3"><div className="h-3 w-full rounded bg-slate-100" /><div className="h-3 w-2/3 rounded bg-slate-100" /></div>
    {withImage && <div className="aspect-[4/3] w-full bg-slate-100" />}
    <div className="grid grid-cols-3 gap-2 border-t border-slate-100 p-3"><div className="h-4 rounded bg-slate-100" /><div className="h-4 rounded bg-slate-100" /><div className="h-4 rounded bg-slate-100" /></div>
  </div>
);
