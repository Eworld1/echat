import React, { useState, useEffect } from 'react';
import { Story, User } from '../types';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { X, ChevronLeft, ChevronRight, Eye, Send, Heart } from 'lucide-react';

interface StoryViewerModalProps {
  stories: Story[];
  initialIndex: number;
  onClose: () => void;
  onReply: (author: User, text: string) => void;
}

export const StoryViewerModal: React.FC<StoryViewerModalProps> = ({
  stories,
  initialIndex,
  onClose,
  onReply
}) => {
  const { user } = useAuth();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [replyText, setReplyText] = useState('');

  const currentStory = stories[currentIndex];

  useEffect(() => {
    if (!currentStory) return;
    api.viewStory(currentStory.id);
  }, [currentIndex, currentStory]);

  // Story autoplay timer
  useEffect(() => {
    if (isPaused) return;

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          if (currentIndex < stories.length - 1) {
            setCurrentIndex(c => c + 1);
            return 0;
          } else {
            onClose();
            return 100;
          }
        }
        return prev + 2; // ~5 seconds per story
      });
    }, 100);

    return () => clearInterval(interval);
  }, [currentIndex, stories.length, isPaused, onClose]);

  const goToNext = () => {
    if (currentIndex < stories.length - 1) {
      setCurrentIndex(c => c + 1);
      setProgress(0);
    } else {
      onClose();
    }
  };

  const goToPrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(c => c - 1);
      setProgress(0);
    }
  };

  const storyAuthor: User = currentStory?.author || {
    id: currentStory?.authorId || '',
    name: 'User',
    email: '',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
    coverPhoto: '',
    bio: '',
    location: '',
    role: 'user',
    isBlocked: false,
    isOnline: false,
    lastSeen: 0,
    createdAt: 0,
    friends: [],
    friendRequestsSent: [],
    friendRequestsReceived: []
  };

  const handleSendReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !currentStory) return;
    onReply(storyAuthor, replyText.trim());
    setReplyText('');
    onClose();
  };

  if (!currentStory) return null;

  const isMyStory = currentStory.authorId === user?.id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-5 right-5 z-50 p-2.5 rounded-full bg-white/20 hover:bg-white/30 text-white transition cursor-pointer"
      >
        <X size={24} />
      </button>

      {/* Prev / Next Navigation Arrows */}
      {currentIndex > 0 && (
        <button
          onClick={goToPrev}
          className="absolute left-6 top-1/2 -translate-y-1/2 z-40 p-3 rounded-full bg-white/20 hover:bg-white/30 text-white transition hidden md:flex items-center justify-center"
        >
          <ChevronLeft size={28} />
        </button>
      )}

      {currentIndex < stories.length - 1 && (
        <button
          onClick={goToNext}
          className="absolute right-6 top-1/2 -translate-y-1/2 z-40 p-3 rounded-full bg-white/20 hover:bg-white/30 text-white transition hidden md:flex items-center justify-center"
        >
          <ChevronRight size={28} />
        </button>
      )}

      {/* Main Story Container */}
      <div
        className="relative w-full max-w-md h-[90vh] sm:h-[85vh] rounded-3xl overflow-hidden shadow-2xl flex flex-col justify-between border border-white/10"
        onMouseDown={() => setIsPaused(true)}
        onMouseUp={() => setIsPaused(false)}
        onTouchStart={() => setIsPaused(true)}
        onTouchEnd={() => setIsPaused(false)}
      >
        {/* Background Visual */}
        {currentStory.type === 'image' && currentStory.mediaUrl ? (
          <img
            src={currentStory.mediaUrl}
            alt="story"
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div
            className="absolute inset-0 w-full h-full"
            style={{ background: currentStory.backgroundGradient || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
          />
        )}

        {/* Dark overlay gradients for readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/80 pointer-events-none" />

        {/* Top Progress Bars & Author Details */}
        <div className="relative z-20 p-4 space-y-3">
          {/* Progress Segment */}
          <div className="flex items-center gap-1.5 w-full">
            {stories.map((s, idx) => (
              <div key={s.id} className="h-1 flex-1 bg-white/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white rounded-full transition-all duration-100 ease-linear"
                  style={{
                    width: idx < currentIndex ? '100%' : idx === currentIndex ? `${progress}%` : '0%'
                  }}
                />
              </div>
            ))}
          </div>

          {/* Author info */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img
                src={storyAuthor.avatar}
                alt={storyAuthor.name}
                className="w-10 h-10 rounded-full object-cover ring-2 ring-white shadow-md"
              />
              <div>
                <p className="text-sm font-bold text-white leading-tight drop-shadow-md">
                  {storyAuthor.name}
                </p>
                <p className="text-xs text-white/80 font-medium leading-tight">
                  {Math.max(1, Math.round((Date.now() - currentStory.createdAt) / 3600000))}h ago • 24h Status
                </p>
              </div>
            </div>

            {isMyStory && (
              <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-md px-3 py-1 rounded-full text-white text-xs font-semibold">
                <Eye size={14} />
                <span>{currentStory.viewers.length} views</span>
              </div>
            )}
          </div>
        </div>

        {/* Story Text Content (Middle) */}
        <div className="relative z-20 flex-1 flex items-center justify-center p-8 text-center">
          {currentStory.text && (
            <p className="text-2xl sm:text-3xl font-extrabold text-white leading-relaxed drop-shadow-lg max-w-sm">
              {currentStory.text}
            </p>
          )}
        </div>

        {/* Bottom Bar: Reply or Viewer Info */}
        <div className="relative z-20 p-4">
          {isMyStory ? (
            <div className="bg-black/40 backdrop-blur-md rounded-2xl p-3 text-white">
              <div className="flex items-center gap-2 mb-1">
                <Eye size={16} className="text-blue-400" />
                <span className="text-xs font-bold uppercase tracking-wider">
                  Viewers ({currentStory.viewers.length})
                </span>
              </div>
              <p className="text-xs text-white/80">
                {currentStory.viewers.length === 0
                  ? 'No views yet. Friends will see your story.'
                  : `${currentStory.viewers.length} friends viewed your story in the last 24 hours.`}
              </p>
            </div>
          ) : (
            <form onSubmit={handleSendReply} className="flex items-center gap-2">
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={`Reply to ${storyAuthor.name}...`}
                className="flex-1 bg-white/20 backdrop-blur-md text-white placeholder-white/70 text-sm px-4 py-2.5 rounded-full border border-white/20 focus:outline-hidden focus:bg-white/30 transition"
              />
              <button
                type="button"
                onClick={() => {
                  onReply(storyAuthor, '❤️ Loved your story!');
                  onClose();
                }}
                className="p-2.5 rounded-full bg-white/20 hover:bg-white/30 text-rose-400 transition"
              >
                <Heart size={20} className="fill-rose-500" />
              </button>
              <button
                type="submit"
                disabled={!replyText.trim()}
                className="p-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 transition"
              >
                <Send size={18} />
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
