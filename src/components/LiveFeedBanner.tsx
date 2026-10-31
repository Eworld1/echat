import React from 'react';
import { LiveStream } from '../types';
import { VerifiedBadge } from './VerifiedBadge';
import { Radio, Users, Play, Sparkles } from 'lucide-react';

interface LiveFeedBannerProps {
  session?: LiveStream;
  stream?: LiveStream;
  onWatch: () => void;
}

export const LiveFeedBanner: React.FC<LiveFeedBannerProps> = ({ session, stream, onWatch }) => {
  const currentStream = stream || session;
  if (!currentStream) return null;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-rose-600 via-red-600 to-amber-600 p-0.5 shadow-lg shadow-rose-600/20 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="bg-slate-900/90 backdrop-blur-md rounded-[14px] p-3.5 sm:p-4 flex items-center justify-between gap-3 text-white">
        
        {/* Left: Avatar with Pulse & Host Info */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            <img
              src={currentStream.hostAvatar}
              alt={currentStream.hostName}
              className="w-12 h-12 rounded-full object-cover ring-2 ring-rose-500 shadow-md"
            />
            <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-rose-500 ring-2 ring-slate-900" />
            </span>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="bg-rose-600 text-white text-[9px] font-black uppercase px-2 py-0.5 rounded-full flex items-center gap-1 tracking-wider shadow-sm animate-pulse">
                <Radio size={10} />
                LIVE NOW
              </span>
              <span className="text-sm font-bold text-white truncate">{currentStream.hostName}</span>
              <VerifiedBadge size={14} />
            </div>
            <p className="text-xs text-slate-300 font-medium truncate mt-0.5">
              {currentStream.title}
            </p>
            <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
              <span className="flex items-center gap-1 text-rose-400 font-semibold">
                <Users size={11} /> {currentStream.viewersCount || 1} watching
              </span>
              <span>•</span>
              <span className="text-amber-400 font-medium flex items-center gap-0.5">
                <Sparkles size={11} /> Official Broadcast
              </span>
            </div>
          </div>
        </div>

        {/* Right: Watch Action Button */}
        <button
          onClick={onWatch}
          className="shrink-0 px-4 py-2 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-extrabold text-xs sm:text-sm rounded-xl shadow-md hover:scale-105 transition flex items-center gap-1.5 cursor-pointer"
        >
          <Play size={15} fill="white" />
          <span>Watch Live</span>
        </button>

      </div>
    </div>
  );
};
