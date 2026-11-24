import React, { useEffect, useRef, useState } from 'react';
import { UserAvatar } from '../UserAvatar';
import { Bookmark, Eye, Heart, MessageCircle, MoreHorizontal, Music2, Pause, Play, Share2, Volume2, VolumeX } from 'lucide-react';
import { followCreator, listenFollowingState, unfollowCreator } from '../../services/liveDiscovery';
import { MediaPlayer, type MediaPlayerHandle } from './MediaPlayer';
import { LowDataVideoCover } from '../LowData';
import { isUnlocked, useLowDataMode } from '../../services/lowData';
import { reelSound, recordReelView, type Reel } from '../../services/reels/reelsStore';
import type { Viewer } from './ReelSheets';

const MARQUEE_CSS = '@keyframes echatMarquee { from { transform: translateX(0); } to { transform: translateX(-50%); } } @keyframes echatSoundFlash { 0% { opacity: 0; transform: translate(-50%,-50%) scale(.7); } 20% { opacity: 1; transform: translate(-50%,-50%) scale(1); } 75% { opacity: 1; } 100% { opacity: 0; } } @keyframes echatHeartPop { 0% { transform: translate(-50%,-50%) scale(0.3); opacity: 0; } 15% { transform: translate(-50%,-50%) scale(1.2); opacity: 1; } 30% { transform: translate(-50%,-50%) scale(0.95); } 80% { opacity: 1; } 100% { transform: translate(-50%,-70%) scale(1); opacity: 0; } }';
let cssInjected = false;
function injectCss() {
  if (cssInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = MARQUEE_CSS;
  document.head.appendChild(style);
  cssInjected = true;
}

const compact = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(value);

interface ReelViewProps {
  reel: Reel;
  active: boolean;
  /** When false the reel starts paused; tap to play. */
  autoplay?: boolean;
  nearby: boolean;
  muted: boolean;
  viewer: Viewer | null;
  liked: boolean;
  saved: boolean;
  /** Set the shared Reels sound setting (called inside the tap so phones allow sound). */
  onSetMuted: (muted: boolean) => void;
  onLike: (liked: boolean) => void;
  onSave: (saved: boolean) => void;
  onComments: () => void;
  onShare: () => void;
  onSound: () => void;
  onMore: () => void;
  onViewProfile?: (userId: string) => void;
  onSoundBlocked: () => void;
  /** Gives the page the active reel's player so the header sound button can apply instantly. */
  onActivePlayer?: (player: MediaPlayerHandle | null) => void;
}

/** One full-screen Reel (TikTok-style): double-tap like, right action bar, creator + caption + sound marquee. */
export const ReelView: React.FC<ReelViewProps> = ({ reel, active, autoplay: autoplayPref = true, nearby, muted, viewer, liked, saved, onSetMuted, onLike, onSave, onComments, onShare, onSound, onMore, onViewProfile, onSoundBlocked, onActivePlayer }) => {
  // Low Data Mode: never autoplay; each video shows a cover (thumbnail + Play + size) until tapped.
  const [lowData] = useLowDataMode();
  const autoplay = autoplayPref && !lowData;
  const [unlocked, setUnlocked] = useState(() => isUnlocked(reel.mediaUrl));
  const gated = lowData && reel.mediaType === 'video' && !unlocked;
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [flash, setFlash] = useState<{ id: number; muted: boolean } | null>(null);
  const player = useRef<MediaPlayerHandle>(null);
  const holdTimer = useRef<number | null>(null);
  const holding = useRef(false);
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number }[]>([]);
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const lastTap = useRef(0);
  const singleTapTimer = useRef<number | null>(null);
  const sound = reelSound(reel);
  const isOwn = viewer?.uid === reel.creatorId;

  useEffect(() => { injectCss(); }, []);
  useEffect(() => { if (active) { setPaused(!autoplay); recordReelView(reel.id); } }, [active, reel.id, autoplay]);
  useEffect(() => {
    if (!active) return;
    onActivePlayer?.(player.current);
    return () => onActivePlayer?.(null);
  }, [active, nearby, onActivePlayer]);
  useEffect(() => (viewer && !isOwn ? listenFollowingState(viewer.uid, reel.creatorId, setFollowing) : undefined), [viewer?.uid, reel.creatorId, isOwn]);

  /** Mute / unmute: applied to the video immediately (inside the tap), then saved for every reel. */
  const toggleSound = () => {
    const next = !muted;
    player.current?.setMutedNow(next);
    onSetMuted(next);
    const id = Date.now();
    setFlash({ id, muted: next });
    window.setTimeout(() => setFlash(current => (current?.id === id ? null : current)), 700);
  };

  // Press and hold = pause while held (like Instagram / Facebook Reels).
  const onPressStart = () => {
    holding.current = false;
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => { holding.current = true; setHeld(true); }, 280);
  };
  const onPressEnd = () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (holding.current) setHeld(false);
  };

  const onTap = (event: React.MouseEvent<HTMLDivElement>) => {
    if (holding.current) { holding.current = false; return; } // end of a hold, not a tap
    const now = Date.now();
    const box = event.currentTarget.getBoundingClientRect();
    if (now - lastTap.current < 300) {
      const wasPausedTap = singleTapTimer.current !== null;
      if (singleTapTimer.current) window.clearTimeout(singleTapTimer.current);
      singleTapTimer.current = null;
      lastTap.current = 0;
      if (!wasPausedTap) toggleSound(); // first tap changed the sound; put it back
      const id = now;
      setHearts(current => [...current, { id, x: ((event.clientX - box.left) / box.width) * 100, y: ((event.clientY - box.top) / box.height) * 100 }]);
      window.setTimeout(() => setHearts(current => current.filter(heart => heart.id !== id)), 1000);
      if (!liked) onLike(true);
      return;
    }
    lastTap.current = now;
    // Paused (autoplay off) → tap plays. Playing → tap toggles sound. Sound must change inside the tap,
    // so it isn't delayed; a double-tap toggles it twice (back to the same state) and likes.
    if (paused) { singleTapTimer.current = window.setTimeout(() => { setPaused(false); singleTapTimer.current = null; }, 260); return; }
    toggleSound();
  };

  const toggleFollow = async () => {
    if (!viewer) return;
    setFollowBusy(true);
    try { if (following) await unfollowCreator(viewer.uid, reel.creatorId); else await followCreator(viewer.uid, reel.creatorId); }
    catch { /* following state listener stays authoritative */ }
    finally { setFollowBusy(false); }
  };

  const captionParts = reel.caption.split(/(#[\p{L}\p{N}_]+)/u);
  const actionButton = (label: string, icon: React.ReactNode, onClick: () => void, count?: number | string, pressed?: boolean) => (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={pressed} className="flex min-w-12 flex-col items-center gap-1 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,.8)] active:scale-95">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-black/35 ring-1 ring-white/15 backdrop-blur-sm transition hover:bg-black/50">{icon}</span>
      {count !== undefined && <span className="text-xs font-bold leading-none">{count}</span>}
    </button>
  );

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {nearby && gated ? (
        <div className="absolute inset-0 z-[15]"><LowDataVideoCover url={reel.mediaUrl} poster={reel.coverUrl} label="Play Reel" className="h-full" onPlay={() => { setUnlocked(true); setPaused(false); }} /></div>
      ) : nearby ? (
        <MediaPlayer
          mediaType={reel.mediaType}
          mediaUrl={reel.mediaUrl}
          coverUrl={reel.coverUrl}
          edit={reel}
          duet={reel.duetOf}
          ref={player}
          active={active}
          muted={muted}
          paused={paused || held}
          preload={active ? 'auto' : lowData ? 'none' : 'metadata'}
          lowData={lowData}
          onSoundBlocked={onSoundBlocked}
        />
      ) : reel.coverUrl ? <img src={reel.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover opacity-80" /> : null}

      <div className="absolute inset-0 z-10 select-none" onClick={onTap} onPointerDown={onPressStart} onPointerUp={onPressEnd} onPointerCancel={onPressEnd} onPointerLeave={onPressEnd} onContextMenu={event => event.preventDefault()} aria-hidden="true" />
      {paused && active && !gated && <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white"><Play size={30} className="ml-1" /></div>}
      {held && active && <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white"><Pause size={28} /></div>}
      {flash && <div key={flash.id} className="pointer-events-none absolute left-1/2 top-1/2 z-20 grid h-20 w-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white" style={{ animation: 'echatSoundFlash .7s ease-out forwards' }} role="status" aria-label={flash.muted ? 'Sound off' : 'Sound on'}>{flash.muted ? <VolumeX size={36} /> : <Volume2 size={36} />}</div>}

      {hearts.map(heart => <Heart key={heart.id} size={96} className="pointer-events-none absolute z-30 fill-rose-500 text-rose-500 drop-shadow-lg" style={{ left: `${heart.x}%`, top: `${heart.y}%`, animation: 'echatHeartPop 1s ease-out forwards' }} />)}

      {/* right action bar */}
      <div className="absolute bottom-4 right-2 z-30 flex flex-col items-center gap-3.5">
        {actionButton(liked ? 'Unlike' : 'Like', <Heart size={26} className={liked ? 'fill-rose-500 text-rose-500' : ''} />, () => onLike(!liked), compact(reel.likesCount), liked)}
        {actionButton('Comments', <MessageCircle size={26} />, onComments, compact(reel.commentsCount))}
        {actionButton('Share', <Share2 size={26} />, onShare, 'Share')}
        {actionButton(saved ? 'Remove from Saved Reels' : 'Save to Saved Reels', <Bookmark size={26} className={saved ? 'fill-amber-400 text-amber-400' : ''} />, () => onSave(!saved), saved ? 'Saved' : 'Save', saved)}
        {actionButton('More', <MoreHorizontal size={26} />, onMore)}
      </div>

      {/* bottom info */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-3 pb-4 pr-[76px] pt-24 text-white [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_p]:pointer-events-auto">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onViewProfile?.(reel.creatorId)} className="flex min-w-0 items-center gap-2">
            <UserAvatar src={reel.creatorAvatar} name={reel.creatorName || 'EChat user'} size={36} className="ring-2 ring-white" />
            <span className="truncate text-sm font-extrabold">{reel.creatorName}</span>
          </button>
          {viewer && !isOwn && <button type="button" disabled={followBusy} onClick={() => void toggleFollow()} className={`min-h-8 shrink-0 rounded-lg px-3 text-xs font-bold ${following ? 'border border-white/70 text-white' : 'bg-[#1877F2] text-white'}`}>{following ? 'Following' : 'Follow'}</button>}
        </div>
        {(reel.caption || reel.hashtags.length > 0) && (
          <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-sm">
            {captionParts.map((part, index) => part.startsWith('#') ? <span key={index} className="font-bold">{part}</span> : part)}
            {reel.hashtags.filter(tag => !reel.caption.toLowerCase().includes(tag)).map(tag => <span key={tag} className="font-bold"> {tag}</span>)}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-white/80">
          {reel.location && <span>📍 {reel.location}</span>}
          {reel.taggedNames.length > 0 && <span>with {reel.taggedNames.slice(0, 3).join(', ')}{reel.taggedNames.length > 3 ? ` +${reel.taggedNames.length - 3}` : ''}</span>}
          <span className="flex items-center gap-1"><Eye size={12} />{compact(reel.views)} views</span>
        </div>
        {sound && (
          <button type="button" onClick={onSound} className="mt-2 flex max-w-[85%] items-center gap-1.5 overflow-hidden rounded-full bg-black/30 px-2.5 py-1 text-xs font-semibold" aria-label={`Sound: ${sound.name}. Open sound options`}>
            <Music2 size={13} className="shrink-0" />
            <span className="relative min-w-0 flex-1 overflow-hidden whitespace-nowrap">
              <span className="inline-block" style={{ animation: active ? 'echatMarquee 8s linear infinite' : 'none' }}>{sound.name} · {sound.artist}&nbsp;&nbsp;&nbsp;&nbsp;{sound.name} · {sound.artist}&nbsp;&nbsp;&nbsp;&nbsp;</span>
            </span>
          </button>
        )}
      </div>
    </div>
  );
};
