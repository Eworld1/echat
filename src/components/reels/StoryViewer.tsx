import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Check, ChevronDown, Copy, Eye, Heart, Loader2, MessageCircle, Send, Share2, SlidersHorizontal, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { auth } from '../../services/firebase';
import { api } from '../../services/api';
import { MediaPlayer } from './MediaPlayer';
import { isLowDataMode, lightImageUrl } from '../../services/lowData';
import { listenFollowingIds } from '../../services/liveDiscovery';
import { StickerPreview } from './CreateStudio';
import {
  DEFAULT_EDIT, IMAGE_SECONDS, MAX_STORY_SECONDS, addStoryComment, countStoryShare, deleteStory, deleteStoryComment, filterCss,
  listenMyStoryLikes, listenMyStorySaves, listenStoryComments, listenStoryVotes, recordStoryView, setStoryLike, setStorySave, voteOnStory,
  type MediaEdit, type StoryComment, type StorySticker
} from '../../services/reels/reelsStore';
import type { User } from '../../types';
import { useLiveList } from '../../services/liveProfiles';
const NO_COMMENTS: StoryComment[] = [];

/* ------------------------------------------------------------------ types */

export interface StorySlide { url: string; kind: 'image' | 'video' }
export interface StoryMusic { id: string; url: string; title: string; artist: string }

export interface ViewerStory {
  key: string;
  source: 'firestore' | 'legacy';
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  createdAt: number;
  kind: 'image' | 'video' | 'text';
  mediaUrl: string;
  coverUrl: string;
  text?: string;
  background?: string;
  edit: MediaEdit;
  stickers: StorySticker[];
  views: number;
  legacyAuthor?: User;
  /** TikTok-style photo carousel (new stories): each photo is its own slide, music plays across them. */
  carousel?: boolean;
  slides?: StorySlide[];
  caption?: string;
  hashtags?: string[];
  music?: StoryMusic | null;
  likesCount?: number;
  commentsCount?: number;
  savesCount?: number;
  sharesCount?: number;
}

export interface StoryGroup { authorId: string; authorName: string; authorAvatar: string; stories: ViewerStory[] }

interface StoryViewerProps {
  groups: StoryGroup[];
  startGroup: number;
  /** Open on this story inside the start group (shared links). */
  startStoryId?: string;
  onClose: () => void;
  onSeen: (story: ViewerStory) => void;
  onReply: (story: ViewerStory, text: string) => Promise<void>;
  onLegacyView?: (story: ViewerStory) => void;
  /** "Use this sound": start a new story with the same music. */
  onUseSound?: (music: StoryMusic) => void;
  /** Composer preview: no tabs, likes, comments or view counting. */
  preview?: boolean;
}

type Tab = 'community' | 'following' | 'foryou';
type Pos = { g: number; s: number };
interface FlatSlide { key: string; story: ViewerStory; index: number; count: number; url: string; kind: 'image' | 'text' | 'media' }

const PHOTO_MS = 5000;
const TEXT_MS = IMAGE_SECONDS * 1000;
const ANIM_MS = 280;
const GOLD = '#f5c518';
const VOLUME_KEY = 'echat_story_volume';
const MUTED_KEY = 'echat_story_muted';

const readNumber = (key: string, fallback: number) => { try { const value = Number(localStorage.getItem(key)); return Number.isFinite(value) && localStorage.getItem(key) !== null ? value : fallback; } catch { return fallback; } };
const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } };
const compact = (count: number) => count >= 1_000_000 ? `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : count >= 1000 ? `${(count / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(Math.max(0, count));
const timeAgo = (at: number) => {
  const minutes = Math.max(1, Math.round((Date.now() - at) / 60000));
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
};

/** Phone-sized photos: 1080px from Cloudinary (800px economy copy in Low Data Mode). Local previews untouched. */
export function storyImageUrl(url: string): string {
  if (isLowDataMode()) return lightImageUrl(url);
  return url.replace(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(?!c_|w_|q_|f_)/, '$1c_limit,w_1080,q_auto,f_auto/');
}

export function slidesOf(group: StoryGroup | undefined): FlatSlide[] {
  if (!group) return [];
  return group.stories.flatMap<FlatSlide>(story => story.carousel && story.slides?.length
    ? story.slides.map((slide, index) => ({ key: `${story.key}#${index}`, story, index, count: story.slides!.length, url: slide.url, kind: 'image' as const }))
    : [{ key: story.key, story, index: 0, count: 1, url: story.mediaUrl, kind: story.kind === 'text' ? 'text' as const : 'media' as const }]);
}

export const storyShareLink = (story: Pick<ViewerStory, 'id'>) => `${window.location.origin}/home?story=${encodeURIComponent(story.id)}`;

/* ------------------------------------------------------------------ viewer */

export const StoryViewer: React.FC<StoryViewerProps> = ({ groups, startGroup, startStoryId, onClose, onSeen, onReply, onLegacyView, onUseSound, preview = false }) => {
  const { user } = useAuth();
  const uid = auth.currentUser?.uid || user?.id || '';

  // Group order is frozen while the viewer is open (seen / like changes must not reshuffle people under the finger).
  const [tab, setTab] = useState<Tab>('community');
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [order, setOrder] = useState<string[]>(() => groups.map(group => group.authorId));
  useEffect(() => preview || !uid ? undefined : listenFollowingIds(uid, setFollowingIds, () => setFollowingIds([])), [uid, preview]);

  const list = useMemo(() => order.map(id => groups.find(group => group.authorId === id)).filter(Boolean) as StoryGroup[], [order, groups]);

  const [pos, setPos] = useState<Pos>(() => {
    const group = groups[startGroup];
    const slides = slidesOf(group);
    const index = startStoryId ? slides.findIndex(slide => slide.story.id === startStoryId) : -1;
    return { g: Math.max(0, startGroup), s: Math.max(0, index) };
  });

  const group = list[pos.g];
  const slides = useMemo(() => slidesOf(group), [group]);
  const slide = slides[Math.min(pos.s, Math.max(0, slides.length - 1))];
  const story = slide?.story;
  const isOwn = Boolean(story && story.authorId === uid);
  const interactive = !preview && story?.source === 'firestore' && Boolean(uid);

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    const friends = new Set([...(user?.friends || []), ...followingIds]);
    let ids = groups.map(item => item.authorId);
    if (next === 'following') ids = ids.filter(id => friends.has(id) && id !== uid);
    if (next === 'foryou') {
      const score = (item: StoryGroup) => item.stories.reduce((sum, entry) => sum + (entry.likesCount || 0) * 3 + (entry.commentsCount || 0) * 4 + (entry.views || 0), 0);
      ids = [...groups].filter(item => item.authorId !== uid).sort((a, b) => score(b) - score(a)).map(item => item.authorId);
    }
    setTab(next);
    setOrder(ids);
    setPos({ g: 0, s: 0 });
  };

  /* ---- neighbours ---- */
  const nextPos = (from: Pos): Pos | null => {
    const count = slidesOf(list[from.g]).length;
    if (from.s + 1 < count) return { g: from.g, s: from.s + 1 };
    return from.g + 1 < list.length ? { g: from.g + 1, s: 0 } : null;
  };
  const prevPos = (from: Pos): Pos | null => {
    if (from.s > 0) return { g: from.g, s: from.s - 1 };
    if (from.g === 0) return null;
    return { g: from.g - 1, s: Math.max(0, slidesOf(list[from.g - 1]).length - 1) };
  };
  const slideAt = (at: Pos | null) => (at ? slidesOf(list[at.g])[at.s] : undefined);
  const next = nextPos(pos);
  const prev = prevPos(pos);

  /* ---- pause state ---- */
  const [held, setHeld] = useState(false);
  const [typing, setTyping] = useState(false);
  const [sheet, setSheet] = useState<'' | 'comments' | 'share' | 'volume' | 'menu'>('');
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => { const onVisibility = () => setHidden(document.hidden); document.addEventListener('visibilitychange', onVisibility); return () => document.removeEventListener('visibilitychange', onVisibility); }, []);

  /* ---- slide animation ---- */
  const [anim, setAnim] = useState<'' | 'next' | 'prev'>('');
  const [dragX, setDragX] = useState(0);
  const [dragY, setDragY] = useState(0);
  const [settling, setSettling] = useState(false);
  const animTimer = useRef(0);
  const paused = held || typing || hidden || Boolean(sheet && sheet !== 'volume') || Boolean(anim) || dragX !== 0;

  const go = useCallback((direction: 'next' | 'prev') => {
    if (anim) return;
    const target = direction === 'next' ? nextPos(pos) : prevPos(pos);
    if (!target) {
      if (direction === 'next' && preview) { setPos({ g: 0, s: 0 }); return; } // preview loops
      if (direction === 'next') onClose();
      else { setSettling(true); setDragX(0); window.setTimeout(() => setSettling(false), ANIM_MS); }
      return;
    }
    setAnim(direction);
    window.clearTimeout(animTimer.current);
    animTimer.current = window.setTimeout(() => { setPos(target); setAnim(''); setDragX(0); }, ANIM_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim, pos, list, onClose, preview]);
  useEffect(() => () => window.clearTimeout(animTimer.current), []);

  /* ---- progress (DOM-driven: no re-render per frame, smooth on low-end phones) ---- */
  const barRef = useRef<HTMLDivElement | null>(null);
  const barsRef = useRef<HTMLDivElement | null>(null);
  const elapsed = useRef(0);
  const setBar = (fraction: number) => { if (barRef.current) barRef.current.style.transform = `scaleX(${Math.min(1, Math.max(0, fraction))})`; };
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());
  const markLoaded = (key: string) => setLoaded(current => current.has(key) ? current : new Set(current).add(key));
  const ready = slide ? slide.kind !== 'image' || loaded.has(slide.key) : false;

  // Bars are painted directly (see setBar), so repaint them all when the slide changes (also when going back).
  useEffect(() => {
    elapsed.current = 0;
    Array.from(barsRef.current?.children || []).forEach((bar, index) => {
      const fill = bar.firstElementChild as HTMLElement | null;
      if (fill) fill.style.transform = `scaleX(${index < pos.s ? 1 : 0})`;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide?.key]);
  useEffect(() => {
    if (!slide || slide.kind === 'media' || paused || !ready) return;
    const duration = slide.kind === 'text' ? TEXT_MS : PHOTO_MS;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      elapsed.current += now - last;
      last = now;
      const fraction = elapsed.current / duration;
      setBar(fraction);
      if (fraction >= 1) { go('next'); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [slide?.key, paused, ready, go]);

  /* ---- seen / views (once per story per person) ---- */
  useEffect(() => {
    if (!story || preview) return;
    onSeen(story);
    if (story.source === 'firestore' && !isOwn) recordStoryView(story.id, uid, story.authorId);
    if (story.source === 'legacy') onLegacyView?.(story);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.key]);

  /* ---- preload the photo after next ---- */
  useEffect(() => {
    const after = next ? slideAt(nextPos(next)) : undefined;
    if (after?.kind === 'image') { const image = new Image(); image.decoding = 'async'; image.src = storyImageUrl(after.url); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide?.key]);

  /* ---- music ---- */
  const [muted, setMuted] = useState(() => readNumber(MUTED_KEY, 0) === 1);
  const [volume, setVolume] = useState(() => Math.min(1, Math.max(0, readNumber(VOLUME_KEY, 0.8))));
  const [soundBlocked, setSoundBlocked] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const musicUrl = story?.carousel ? story.music?.url || '' : '';
  const toggleMute = () => { setMuted(value => { store(MUTED_KEY, value ? '0' : '1'); return !value; }); setSoundBlocked(false); };

  useEffect(() => {
    if (!audioRef.current) { audioRef.current = new Audio(); audioRef.current.loop = true; audioRef.current.preload = 'auto'; }
    const audio = audioRef.current;
    if (!musicUrl) { audio.pause(); return; }
    if (audio.dataset.src !== musicUrl) { audio.src = musicUrl; audio.dataset.src = musicUrl; }
  }, [musicUrl]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    // Muted = paused (no data used); held / hidden pauses too.
    if (!musicUrl || muted || held || hidden) { audio.pause(); return; }
    audio.play().then(() => setSoundBlocked(false)).catch(() => setSoundBlocked(true));
  }, [musicUrl, muted, volume, held, hidden]);
  useEffect(() => () => { const audio = audioRef.current; if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); } }, []);

  /* ---- likes / saves ---- */
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Record<string, { liked?: boolean; saved?: boolean }>>({});
  useEffect(() => preview ? undefined : listenMyStoryLikes(uid, setLikedIds), [uid, preview]);
  useEffect(() => preview ? undefined : listenMyStorySaves(uid, setSavedIds), [uid, preview]);
  const liked = story ? pending[story.id]?.liked ?? likedIds.has(story.id) : false;
  const saved = story ? pending[story.id]?.saved ?? savedIds.has(story.id) : false;
  const serverLiked = story ? likedIds.has(story.id) : false;
  const serverSaved = story ? savedIds.has(story.id) : false;
  const likeCount = (story?.likesCount || 0) + (liked === serverLiked ? 0 : liked ? 1 : -1);
  const saveCount = (story?.savesCount || 0) + (saved === serverSaved ? 0 : saved ? 1 : -1);
  const [toast, setToast] = useState('');
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 2200); return () => window.clearTimeout(timer); }, [toast]);

  const setLike = (value: boolean) => {
    if (!story || !interactive || value === liked) return;
    const id = story.id;
    setPending(current => ({ ...current, [id]: { ...current[id], liked: value } }));
    setStoryLike(id, uid, value)
      .catch(() => setToast('Could not update like'))
      .finally(() => setPending(current => { const copy = { ...current }; if (copy[id]) delete copy[id].liked; return copy; }));
  };
  const setSave = (value: boolean) => {
    if (!story || !interactive) return;
    const id = story.id;
    setPending(current => ({ ...current, [id]: { ...current[id], saved: value } }));
    setStorySave(id, uid, value)
      .then(() => setToast(value ? 'Saved' : 'Removed from saved'))
      .catch(() => setToast('Could not save'))
      .finally(() => setPending(current => { const copy = { ...current }; if (copy[id]) delete copy[id].saved; return copy; }));
  };

  /* ---- gestures ---- */
  const areaRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number; at: number; axis: '' | 'x' | 'y'; holding: boolean } | null>(null);
  const holdTimer = useRef(0);
  const tapTimer = useRef(0);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number }[]>([]);

  const popHeart = (x: number, y: number) => {
    const id = Date.now() + Math.random();
    setHearts(current => [...current.slice(-3), { id, x, y }]);
    window.setTimeout(() => setHearts(current => current.filter(heart => heart.id !== id)), 900);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (anim) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    press.current = { x: event.clientX, y: event.clientY, at: Date.now(), axis: '', holding: false };
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => { if (press.current && !press.current.axis) { press.current.holding = true; setHeld(true); } }, 260);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const start = press.current;
    if (!start || start.holding) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.axis && Math.hypot(dx, dy) > 10) { start.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; window.clearTimeout(holdTimer.current); }
    if (start.axis === 'x') {
      const blocked = (dx < 0 && !next && !preview) || (dx > 0 && !prev);
      setDragX(blocked ? dx * 0.25 : dx);
    } else if (start.axis === 'y') setDragY(Math.max(0, dy));
  };
  const endPress = (event: React.PointerEvent, cancelled = false) => {
    window.clearTimeout(holdTimer.current);
    const start = press.current;
    press.current = null;
    if (!start) return;
    if (start.holding) { setHeld(false); return; }
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const width = areaRef.current?.clientWidth || window.innerWidth;
    if (start.axis === 'x') {
      const fast = Math.abs(dx) / Math.max(1, Date.now() - start.at) > 0.45;
      if (!cancelled && (Math.abs(dx) > width * 0.18 || (fast && Math.abs(dx) > 30))) {
        if (dx < 0 && (next || !preview)) { go('next'); return; }
        if (dx > 0 && prev) { go('prev'); return; }
      }
      setSettling(true); setDragX(0); window.setTimeout(() => setSettling(false), ANIM_MS);
      return;
    }
    if (start.axis === 'y') {
      if (!cancelled && dy > 110) { onClose(); return; }
      setDragY(0);
      return;
    }
    if (cancelled) return;
    // Tap: wait briefly for a second tap (double-tap = like).
    const now = Date.now();
    const box = areaRef.current?.getBoundingClientRect();
    const x = event.clientX - (box?.left || 0);
    const y = event.clientY - (box?.top || 0);
    if (lastTap.current && now - lastTap.current.at < 300 && Math.hypot(x - lastTap.current.x, y - lastTap.current.y) < 60) {
      window.clearTimeout(tapTimer.current);
      lastTap.current = null;
      if (interactive) { popHeart(x, y); setLike(true); }
      return;
    }
    lastTap.current = { at: now, x, y };
    window.clearTimeout(tapTimer.current);
    const leftSide = x < (box?.width || width) / 3;
    tapTimer.current = window.setTimeout(() => { lastTap.current = null; go(leftSide ? 'prev' : 'next'); }, interactive ? 250 : 0);
  };
  useEffect(() => () => { window.clearTimeout(tapTimer.current); window.clearTimeout(holdTimer.current); }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typing || sheet) { if (event.key === 'Escape') setSheet(''); return; }
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') go('next');
      if (event.key === 'ArrowLeft') go('prev');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [typing, sheet, go, onClose]);

  useEffect(() => { if (!group && list.length > 0) onClose(); }, [group, list.length, onClose]);

  const [reply, setReply] = useState('');
  const send = async (text: string, message: string) => {
    if (!story) return;
    try { await onReply(story, text); setToast(message); }
    catch (error) { setToast(error instanceof Error ? error.message : 'Could not send.'); }
  };

  if (!group || !slide || !story) {
    return list.length === 0 ? (
      <div className="fixed inset-0 z-[220] flex flex-col items-center justify-center gap-3 bg-black text-white" role="dialog" aria-modal="true">
        <p className="font-bold">No stories here yet</p>
        <button type="button" onClick={() => switchTab('community')} className="rounded-full px-4 py-2 text-sm font-bold text-black" style={{ background: GOLD }}>Show all stories</button>
        <button type="button" onClick={onClose} className="text-sm text-white/70">Close</button>
      </div>
    ) : null;
  }

  /* ---- render helpers ---- */
  const renderSlide = (item: FlatSlide | undefined, role: 'prev' | 'current' | 'next') => {
    if (!item) return null;
    const offset = role === 'prev' ? '-100%' : role === 'next' ? '100%' : '0%';
    const isCurrent = role === 'current';
    let body: React.ReactNode;
    if (item.kind === 'text') {
      body = <div className="flex h-full w-full items-center justify-center p-8 text-center text-2xl font-extrabold text-white" style={{ background: item.story.background || 'linear-gradient(135deg,#1877F2,#7c3aed)' }}>{item.story.text}</div>;
    } else if (item.kind === 'image') {
      body = (
        <>
          <img src={storyImageUrl(item.url)} alt={item.story.caption || `${item.story.authorName}'s story photo ${item.index + 1}`} decoding="async" draggable={false}
            onLoad={() => markLoaded(item.key)} onError={() => markLoaded(item.key)}
            className="h-full w-full select-none object-contain" style={{ filter: filterCss(item.story.edit.filter) }} />
          {isCurrent && !loaded.has(item.key) && <Loader2 size={34} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin text-white/70" />}
        </>
      );
    } else if (isCurrent && !anim) {
      body = (
        <MediaPlayer
          key={item.key}
          mediaType={item.story.kind === 'video' ? 'video' : 'image'}
          mediaUrl={item.story.mediaUrl}
          coverUrl={item.story.coverUrl}
          edit={item.story.edit}
          active
          muted={muted}
          paused={paused}
          loop={false}
          maxSeconds={MAX_STORY_SECONDS}
          onProgress={setBar}
          onEnded={() => go('next')}
          onSoundBlocked={() => setSoundBlocked(true)}
          lowData={isLowDataMode()}
        />
      );
    } else {
      const still = item.story.coverUrl || (item.story.kind === 'image' ? item.story.mediaUrl : '');
      body = still ? <img src={storyImageUrl(still)} alt="" decoding="async" draggable={false} className="h-full w-full object-contain" /> : null;
    }
    return <div key={item.key} className="absolute inset-0 overflow-hidden bg-black" style={{ transform: `translateX(${offset})` }} aria-hidden={!isCurrent}>{body}</div>;
  };

  const trackTransform = anim === 'next' ? 'translateX(-100%)' : anim === 'prev' ? 'translateX(100%)' : `translateX(${dragX}px)`;
  const trackTransition = anim || settling ? `transform ${ANIM_MS}ms cubic-bezier(.2,.8,.2,1)` : 'none';
  const music = story.carousel ? story.music : (story.edit.soundUrl ? { id: story.edit.soundId, url: story.edit.soundUrl, title: story.edit.soundName, artist: story.edit.soundArtist } : null);
  const counter = slides.length > 1 ? `${pos.s + 1} / ${slides.length}` : '';
  const hasSound = Boolean(musicUrl) || slide.kind === 'media';
  const legacyReactions = story.source === 'legacy' && !isOwn && !preview;

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black" role="dialog" aria-modal="true" aria-label={`${group.authorName}'s story`}
      style={{ opacity: dragY ? Math.max(0.4, 1 - dragY / 600) : 1 }}>
      <div className="relative h-full w-full max-w-[480px] select-none overflow-hidden bg-black sm:h-[94vh] sm:rounded-2xl"
        style={{ transform: dragY ? `translateY(${dragY}px) scale(${Math.max(0.85, 1 - dragY / 1500)})` : undefined, transition: dragY ? 'none' : 'transform 200ms ease' }}>

        {/* slides */}
        <div ref={areaRef} className="absolute inset-0 touch-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={event => endPress(event)} onPointerCancel={event => endPress(event, true)} onContextMenu={event => event.preventDefault()}>
          <div className="absolute inset-0 will-change-transform" style={{ transform: trackTransform, transition: trackTransition }}>
            {renderSlide(slideAt(prev), 'prev')}
            {renderSlide(slide, 'current')}
            {renderSlide(slideAt(next), 'next')}
          </div>
        </div>

        {/* readability gradients */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-36 bg-gradient-to-b from-black/60 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-64 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

        {/* progress bars: one per photo */}
        <div ref={barsRef} className="absolute inset-x-2 top-[max(0.5rem,env(safe-area-inset-top))] z-30 flex gap-1">
          {slides.map((item, index) => (
            <div key={item.key} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
              <div ref={index === pos.s ? barRef : undefined} className="h-full w-full origin-left bg-white" style={{ transform: `scaleX(${index < pos.s ? 1 : 0})` }} />
            </div>
          ))}
        </div>

        {/* top bar: Story ▾ · tabs · close */}
        <div className="absolute inset-x-2 top-[calc(max(0.5rem,env(safe-area-inset-top))+10px)] z-30 flex items-center gap-1 text-white">
          {preview ? <span className="rounded-full bg-black/40 px-3 py-1.5 text-xs font-bold">Preview</span> : (
            <div className="relative">
              <button type="button" onClick={() => setSheet(sheet === 'menu' ? '' : 'menu')} aria-expanded={sheet === 'menu'} className="flex min-h-9 items-center gap-0.5 rounded-full px-2 text-[15px] font-extrabold">Story<ChevronDown size={16} /></button>
              {sheet === 'menu' && (
                <div className="absolute left-0 top-10 w-40 overflow-hidden rounded-xl bg-white py-1 text-sm font-semibold text-slate-900 shadow-xl">
                  <button type="button" onClick={() => setSheet('')} className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-slate-100">Stories<Check size={15} className="text-[#b68428]" /></button>
                  <button type="button" onClick={() => { onClose(); window.history.pushState({ echatApp: true, tab: 'reels' }, '', '/reels'); window.dispatchEvent(new Event('echat:navigate')); }} className="w-full px-3 py-2.5 text-left hover:bg-slate-100">Reels</button>
                </div>
              )}
            </div>
          )}
          {!preview && (
            <div className="flex min-w-0 flex-1 justify-center gap-3 text-[13px] font-bold sm:gap-4" role="tablist" aria-label="Story feeds">
              {([['community', 'Community'], ['following', 'Following'], ['foryou', 'For You']] as [Tab, string][]).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => switchTab(id)} className={`relative min-h-9 shrink-0 ${tab === id ? 'text-white' : 'text-white/60'}`}>
                  {label}{tab === id && <span className="absolute inset-x-1 -bottom-0.5 h-[2px] rounded-full" style={{ background: GOLD }} />}
                </button>
              ))}
            </div>
          )}
          {preview && <span className="flex-1" />}
          <button type="button" onClick={onClose} aria-label="Close stories" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/25"><X size={22} /></button>
        </div>

        {/* counter + sound controls */}
        <div className="absolute right-2 top-[calc(max(0.5rem,env(safe-area-inset-top))+56px)] z-30 flex items-center gap-1.5 text-white">
          {counter && <span className="rounded-full bg-black/45 px-2.5 py-1 text-xs font-extrabold tabular-nums">{counter}</span>}
          {hasSound && <button type="button" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} className="grid h-9 w-9 place-items-center rounded-full bg-black/45">{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>}
          {musicUrl && <button type="button" onClick={() => setSheet(sheet === 'volume' ? '' : 'volume')} aria-label="Volume" aria-expanded={sheet === 'volume'} className="grid h-9 w-9 place-items-center rounded-full bg-black/45"><SlidersHorizontal size={16} /></button>}
          {sheet === 'volume' && (
            <div className="absolute right-0 top-11 flex w-52 items-center gap-2 rounded-2xl bg-black/80 px-3 py-2.5">
              <VolumeX size={15} className="shrink-0 opacity-70" />
              <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} aria-label="Music volume"
                onChange={event => { const value = Number(event.target.value); setVolume(value); store(VOLUME_KEY, String(value)); if (value > 0 && muted) toggleMute(); }}
                className="min-w-0 flex-1" style={{ accentColor: GOLD }} />
              <Volume2 size={15} className="shrink-0 opacity-70" />
            </div>
          )}
        </div>

        {soundBlocked && !muted && hasSound && (
          <button type="button" onClick={() => { setSoundBlocked(false); void audioRef.current?.play().catch(() => {}); }} className="absolute left-1/2 top-28 z-30 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm font-bold text-white">🔊 Tap for sound</button>
        )}

        {/* old-style stickers (polls, questions…) */}
        {slide.kind === 'media' && !anim && story.stickers.map((sticker, index) => (
          <div key={index} className="absolute z-20 w-[72%] -translate-x-1/2 -translate-y-1/2" style={{ left: `${sticker.x}%`, top: `${sticker.y}%` }}>
            <InteractiveSticker sticker={sticker} story={story} uid={uid} isOwn={isOwn} soundName={story.edit.soundName} onAnswer={text => void send(`Answered "${sticker.prompt}": ${text}`, 'Answer sent')} onTyping={setTyping} />
          </div>
        ))}

        {hearts.map(heart => (
          <Heart key={heart.id} size={96} fill={GOLD} color={GOLD} className="ec-heart-pop pointer-events-none absolute z-40 drop-shadow-[0_4px_16px_rgba(0,0,0,.5)]" style={{ left: heart.x, top: heart.y }} />
        ))}
        {held && <span className="pointer-events-none absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-1 text-xs font-bold text-white">Paused</span>}
        {toast && <p role="status" className="absolute left-1/2 top-24 z-40 -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 text-sm font-semibold text-white">{toast}</p>}

        {/* right rail */}
        {!preview && (
          <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+7.5rem)] right-2 z-30 flex flex-col items-center gap-4 text-white">
            {story.source === 'firestore' && <>
              <RailButton label={liked ? 'Unlike' : 'Like'} count={likeCount} onClick={() => setLike(!liked)} active={liked}>
                <Heart size={30} fill={liked ? GOLD : 'none'} color={liked ? GOLD : 'white'} className={liked ? 'ec-like-bump' : ''} />
              </RailButton>
              <RailButton label="Comments" count={story.commentsCount || 0} onClick={() => setSheet('comments')}><MessageCircle size={29} /></RailButton>
              <RailButton label="Share" count={story.sharesCount || 0} onClick={() => setSheet('share')}><Share2 size={28} /></RailButton>
              <RailButton label={saved ? 'Unsave' : 'Save'} count={saveCount} onClick={() => setSave(!saved)} active={saved}>
                <Bookmark size={28} fill={saved ? GOLD : 'none'} color={saved ? GOLD : 'white'} />
              </RailButton>
            </>}
            {isOwn && story.source === 'firestore' && (
              <RailButton label="Delete story" onClick={() => { if (window.confirm('Delete this story?')) void deleteStory(story.id).then(() => { setToast('Story deleted'); go('next'); }).catch(() => setToast('Could not delete')); }}><Trash2 size={24} /></RailButton>
            )}
            {music && (
              <span className={`grid h-11 w-11 place-items-center rounded-full border-[6px] border-[#222] bg-[#111] ${muted || held ? '' : 'animate-[spin_4s_linear_infinite]'}`} aria-hidden="true">
                <img src={group.authorAvatar || '/logo-mark-blue.svg'} alt="" className="h-6 w-6 rounded-full object-cover" />
              </span>
            )}
          </div>
        )}

        {/* bottom: author, caption, hashtags, music */}
        <div className="absolute inset-x-0 bottom-0 z-30 space-y-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-white">
          <div className="max-w-[calc(100%-4.5rem)] space-y-1.5">
            <div className="flex items-center gap-2">
              <img src={group.authorAvatar || '/logo-mark-blue.svg'} alt="" className="h-9 w-9 rounded-full border-2 object-cover" style={{ borderColor: GOLD }} />
              <p className="min-w-0 truncate text-[15px] font-extrabold">{group.authorName}</p>
              <span className="shrink-0 text-xs text-white/70">· {timeAgo(story.createdAt)}</span>
            </div>
            {story.caption && <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-snug">{story.caption}</p>}
            {Boolean(story.hashtags?.length) && <p className="line-clamp-1 text-sm font-bold" style={{ color: GOLD }}>{story.hashtags!.join(' ')}</p>}
            {music && (
              <div className="flex items-center gap-2">
                <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
                  <span className="truncate">♫ {music.title || 'Music'}{music.artist ? ` - ${music.artist}` : ''}</span>
                </p>
                {onUseSound && !preview && (
                  <button type="button" onClick={() => { onUseSound({ id: music.id, url: music.url, title: music.title, artist: music.artist }); }} className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold text-black" style={{ background: GOLD }}>Use this sound</button>
                )}
              </div>
            )}
            {isOwn && !preview && <p className="flex items-center gap-1.5 text-xs font-semibold text-white/80"><Eye size={14} />{story.views} {story.views === 1 ? 'view' : 'views'}</p>}
          </div>

          {!isOwn && !preview && (
            <>
              {legacyReactions && <div className="flex justify-center gap-3">{['❤️', '🔥', '😂', '😮', '😢'].map(emoji => <button key={emoji} type="button" onClick={() => void send(`Reacted ${emoji} to your story`, `Sent ${emoji}`)} aria-label={`React ${emoji}`} className="text-3xl transition active:scale-125">{emoji}</button>)}</div>}
              <form onSubmit={event => { event.preventDefault(); const text = reply.trim(); if (!text) return; setReply(''); (document.activeElement as HTMLElement | null)?.blur(); void send(`Replying to your story: "${text}"`, 'Reply sent'); }} className="flex gap-2">
                <input value={reply} onChange={event => setReply(event.target.value)} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} maxLength={500} placeholder={`Message ${group.authorName}…`} className="min-h-11 min-w-0 flex-1 rounded-full border border-white/40 bg-black/30 px-4 text-sm text-white placeholder:text-white/60 focus:border-[#f5c518] focus:outline-none" />
                <button type="submit" disabled={!reply.trim()} aria-label="Send message" className="grid h-11 w-11 place-items-center rounded-full text-black disabled:opacity-40" style={{ background: GOLD }}><Send size={18} /></button>
              </form>
            </>
          )}
        </div>

        {sheet === 'comments' && interactive && <CommentsSheet story={story} uid={uid} isOwnStory={isOwn} onClose={() => setSheet('')} onTyping={setTyping} />}
        {sheet === 'share' && interactive && <ShareSheet story={story} onClose={() => setSheet('')} onDone={message => { setSheet(''); setToast(message); }} />}
      </div>
    </div>
  );
};

const RailButton: React.FC<{ label: string; count?: number; onClick: () => void; active?: boolean; children: React.ReactNode }> = ({ label, count, onClick, active, children }) => (
  <button type="button" onClick={onClick} aria-label={count !== undefined ? `${label} (${count})` : label} aria-pressed={active}
    className="flex flex-col items-center gap-0.5 drop-shadow-[0_1px_3px_rgba(0,0,0,.6)] transition active:scale-90">
    {children}
    {count !== undefined && <span className="text-xs font-bold tabular-nums">{compact(count)}</span>}
  </button>
);

/* ------------------------------------------------------------------ comments */

const CommentsSheet: React.FC<{ story: ViewerStory; uid: string; isOwnStory: boolean; onClose: () => void; onTyping: (typing: boolean) => void }> = ({ story, uid, isOwnStory, onClose, onTyping }) => {
  const { user } = useAuth();
  const [savedComments, setComments] = useState<StoryComment[] | null>(null);
  const liveComments = useLiveList(savedComments || NO_COMMENTS, 'authorId', 'authorName', 'authorAvatar');
  const comments = savedComments === null ? null : liveComments;
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => listenStoryComments(story.id, items => { setComments(items); setError(''); }, err => setError(err.message)), [story.id]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [comments?.length]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim() || busy || !user) return;
    setBusy(true);
    try { await addStoryComment(story.id, { id: uid, name: user.name || 'EChat user', avatar: user.avatar || '' }, text); setText(''); }
    catch (err) { setError(/permission/i.test(String((err as Error)?.message)) ? 'Verify your account to comment.' : 'Could not post your comment.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div className="flex max-h-[65%] flex-col rounded-t-3xl bg-white text-slate-900" onClick={event => event.stopPropagation()} role="dialog" aria-label="Comments">
        <div className="relative border-b border-slate-100 px-4 py-3 text-center">
          <span className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-slate-300" />
          <p className="text-sm font-extrabold">{(() => { const count = comments?.length ?? story.commentsCount ?? 0; return `${compact(count)} ${count === 1 ? 'comment' : 'comments'}`; })()}</p>
          <button type="button" onClick={onClose} aria-label="Close comments" className="absolute right-2 top-1.5 grid h-9 w-9 place-items-center rounded-full hover:bg-slate-100"><X size={18} /></button>
        </div>
        <ul ref={listRef} className="min-h-[120px] flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {comments === null && <li className="py-6 text-center text-sm text-slate-400">Loading…</li>}
          {comments?.length === 0 && <li className="py-6 text-center text-sm text-slate-500">No comments yet. Be the first!</li>}
          {comments?.map(comment => (
            <li key={comment.id} className="flex gap-2.5">
              <img src={comment.authorAvatar || '/logo-mark-blue.svg'} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-500">{comment.authorName} · {timeAgo(comment.createdAt)}</p>
                <p className="whitespace-pre-wrap break-words text-sm">{comment.text}</p>
              </div>
              {(comment.authorId === uid || isOwnStory) && <button type="button" onClick={() => void deleteStoryComment(comment.id).catch(() => setError('Could not delete.'))} aria-label="Delete comment" className="self-start p-1 text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>}
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="px-4 pb-1 text-xs font-semibold text-rose-600">{error}</p>}
        <form onSubmit={submit} className="flex gap-2 border-t border-slate-100 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <input value={text} onChange={event => setText(event.target.value)} onFocus={() => onTyping(true)} onBlur={() => onTyping(false)} maxLength={500} placeholder="Add a comment…" className="min-h-11 min-w-0 flex-1 rounded-full bg-[#f1f2f4] px-4 text-sm outline-none focus:ring-2 focus:ring-[#e9c86a]" />
          <button type="submit" disabled={!text.trim() || busy} aria-label="Post comment" className="grid h-11 w-11 place-items-center rounded-full text-black disabled:opacity-40" style={{ background: GOLD }}>{busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}</button>
        </form>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ share */

const ShareSheet: React.FC<{ story: ViewerStory; onClose: () => void; onDone: (message: string) => void }> = ({ story, onClose, onDone }) => {
  const { user } = useAuth();
  const [friends, setFriends] = useState<User[] | null>(null);
  const [sending, setSending] = useState('');
  const link = storyShareLink(story);
  const text = `${story.authorName}'s story on eChat${story.caption ? `: ${story.caption.slice(0, 80)}` : ''}`;

  useEffect(() => {
    const ids = new Set(user?.friends || []);
    if (!ids.size) { setFriends([]); return; }
    api.getUsers().then(all => setFriends(all.filter(person => ids.has(person.id)).slice(0, 50))).catch(() => setFriends([]));
  }, [user?.friends]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); } catch { window.prompt('Copy this link', link); }
    countStoryShare(story.id);
    onDone('Link copied');
  };
  const sendTo = async (friend: User) => {
    setSending(friend.id);
    try { await api.sendMessage({ receiverId: friend.id, text: `${text}\n${link}` }); countStoryShare(story.id); onDone(`Sent to ${friend.name}`); }
    catch { onDone('Could not send'); }
    finally { setSending(''); }
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div className="rounded-t-3xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-slate-900" onClick={event => event.stopPropagation()} role="dialog" aria-label="Share story">
        <div className="mb-3 flex items-center justify-between"><p className="font-extrabold">Share story</p><button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full hover:bg-slate-100"><X size={18} /></button></div>
        <div className="grid grid-cols-3 gap-2">
          <a href={`https://wa.me/?text=${encodeURIComponent(`${text}\n${link}`)}`} target="_blank" rel="noopener noreferrer" onClick={() => { countStoryShare(story.id); onDone('Opening WhatsApp…'); }}
            className="flex flex-col items-center gap-1.5 rounded-2xl bg-[#ecfdf3] py-3 text-xs font-bold text-[#128c4a]"><span className="grid h-11 w-11 place-items-center rounded-full bg-[#25D366] text-white"><MessageCircle size={22} /></span>WhatsApp</a>
          <button type="button" onClick={() => void copy()} className="flex flex-col items-center gap-1.5 rounded-2xl bg-[#fdf6e3] py-3 text-xs font-bold text-[#8a6d1f]"><span className="grid h-11 w-11 place-items-center rounded-full text-black" style={{ background: GOLD }}><Copy size={20} /></span>Copy Link</button>
          {typeof navigator.share === 'function'
            ? <button type="button" onClick={() => void navigator.share({ title: 'eChat story', text, url: link }).then(() => { countStoryShare(story.id); onDone('Shared'); }).catch(() => {})} className="flex flex-col items-center gap-1.5 rounded-2xl bg-slate-100 py-3 text-xs font-bold text-slate-700"><span className="grid h-11 w-11 place-items-center rounded-full bg-slate-800 text-white"><Share2 size={20} /></span>More…</button>
            : <span />}
        </div>
        <p className="mb-2 mt-4 text-xs font-bold uppercase tracking-wider text-slate-500">Share to eChat Chat</p>
        {friends === null ? <p className="py-3 text-center text-sm text-slate-400">Loading friends…</p>
          : friends.length === 0 ? <p className="py-3 text-center text-sm text-slate-500">Add friends to share stories in chat.</p>
            : (
              <ul className="flex gap-3 overflow-x-auto pb-1">
                {friends.map(friend => (
                  <li key={friend.id} className="w-16 shrink-0 text-center">
                    <button type="button" onClick={() => void sendTo(friend)} disabled={Boolean(sending)} className="flex w-full flex-col items-center gap-1 disabled:opacity-60">
                      <span className="relative"><img src={friend.avatar || '/logo-mark-blue.svg'} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-[#e2c06e]" />{sending === friend.id && <Loader2 size={18} className="absolute inset-0 m-auto animate-spin text-white" />}</span>
                      <span className="w-full truncate text-[11px] font-semibold">{friend.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ old stickers */

const InteractiveSticker: React.FC<{ sticker: StorySticker; story: ViewerStory; uid: string; isOwn: boolean; soundName: string; onAnswer: (text: string) => void; onTyping: (typing: boolean) => void }> = ({ sticker, story, uid, isOwn, soundName, onAnswer, onTyping }) => {
  const [votes, setVotes] = useState<{ userId: string; kind: string; value: number }[]>([]);
  const [slider, setSlider] = useState(50);
  const [answer, setAnswer] = useState('');
  const interactive = story.source === 'firestore' && (sticker.kind === 'poll' || sticker.kind === 'slider');
  useEffect(() => interactive ? listenStoryVotes(story.id, setVotes) : undefined, [interactive, story.id]);
  const mine = votes.find(vote => vote.userId === uid);
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  if (sticker.kind === 'poll') {
    const options = sticker.options || [];
    const total = votes.filter(vote => vote.kind === 'poll').length;
    const showResults = Boolean(mine) || isOwn;
    return (
      <div onPointerDown={stop} onPointerUp={stop}>
        <StickerPreview sticker={sticker}>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {options.map((option, index) => {
              const count = votes.filter(vote => vote.kind === 'poll' && vote.value === index).length;
              const percent = total ? Math.round((count / total) * 100) : 0;
              return (
                <button key={option} type="button" disabled={isOwn || !uid} onClick={() => void voteOnStory({ id: story.id, userId: story.authorId }, uid, 'poll', index)} className={`relative overflow-hidden rounded-xl py-2 text-sm font-bold ${mine?.value === index ? 'bg-[#E7F0FD] text-[#1877F2]' : 'bg-[#F2F4F7]'}`}>
                  {showResults && <span className="absolute inset-y-0 left-0 bg-[#1877F2]/15" style={{ width: `${percent}%` }} />}
                  <span className="relative">{option}{showResults ? ` · ${percent}%` : ''}</span>
                </button>
              );
            })}
          </div>
          {isOwn && <p className="mt-1 text-[11px] text-slate-500">{total} vote{total === 1 ? '' : 's'}</p>}
        </StickerPreview>
      </div>
    );
  }
  if (sticker.kind === 'slider') {
    const sliderVotes = votes.filter(vote => vote.kind === 'slider');
    const average = sliderVotes.length ? Math.round(sliderVotes.reduce((sum, vote) => sum + vote.value, 0) / sliderVotes.length) : 0;
    return (
      <div onPointerDown={stop} onPointerUp={stop}>
        <StickerPreview sticker={sticker}>
          <div className="mt-2 flex items-center gap-2">
            <input type="range" min={0} max={100} value={mine ? mine.value : slider} disabled={isOwn || Boolean(mine) || !uid} onChange={event => setSlider(Number(event.target.value))} onPointerUp={() => uid && !isOwn && void voteOnStory({ id: story.id, userId: story.authorId }, uid, 'slider', slider)} aria-label={sticker.prompt} className="flex-1 accent-[#1877F2]" />
            <span className="text-2xl">{sticker.emoji}</span>
          </div>
          {(mine || isOwn) && <p className="mt-1 text-[11px] text-slate-500">Average {average}% · {sliderVotes.length} response{sliderVotes.length === 1 ? '' : 's'}</p>}
        </StickerPreview>
      </div>
    );
  }
  if (sticker.kind === 'question') {
    return (
      <div onPointerDown={stop} onPointerUp={stop}>
        <StickerPreview sticker={sticker}>
          {isOwn ? <p className="mt-2 text-xs text-slate-500">Answers arrive in your messages.</p> : (
            <form onSubmit={event => { event.preventDefault(); if (!answer.trim()) return; onAnswer(answer.trim()); setAnswer(''); onTyping(false); }} className="mt-2 flex gap-1.5">
              <input value={answer} onChange={event => setAnswer(event.target.value)} onFocus={() => onTyping(true)} onBlur={() => onTyping(false)} maxLength={200} placeholder="Type your answer…" className="min-w-0 flex-1 rounded-xl bg-[#F2F4F7] px-3 py-2 text-sm" />
              <button type="submit" disabled={!answer.trim()} className="rounded-xl bg-[#1877F2] px-3 text-sm font-bold text-white disabled:opacity-50">Send</button>
            </form>
          )}
        </StickerPreview>
      </div>
    );
  }
  return <StickerPreview sticker={sticker} soundName={soundName} />;
};

export const legacyEdit = (): MediaEdit => ({ ...DEFAULT_EDIT });
