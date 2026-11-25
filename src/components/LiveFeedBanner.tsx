import React, { useEffect, useState } from 'react';
import { Play, Radio, Users } from 'lucide-react';
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

const MAX_BANNERS = 3;

/**
 * "LIVE NOW" banners on the feed, one per host who is live right now. Realtime (shared lives
 * listener), so a live appears within seconds of the host starting and disappears the moment they end.
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
    <section aria-label="Live now" className="space-y-2">
      {visible.slice(0, MAX_BANNERS).map(stream => {
        const profile = profiles[stream.hostId];
        const name = profile?.name || stream.hostName;
        const avatar = avatarSrc(profile?.avatar || stream.hostAvatar, name);
        const verified = profile?.isVerified ?? stream.isHostVerified;
        const mine = stream.hostId === user?.id;
        return (
          <div key={stream.hostId} className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-rose-600 via-red-600 to-amber-600 p-0.5 shadow-lg shadow-rose-600/20">
            <div className="flex items-center justify-between gap-3 rounded-[14px] bg-slate-900/90 p-3 text-white sm:p-3.5">
              <button type="button" onClick={() => onWatch(stream)} className="flex min-w-0 items-center gap-3 text-left">
                <span className="relative shrink-0">
                  <img src={avatar} alt="" className="h-11 w-11 rounded-full object-cover ring-2 ring-rose-500" />
                  <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                    <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-rose-500 ring-2 ring-slate-900" />
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider"><Radio size={10} />Live now</span>
                    <span className="truncate text-sm font-bold">{mine ? 'You' : name}</span>
                    {verified && <VerifiedBadge size={14} />}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-300">{stream.title || `${name} is live`}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-rose-300"><Users size={11} />{stream.viewersCount || 0} watching</span>
                </span>
              </button>
              <button type="button" onClick={() => onWatch(stream)} className="flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 px-3.5 py-2 text-xs font-extrabold text-white shadow-md transition hover:from-rose-500 hover:to-red-500 sm:text-sm">
                <Play size={14} fill="white" />Watch
              </button>
            </div>
          </div>
        );
      })}
      {visible.length > MAX_BANNERS && onSeeAll && (
        <button type="button" onClick={onSeeAll} className="w-full rounded-xl bg-rose-50 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100">
          See all {visible.length} live videos
        </button>
      )}
    </section>
  );
};
