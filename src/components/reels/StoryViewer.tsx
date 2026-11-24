import React, { useEffect, useRef, useState } from 'react';
import { Eye, Send, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { auth } from '../../services/firebase';
import { MediaPlayer } from './MediaPlayer';
import { isLowDataMode } from '../../services/lowData';
import { StickerPreview } from './CreateStudio';
import { DEFAULT_EDIT, IMAGE_SECONDS, MAX_STORY_SECONDS, deleteStory, listenStoryVotes, recordStoryView, voteOnStory, type MediaEdit, type StorySticker } from '../../services/reels/reelsStore';
import type { User } from '../../types';

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
}

export interface StoryGroup { authorId: string; authorName: string; authorAvatar: string; stories: ViewerStory[] }

interface StoryViewerProps {
  groups: StoryGroup[];
  startGroup: number;
  onClose: () => void;
  onSeen: (story: ViewerStory) => void;
  onReply: (story: ViewerStory, text: string) => Promise<void>;
  onLegacyView?: (story: ViewerStory) => void;
}

const REACTIONS = ['❤️', '🔥', '😂', '😮', '😢'];

export const StoryViewer: React.FC<StoryViewerProps> = ({ groups, startGroup, onClose, onSeen, onReply, onLegacyView }) => {
  const { user } = useAuth();
  const uid = auth.currentUser?.uid || user?.id || '';
  const [groupIndex, setGroupIndex] = useState(startGroup);
  const [storyIndex, setStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [held, setHeld] = useState(false);
  const [typing, setTyping] = useState(false);
  const [muted, setMuted] = useState(false);
  const [reply, setReply] = useState('');
  const [toast, setToast] = useState('');
  const [burst, setBurst] = useState('');
  const pressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number; at: number } | null>(null);
  const holdActive = useRef(false);

  const group = groups[groupIndex];
  const story = group?.stories[storyIndex];
  const isOwn = Boolean(story && story.authorId === uid);
  const paused = held || typing;

  useEffect(() => { if (!group) onClose(); }, [group, onClose]);
  useEffect(() => {
    if (!story) return;
    setProgress(0);
    onSeen(story);
    if (story.source === 'firestore' && !isOwn) recordStoryView(story.id);
    if (story.source === 'legacy') onLegacyView?.(story);
  }, [story?.key]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 2200); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typing) return;
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') next();
      if (event.key === 'ArrowLeft') previous();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Text stories (legacy) have no media: drive them with a simple timer.
  useEffect(() => {
    if (!story || story.kind !== 'text' || paused) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      setProgress(value => {
        const nextValue = value + (now - last) / (IMAGE_SECONDS * 1000);
        if (nextValue >= 1) { window.setTimeout(next, 0); return 1; }
        return nextValue;
      });
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [story?.key, paused]);

  function next() {
    if (!group) return;
    if (storyIndex < group.stories.length - 1) setStoryIndex(storyIndex + 1);
    else if (groupIndex < groups.length - 1) { setGroupIndex(groupIndex + 1); setStoryIndex(0); }
    else onClose();
  }
  function previous() {
    if (storyIndex > 0) setStoryIndex(storyIndex - 1);
    else if (groupIndex > 0) { const prevGroup = groups[groupIndex - 1]; setGroupIndex(groupIndex - 1); setStoryIndex(Math.max(0, prevGroup.stories.length - 1)); }
  }

  // Tap = next / previous, hold = pause, swipe down = close.
  const onPointerDown = (event: React.PointerEvent) => {
    pressStart.current = { x: event.clientX, y: event.clientY, at: Date.now() };
    holdActive.current = false;
    pressTimer.current = window.setTimeout(() => { holdActive.current = true; setHeld(true); }, 220);
  };
  const onPointerUp = (event: React.PointerEvent) => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    const start = pressStart.current;
    pressStart.current = null;
    setHeld(false);
    if (!start) return;
    const dy = event.clientY - start.y;
    const dx = event.clientX - start.x;
    if (dy > 90 && Math.abs(dy) > Math.abs(dx)) { onClose(); return; }
    if (holdActive.current) return;
    if (Math.abs(dx) > 60) { if (dx < 0) next(); else previous(); return; }
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (event.clientX - box.left < box.width / 3) previous(); else next();
  };

  const send = async (text: string, message: string) => {
    if (!story) return;
    try { await onReply(story, text); setToast(message); }
    catch (error) { setToast(error instanceof Error ? error.message : 'Could not send.'); }
  };

  const react = (emoji: string) => {
    setBurst(emoji);
    window.setTimeout(() => setBurst(''), 900);
    void send(`Reacted ${emoji} to your story`, `Sent ${emoji}`);
  };

  if (!group || !story) return null;
  const maxSeconds = MAX_STORY_SECONDS;

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black" role="dialog" aria-modal="true" aria-label={`${group.authorName}'s story`}>
      <div className="relative h-full w-full max-w-[480px] select-none overflow-hidden bg-black sm:h-[92vh] sm:rounded-2xl">
        {/* progress */}
        <div className="absolute inset-x-2 top-[max(0.5rem,env(safe-area-inset-top))] z-30 flex gap-1">
          {group.stories.map((item, index) => (
            <div key={item.key} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/35"><div className="h-full bg-white" style={{ width: `${index < storyIndex ? 100 : index === storyIndex ? progress * 100 : 0}%` }} /></div>
          ))}
        </div>
        {/* header */}
        <div className="absolute inset-x-3 top-[calc(max(0.5rem,env(safe-area-inset-top))+12px)] z-30 flex items-center gap-2 text-white">
          <img src={group.authorAvatar || '/logo-mark-blue.svg'} alt="" className="h-9 w-9 rounded-full border border-white/60 object-cover" />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{group.authorName}</p><p className="text-[11px] text-white/80">{Math.max(1, Math.round((Date.now() - story.createdAt) / 3600000))}h</p></div>
          {story.kind !== 'text' && <button type="button" onClick={() => setMuted(value => !value)} aria-label={muted ? 'Unmute story' : 'Mute story'} className="grid h-9 w-9 place-items-center rounded-full bg-black/30">{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>}
          {isOwn && story.source === 'firestore' && <button type="button" onClick={() => { if (window.confirm('Delete this story?')) void deleteStory(story.id).then(() => { setToast('Story deleted'); next(); }); }} aria-label="Delete story" className="grid h-9 w-9 place-items-center rounded-full bg-black/30"><Trash2 size={17} /></button>}
          <button type="button" onClick={onClose} aria-label="Close stories" className="grid h-9 w-9 place-items-center rounded-full bg-black/30"><X size={20} /></button>
        </div>

        {/* media + gestures */}
        <div className="absolute inset-0 touch-none" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { setHeld(false); pressStart.current = null; }}>
          {story.kind === 'text' ? (
            <div className="flex h-full w-full items-center justify-center p-8 text-center text-2xl font-extrabold text-white" style={{ background: story.background || 'linear-gradient(135deg,#1877F2,#7c3aed)' }}>{story.text}</div>
          ) : (
            <MediaPlayer
              key={story.key}
              mediaType={story.kind === 'video' ? 'video' : 'image'}
              mediaUrl={story.mediaUrl}
              coverUrl={story.coverUrl}
              edit={story.edit}
              active
              muted={muted}
              paused={paused}
              loop={false}
              maxSeconds={maxSeconds}
              onProgress={setProgress}
              onEnded={next}
              lowData={isLowDataMode()}
            />
          )}
        </div>

        {/* stickers (interactive) */}
        {story.stickers.map((sticker, index) => (
          <div key={index} className="absolute z-20 w-[72%] -translate-x-1/2 -translate-y-1/2" style={{ left: `${sticker.x}%`, top: `${sticker.y}%` }}>
            <InteractiveSticker sticker={sticker} story={story} uid={uid} isOwn={isOwn} soundName={story.edit.soundName} onAnswer={text => void send(`Answered "${sticker.prompt}": ${text}`, 'Answer sent')} onTyping={setTyping} />
          </div>
        ))}

        {burst && <span className="pointer-events-none absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2 animate-ping text-7xl">{burst}</span>}
        {toast && <p role="status" className="absolute left-1/2 top-20 z-40 -translate-x-1/2 rounded-full bg-black/75 px-4 py-2 text-sm font-semibold text-white">{toast}</p>}

        {/* footer */}
        <div className="absolute inset-x-0 bottom-0 z-30 space-y-2 bg-gradient-to-t from-black/70 to-transparent p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {isOwn ? (
            <p className="flex items-center gap-1.5 text-sm font-semibold text-white"><Eye size={16} />{story.views} {story.views === 1 ? 'view' : 'views'}</p>
          ) : (
            <>
              <div className="flex justify-center gap-3">{REACTIONS.map(emoji => <button key={emoji} type="button" onClick={() => react(emoji)} aria-label={`React ${emoji}`} className="text-3xl transition active:scale-125">{emoji}</button>)}</div>
              <form onSubmit={event => { event.preventDefault(); const text = reply.trim(); if (!text) return; setReply(''); (document.activeElement as HTMLElement | null)?.blur(); void send(`Replying to your story: "${text}"`, 'Reply sent'); }} className="flex gap-2">
                <input value={reply} onChange={event => setReply(event.target.value)} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} maxLength={500} placeholder={`Reply to ${group.authorName}…`} className="min-h-11 min-w-0 flex-1 rounded-full border border-white/50 bg-black/30 px-4 text-sm text-white placeholder:text-white/70 focus:outline-none" />
                <button type="submit" disabled={!reply.trim()} aria-label="Send reply" className="grid h-11 w-11 place-items-center rounded-full bg-[#1877F2] text-white disabled:opacity-50"><Send size={18} /></button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

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
