import React, { useState } from 'react';
import { Eye } from 'lucide-react';
import type { Post } from '../types';

export const ReelThumbnail: React.FC<{ post: Post; onClick: () => void }> = ({ post, onClick }) => {
  const [duration, setDuration] = useState(post.mediaDuration ? `${Math.floor(post.mediaDuration / 60)}:${String(Math.floor(post.mediaDuration % 60)).padStart(2, '0')}` : '');
  return <button type="button" onClick={onClick} aria-label={`Open Reel: ${post.content || 'video'}`} className="group relative aspect-[9/16] overflow-hidden rounded-xl bg-black text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">
    {post.thumbnailUrl ? <img src={post.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : post.mediaUrl && <video src={post.mediaUrl} muted playsInline preload="metadata" onLoadedMetadata={event => {
      const seconds = Math.floor(event.currentTarget.duration || 0);
      setDuration(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
    }} className="h-full w-full object-cover transition group-hover:scale-[1.02]" />}
    <span className="absolute right-2 top-2 rounded-md bg-black/70 px-2 py-1 text-[10px] font-bold text-white">{duration || 'Reel'}</span>
    <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/85 to-transparent p-3 pt-10 text-xs font-semibold text-white"><span className="line-clamp-2">{post.content || 'Reel'}</span><span className="flex shrink-0 items-center gap-1 text-[10px] font-normal"><Eye size={12} />{(post.viewsCount || 0).toLocaleString()}</span></span>
  </button>;
};
