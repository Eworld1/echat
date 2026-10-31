import React, { useState, useEffect } from 'react';
import { Story, User } from '../types';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { Plus } from 'lucide-react';
import { StoryViewerModal } from './StoryViewerModal';
import { CreateStoryModal } from './CreateStoryModal';

interface StoriesBarProps {
  onOpenChatWithUser: (user: User) => void;
}

export const StoriesBar: React.FC<StoriesBarProps> = ({ onOpenChatWithUser }) => {
  const { user } = useAuth();
  const { onStoryCreated } = useSocket();
  const [stories, setStories] = useState<Story[]>([]);
  const [activeStoryIndex, setActiveStoryIndex] = useState<number | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const loadStories = async () => {
    try {
      const list = await api.getStories();
      setStories(list);
    } catch (err) {
      console.error('Failed to load stories:', err);
    }
  };

  useEffect(() => {
    loadStories();
    const unsub = onStoryCreated((newStory) => {
      setStories(prev => [newStory, ...prev.filter(s => s.id !== newStory.id)]);
    });
    return () => unsub();
  }, []);

  const handleStoryReply = async (author: User, text: string) => {
    try {
      await api.sendMessage({
        receiverId: author.id,
        text: `Replying to your story: "${text}"`
      });
      onOpenChatWithUser(author);
    } catch (err) {
      console.error('Failed to reply to story:', err);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2.5 overflow-x-auto pb-2 scrollbar-none select-none">
        {/* Create Story Card */}
        <div
          onClick={() => setIsCreateOpen(true)}
          className="relative flex-shrink-0 w-28 sm:w-32 h-48 sm:h-52 bg-white rounded-2xl overflow-hidden shadow-xs border border-slate-200/80 cursor-pointer group hover:shadow-md transition"
        >
          <div className="h-32 sm:h-36 overflow-hidden">
            <img
              src={user?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80'}
              alt="You"
              className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
            />
          </div>
          <div className="absolute top-28 sm:top-32 left-1/2 -translate-x-1/2">
            <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center ring-4 ring-white shadow-sm group-hover:bg-blue-700 transition">
              <Plus size={20} strokeWidth={2.5} />
            </div>
          </div>
          <div className="pt-4 text-center">
            <span className="text-xs font-bold text-slate-800">Create story</span>
          </div>
        </div>

        {/* Story Items */}
        {stories.map((story, idx) => {
          const isViewed = Boolean(user && story.viewers.some(v => v.userId === user.id));
          return (
            <div
              key={story.id}
              onClick={() => setActiveStoryIndex(idx)}
              className="relative flex-shrink-0 w-28 sm:w-32 h-48 sm:h-52 rounded-2xl overflow-hidden shadow-xs cursor-pointer group hover:shadow-lg hover:scale-[1.02] transition duration-200"
              style={{
                background: story.backgroundGradient || '#1E293B'
              }}
            >
              {story.type === 'image' && story.mediaUrl ? (
                <img
                  src={story.mediaUrl}
                  alt={story.author?.name || 'Story'}
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition duration-300"
                />
              ) : (
                <div className="absolute inset-0 p-3 flex items-center justify-center text-center">
                  <p className="text-white text-xs font-bold line-clamp-4 drop-shadow">
                    {story.text}
                  </p>
                </div>
              )}

              {/* Gradient tint */}
              <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/70" />

              {/* Author Avatar with Ring */}
              <div className="absolute top-2.5 left-2.5 z-10">
                <div
                  className={`w-9 h-9 rounded-full p-0.5 ${
                    isViewed
                      ? 'bg-slate-300 ring-1 ring-slate-400'
                      : 'bg-gradient-to-tr from-blue-600 to-cyan-400 ring-2 ring-blue-500'
                  }`}
                >
                  <img
                    src={story.author?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80'}
                    alt={story.author?.name || 'User'}
                    className="w-full h-full rounded-full object-cover border-2 border-white"
                  />
                </div>
              </div>

              {/* Author Name */}
              <div className="absolute bottom-2.5 left-2.5 right-2.5 z-10">
                <p className="text-xs font-bold text-white truncate drop-shadow-md">
                  {story.author?.name || 'User'}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Story Viewer Modal */}
      {activeStoryIndex !== null && (
        <StoryViewerModal
          stories={stories}
          initialIndex={activeStoryIndex}
          onClose={() => setActiveStoryIndex(null)}
          onReply={handleStoryReply}
        />
      )}

      {/* Create Story Modal */}
      <CreateStoryModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onStoryCreated={loadStories}
      />
    </>
  );
};
