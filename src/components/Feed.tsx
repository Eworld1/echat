import { usePreferences } from '../context/PreferencesContext';
import { initialsAvatar } from '../utils/avatar';
import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../services/api';
import { Post, User, LiveStream } from '../types';
import { StoriesBar } from './StoriesBar';
import { PostCard } from './PostCard';
import { CreatePostModal } from './CreatePostModal';
import { LiveDiscoveryFeed } from './LiveDiscoveryFeed';
import { BirthdayCard } from './BirthdayCard';
import { Video, Image, Smile, Sparkles } from 'lucide-react';

interface FeedProps {
  onOpenChat: (user: User) => void;
  onViewProfile: (userId: string) => void;
  onOpenGoLive: () => void;
  onWatchLive: (stream: LiveStream) => void;
  liveStream: LiveStream | null;
}

export const Feed: React.FC<FeedProps> = ({
  onOpenChat,
  onViewProfile,
  onOpenGoLive,
  onWatchLive,
  liveStream
}) => {
  const { user } = useAuth();
  const { t } = usePreferences();
  const { onNewPost, onPostUpdated, onPostDeleted } = useSocket();
  const [posts, setPosts] = useState<Post[]>([]);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef<number | null>(null);

  const loadPosts = async () => {
    setIsLoading(true);
    try {
      const data = await api.getPosts();
      setPosts(data.filter(post => post.type === 'post' && post.isReel !== true && post.videoType !== 'reel'));
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
        setPosts(prev => [newPost, ...prev.filter(p => p.id !== newPost.id)]);
      }
    });

    const unsubUpdate = onPostUpdated((updatedPost) => {
      setPosts(prev => updatedPost.type === 'post' && updatedPost.isReel !== true && updatedPost.videoType !== 'reel'
        ? prev.map(p => p.id === updatedPost.id ? updatedPost : p)
        : prev.filter(p => p.id !== updatedPost.id));
    });

    const unsubDelete = onPostDeleted((postId) => {
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

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartY.current;
    touchStartY.current = null;
    const end = event.changedTouches[0]?.clientY;
    if (start === null || end === undefined || window.scrollY > 4 || end - start < 90 || isRefreshing) return;
    setIsRefreshing(true);
    loadPosts().finally(() => setIsRefreshing(false));
  };

  return (
    <div className="max-w-[620px] mx-auto pb-16 space-y-4" onTouchStart={event => { touchStartY.current = event.touches[0]?.clientY ?? null; }} onTouchEnd={handleTouchEnd}>
      <div className="xl:hidden"><BirthdayCard onViewProfile={onViewProfile} onSendMessage={onOpenChat} /></div>
      {isRefreshing && <p className="py-1 text-center text-xs font-semibold text-blue-600">Refreshing feed…</p>}
      <LiveDiscoveryFeed onWatchLive={onWatchLive} onOpenGoLive={onOpenGoLive} legacyStream={liveStream} />

      {/* 24-Hour Stories Reel */}
      <StoriesBar onOpenChatWithUser={onOpenChat} />

      {/* Post Composer Card */}
      <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200">
        <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
          <img
            src={user?.avatar || initialsAvatar(user?.name || '')}
            alt="You"
            onClick={() => user && onViewProfile(user.id)}
            className="w-10 h-10 rounded-full object-cover cursor-pointer hover:opacity-90 transition border border-slate-100"
          />
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex-1 bg-slate-100 hover:bg-slate-200/80 text-slate-500 text-left text-sm px-4 py-2.5 rounded-full transition cursor-pointer"
          >
            {t('composer_mind', { name: user?.name?.split(' ')[0] || '' })}
          </button>
        </div>

        <div className="grid grid-cols-3 pt-2 text-xs font-semibold text-slate-600">
          <button
            onClick={onOpenGoLive}
            className="py-2 hover:bg-rose-50/70 rounded-xl flex items-center justify-center gap-2 transition cursor-pointer text-rose-600 font-bold"
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
        <div className="p-8 text-center text-slate-400">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs">{t('loading_feed')}</p>
        </div>
      ) : posts.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center text-slate-400 border border-slate-200">
          <Sparkles size={32} className="mx-auto mb-2 opacity-50 text-blue-500" />
          <p className="text-sm font-bold text-slate-700">{t('no_posts')}</p>
          <p className="text-xs text-slate-400 mt-1">{t('no_posts_hint')}</p>
        </div>
      ) : (
        posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onPostUpdated={(updated) => {
              setPosts(prev => prev.map(p => p.id === updated.id ? updated : p));
            }}
            onPostDeleted={handlePostDeleted}
            onViewProfile={onViewProfile}
          />
        ))
      )}

      {/* Create Post Modal */}
      <CreatePostModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onPostCreated={loadPosts}
      />
    </div>
  );
};
