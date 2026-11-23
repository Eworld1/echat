import { usePreferences } from '../context/PreferencesContext';
import { initialsAvatar } from '../utils/avatar';
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
  const { t } = usePreferences();
  const { onStoryCreated } = useSocket();
  const [stories, setStories] = useState<Story[]>([]);
  const [activeStoryIndex, setActiveStoryIndex] = useState<number | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [storyToast, setStoryToast] = useState('');

  const loadStories = async () => {
    try {
      const list = await api.getStories();
      const allowedAuthors = new Set([user?.id, ...(user?.friends || [])].filter(Boolean));
      const now = Date.now();
      const visible = list.filter(story => story.expiresAt > now && allowedAuthors.has(story.authorId));
      visible.sort((a, b) => {
        const aOwn = a.authorId === user?.id ? 0 : 1;
        const bOwn = b.authorId === user?.id ? 0 : 1;
        if (aOwn !== bOwn) return aOwn - bOwn;
        const aSeen = user && a.viewers.some(viewer => viewer.userId === user.id) ? 1 : 0;
        const bSeen = user && b.viewers.some(viewer => viewer.userId === user.id) ? 1 : 0;
        return aSeen - bSeen || b.createdAt - a.createdAt;
      });
      setStories(visible);
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
  }, [user?.id, user?.friends]);

  useEffect(() => {
    if (!storyToast) return;
    const timeout = window.setTimeout(() => setStoryToast(''), 3500);
    return () => window.clearTimeout(timeout);
  }, [storyToast]);

  const handleStoryCreated = () => {
    setStoryToast('Story shared successfully');
    void loadStories();
  };

  const storyGroups = Array.from(new Map(stories.map(story => [story.authorId, stories.filter(item => item.authorId === story.authorId)])).values());
  const orderedStories = storyGroups.flat();

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
      {storyToast && <div role="status" aria-live="polite" className="fixed left-1/2 top-[max(1rem,env(safe-area-inset-top))] z-[210] -translate-x-1/2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-xl">{storyToast}</div>}
      <div className="flex items-start justify-start gap-4 overflow-x-auto pb-3 scrollbar-none select-none sm:justify-center">
        {/* Create Story Card */}
        <div
          onClick={() => setIsCreateOpen(true)}
          className="flex w-[68px] shrink-0 flex-col items-center gap-1.5 border-0 bg-transparent p-0 text-center cursor-pointer group sm:w-[76px]"
        >
          <div className="relative h-[68px] w-[68px] rounded-full border-2 border-slate-200 p-1 sm:h-[76px] sm:w-[76px]"><img src={user?.avatar || initialsAvatar(user?.name || '')} alt="You" className="h-full w-full rounded-full object-cover"/><span className="absolute bottom-0 right-0 grid h-7 w-7 place-items-center rounded-full border-2 border-white bg-blue-600 text-white shadow"><Plus size={17}/></span></div>
          <span className="w-full truncate text-xs font-semibold text-slate-800">Your Story</span>
        </div>

        {/* Story Items */}
        {storyGroups.map((group) => {
          const story = group[0];
          const idx = orderedStories.findIndex(item => item.id === story.id);
          const isViewed = Boolean(user && group.every(item => item.viewers.some(v => v.userId === user.id)));
          const isOwn = story.authorId === user?.id;
          return (
            <div
              key={story.authorId}
              onClick={() => setActiveStoryIndex(idx)}
              className="flex w-[68px] shrink-0 cursor-pointer flex-col items-center gap-1.5 text-center sm:w-[76px]"
            >
              <div className={`h-[68px] w-[68px] rounded-full p-[3px] sm:h-[76px] sm:w-[76px] ${isViewed ? 'bg-slate-300' : 'bg-emerald-500'}`}><img src={story.author?.avatar || initialsAvatar(story.author?.name || 'Echat User')} alt={story.author?.name || 'User'} className="h-full w-full rounded-full border-2 border-white object-cover"/></div>
              <span className="w-full truncate text-xs font-semibold text-slate-800">{isOwn ? 'Your Story' : story.author?.name || 'User'}</span>
            </div>
          );
        })}
      </div>

      {/* Story Viewer Modal */}
      {activeStoryIndex !== null && (
        <StoryViewerModal
          stories={orderedStories}
          initialIndex={activeStoryIndex}
          onClose={() => { setActiveStoryIndex(null); void loadStories(); }}
          onReply={handleStoryReply}
        />
      )}

      {/* Create Story Modal */}
      <CreateStoryModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onStoryCreated={handleStoryCreated}
      />
    </>
  );
};
