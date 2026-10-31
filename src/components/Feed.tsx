import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../services/api';
import { Post, User, LiveStream } from '../types';
import { StoriesBar } from './StoriesBar';
import { PostCard } from './PostCard';
import { CreatePostModal } from './CreatePostModal';
import { LiveFeedBanner } from './LiveFeedBanner';
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
  const { onNewPost, onPostUpdated } = useSocket();
  const [posts, setPosts] = useState<Post[]>([]);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadPosts = async () => {
    setIsLoading(true);
    try {
      const data = await api.getPosts();
      setPosts(data);
    } catch (err) {
      console.error('Failed to load posts:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPosts();

    const unsubNew = onNewPost((newPost) => {
      setPosts(prev => [newPost, ...prev.filter(p => p.id !== newPost.id)]);
    });

    const unsubUpdate = onPostUpdated((updatedPost) => {
      setPosts(prev => prev.map(p => p.id === updatedPost.id ? updatedPost : p));
    });

    return () => {
      unsubNew();
      unsubUpdate();
    };
  }, []);

  const handlePostDeleted = (postId: string) => {
    setPosts(prev => prev.filter(p => p.id !== postId));
  };

  return (
    <div className="max-w-[620px] mx-auto pb-16 space-y-4">
      {/* Active Live Stream Banner */}
      {liveStream && (
        <LiveFeedBanner
          stream={liveStream}
          onWatch={() => onWatchLive(liveStream)}
        />
      )}

      {/* 24-Hour Stories Reel */}
      <StoriesBar onOpenChatWithUser={onOpenChat} />

      {/* Post Composer Card */}
      <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200">
        <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
          <img
            src={user?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80'}
            alt="You"
            onClick={() => user && onViewProfile(user.id)}
            className="w-10 h-10 rounded-full object-cover cursor-pointer hover:opacity-90 transition border border-slate-100"
          />
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex-1 bg-slate-100 hover:bg-slate-200/80 text-slate-500 text-left text-sm px-4 py-2.5 rounded-full transition cursor-pointer"
          >
            What's on your mind, {user?.name?.split(' ')[0] || ''}?
          </button>
        </div>

        <div className="grid grid-cols-3 pt-2 text-xs font-semibold text-slate-600">
          <button
            onClick={onOpenGoLive}
            className="py-2 hover:bg-rose-50/70 rounded-xl flex items-center justify-center gap-2 transition cursor-pointer text-rose-600 font-bold"
          >
            <Video size={18} className="text-rose-500" />
            <span className="hidden sm:inline">Go Live</span>
          </button>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="py-2 hover:bg-slate-50 rounded-xl flex items-center justify-center gap-2 transition cursor-pointer text-emerald-500"
          >
            <Image size={18} />
            <span className="text-slate-600 hidden sm:inline">Photo/video</span>
          </button>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="py-2 hover:bg-slate-50 rounded-xl flex items-center justify-center gap-2 transition cursor-pointer text-amber-500"
          >
            <Smile size={18} />
            <span className="text-slate-600 hidden sm:inline">Feeling/activity</span>
          </button>
        </div>
      </div>

      {/* Posts Stream */}
      {isLoading ? (
        <div className="p-8 text-center text-slate-400">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs">Loading News Feed...</p>
        </div>
      ) : posts.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center text-slate-400 border border-slate-200">
          <Sparkles size={32} className="mx-auto mb-2 opacity-50 text-blue-500" />
          <p className="text-sm font-bold text-slate-700">No posts in feed yet</p>
          <p className="text-xs text-slate-400 mt-1">Be the first to share an update with your friends!</p>
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
