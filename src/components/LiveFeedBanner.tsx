import React, { useEffect, useState } from 'react';
import { Eye, Radio } from 'lucide-react';
import type { LiveStream } from '../types';
import { VerifiedBadge } from './VerifiedBadge';
import { avatarSrc } from './UserAvatar';
import { useAuth } from '../context/AuthContext';
import { getLiveDiscoveryUserData, useActiveLives } from '../services/liveDiscovery';
import { useLiveProfiles } from '../services/liveProfiles';

interface LiveFeedBannerProps {
  onWatch: (stream: LiveStream) => void;
  onSeeAll?: () => void;
}

/**
 * LIVE NOW row at the very top of the feed: one horizontally scrolling card per host who is live
 * right now (realtime). Appears within seconds of a host going live, disappears the moment they end.
 */
export const LiveFeedBanner: React.FC<LiveFeedBannerProps> = ({ onWatch, onSeeAll }) => {
  const { user } = useAuth();
  const lives = useActiveLives(Boolean(user));
  const [hidden, setHidden] = useState<string[]>([]);
  const hasLives = Boolean(lives?.length);

  // Don't advertise lives of people I blocked / who blocked me (cached, loaded only when someone is live).
  useEffect(() => {
    if (!user?.id || !hasLives) return;
    let active = true;
    getLiveDiscoveryUserData(user.id).then(data => { if (active) setHidden([...data.blockedIds, ...data.blockedByIds]); }).catch(() => {});
    return () => { active = false; };
  }, [user?.id, hasLives]);

  const visible = (lives || []).filter(stream => !stream.underReview && !hidden.includes(stream.hostId));
  const profiles = useLiveProfiles(visible.map(stream => stream.hostId));
  if (!visible.length) return null;

  return (
    <section aria-label="Live now" className="ec-card bg-white p-3 dark:bg-[#161033]">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="flex items-center gap-2 text-sm font-extrabold text-slate-900 dark:text-white">
          <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" /></span>
          LIVE NOW
        </h2>
        {onSeeAll && <button type="button" onClick={onSeeAll} className="text-xs font-bold text-rose-600 hover:underline dark:text-rose-300">See all</button>}
      </div>
      <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
        {visible.map(stream => {
          const profile = profiles[stream.hostId];
          const name = profile?.name || stream.hostName || 'Live';
          const avatar = avatarSrc(profile?.avatar || stream.hostAvatar, name);
          const verified = profile?.isVerified ?? stream.isHostVerified;
          const mine = stream.hostId === user?.id;
          return (
            <button key={stream.hostId} type="button" onClick={() => onWatch(stream)} aria-label={`Watch ${name} live`}
              className="group relative flex aspect-[3/4] w-36 shrink-0 snap-start flex-col justify-between overflow-hidden rounded-2xl bg-slate-900 p-2.5 text-left text-white shadow-md sm:w-40">
              <span aria-hidden="true" className="absolute inset-0 bg-cover bg-center opacity-50 transition group-hover:scale-105" style={{ backgroundImage: `url("${avatar}")` }} />
              <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-black/40" />
              <span className="relative flex items-center justify-between">
                <span className="flex items-center gap-1 rounded-md bg-rose-600 px-1.5 py-0.5 text-[10px] font-black uppercase"><Radio size={10} />Live</span>
                <span className="flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-bold"><Eye size={11} />{stream.viewersCount || 0}</span>
              </span>
              <span className="relative">
                <img src={avatar} alt="" className="mb-1.5 h-9 w-9 rounded-full border-2 border-rose-500 object-cover" />
                <span className="flex items-center gap-1 text-xs font-extrabold"><span className="truncate">{mine ? 'You' : name}</span>{verified && <VerifiedBadge size={12} />}</span>
                <span className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-slate-200">{stream.title || `${name} is live`}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};
