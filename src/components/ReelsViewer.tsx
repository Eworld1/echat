import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type { Post } from '../types';
import { PostCard } from './PostCard';

interface ReelsViewerProps {
  posts: Post[];
  initialPostId: string;
  onClose: () => void;
  onViewProfile: (userId: string) => void;
  onPostUpdated: (post: Post) => void;
  onPostDeleted: (postId: string) => void;
}

export const ReelsViewer: React.FC<ReelsViewerProps> = ({ posts, initialPostId, onClose, onViewProfile, onPostUpdated, onPostDeleted }) => {
  const [index, setIndex] = useState(() => Math.max(0, posts.findIndex(post => post.id === initialPostId)));
  const touchStart = useRef<number | null>(null);
  const current = posts[index];

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const move = (direction: -1 | 1) => setIndex(currentIndex => Math.max(0, Math.min(posts.length - 1, currentIndex + direction)));
  if (!current) return null;

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-2 text-white sm:p-4" role="dialog" aria-modal="true" aria-label="Reel viewer" onTouchStart={event => { touchStart.current = event.touches[0]?.clientY ?? null; }} onTouchEnd={event => {
    if (touchStart.current === null) return;
    const delta = touchStart.current - (event.changedTouches[0]?.clientY ?? touchStart.current);
    if (Math.abs(delta) > 55) move(delta > 0 ? 1 : -1);
    touchStart.current = null;
  }} onWheel={event => { if (Math.abs(event.deltaY) > 35) move(event.deltaY > 0 ? 1 : -1); }}>
    <button type="button" onClick={onClose} aria-label="Close Reel viewer" className="absolute right-3 top-3 z-20 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"><X size={21} /></button>
    <button type="button" onClick={() => move(-1)} disabled={index === 0} aria-label="Previous Reel" className="absolute left-2 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white disabled:opacity-30 sm:left-6"><ChevronUp size={23} /></button>
    <div className="h-[min(94dvh,900px)] w-full max-w-[520px] overflow-y-auto overscroll-contain rounded-2xl bg-white text-slate-900" onClick={event => event.stopPropagation()}>
      <PostCard key={current.id} post={current} onPostUpdated={onPostUpdated} onPostDeleted={onPostDeleted} onViewProfile={onViewProfile} reelMode detailMode />
    </div>
    <button type="button" onClick={() => move(1)} disabled={index >= posts.length - 1} aria-label="Next Reel" className="absolute right-2 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white disabled:opacity-30 sm:right-6"><ChevronDown size={23} /></button>
    <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-xs text-white">{index + 1} / {posts.length}</span>
  </div>;
};
