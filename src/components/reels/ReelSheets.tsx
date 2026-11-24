import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, BookmarkCheck, Copy, EyeOff, Flag, Heart, Link2, Loader2, MessageCircle, Music2, Pause, Pencil, Play, Repeat2, Send, Share2, SquarePlus, Trash2, Users, X } from 'lucide-react';
import { api } from '../../services/api';
import {
  addReelComment, createStory, deleteReel, hideReel, listenMyCommentLikes, listenReelComments, REEL_REPORT_REASONS, reelSound, reportReel, saveSound, setCommentLike, storyFromReel, unsaveSound, updateReelCaption,
  type Reel, type ReelComment, type SavedSound
} from '../../services/reels/reelsStore';
import type { StudioPreset } from './CreateStudio';
import type { SoundInfo } from '../../services/reels/soundCatalog';

export interface Viewer { uid: string; name: string; avatar: string; friends: string[] }

const Sheet: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; tall?: boolean }> = ({ title, onClose, children, tall }) => (
  <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
    <div className={`flex w-full max-w-md flex-col rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] sm:rounded-2xl ${tall ? 'h-[75vh]' : 'max-h-[80vh]'}`} onClick={event => event.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><h2 className="font-extrabold text-slate-900">{title}</h2><button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full hover:bg-slate-100"><X size={18} /></button></div>
      {children}
    </div>
  </div>
);

export const reelLink = (reelId: string) => `${window.location.origin}/reels?r=${encodeURIComponent(reelId)}`;
const ago = (ts: number) => { const m = Math.max(1, Math.round((Date.now() - ts) / 60000)); return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };

// ---------------- Comments (with replies + likes) ----------------
export const CommentsSheet: React.FC<{ reel: Reel; viewer: Viewer | null; onClose: () => void }> = ({ reel, viewer, onClose }) => {
  const [comments, setComments] = useState<ReelComment[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ReelComment | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => listenReelComments(reel.id, setComments, err => setError(err.message)), [reel.id]);
  useEffect(() => listenMyCommentLikes(viewer?.uid || '', setLikedIds), [viewer?.uid]);

  const topLevel = comments.filter(comment => !comment.parentId);
  const replies = useMemo(() => {
    const map = new Map<string, ReelComment[]>();
    for (const comment of comments) if (comment.parentId) map.set(comment.parentId, [...(map.get(comment.parentId) || []), comment]);
    return map;
  }, [comments]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!viewer) { setError('Sign in to comment.'); return; }
    if (!text.trim()) return;
    setBusy(true);
    setError('');
    try {
      await addReelComment(reel.id, { id: viewer.uid, name: viewer.name, avatar: viewer.avatar }, text, replyTo ? (replyTo.parentId || replyTo.id) : '');
      setText('');
      setReplyTo(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post comment.');
    } finally {
      setBusy(false);
    }
  };

  const toggleLike = (comment: ReelComment) => {
    if (!viewer) { setError('Sign in to like comments.'); return; }
    void setCommentLike(comment.id, viewer.uid, !likedIds.has(comment.id)).catch(err => setError(err instanceof Error ? err.message : 'Could not like comment.'));
  };

  const row = (comment: ReelComment, isReply = false) => (
    <li key={comment.id} className={`flex gap-2.5 ${isReply ? 'ml-10' : ''}`}>
      <img src={comment.authorAvatar || '/logo-mark-blue.svg'} alt="" className={`${isReply ? 'h-7 w-7' : 'h-9 w-9'} shrink-0 rounded-full object-cover`} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-slate-900">{comment.authorName} <span className="font-normal text-slate-400">· {ago(comment.createdAt)}</span></p>
        <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{comment.text}</p>
        <button type="button" onClick={() => { setReplyTo(comment); inputRef.current?.focus(); }} className="mt-0.5 text-xs font-semibold text-slate-500">Reply</button>
      </div>
      <button type="button" onClick={() => toggleLike(comment)} aria-pressed={likedIds.has(comment.id)} aria-label="Like comment" className="flex shrink-0 flex-col items-center text-xs text-slate-500">
        <Heart size={16} className={likedIds.has(comment.id) ? 'fill-rose-500 text-rose-500' : ''} />{comment.likesCount > 0 && comment.likesCount}
      </button>
    </li>
  );

  return (
    <Sheet title={`${reel.commentsCount} comment${reel.commentsCount === 1 ? '' : 's'}`} onClose={onClose} tall>
      <ul className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {topLevel.length === 0 && <li className="py-10 text-center text-sm text-slate-500">No comments yet. Start the conversation!</li>}
        {topLevel.map(comment => <React.Fragment key={comment.id}>{row(comment)}{(replies.get(comment.id) || []).map(reply => row(reply, true))}</React.Fragment>)}
      </ul>
      {error && <p role="alert" className="mx-4 mb-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}
      <form onSubmit={submit} className="border-t border-slate-100 p-3">
        {replyTo && <p className="mb-1 flex items-center justify-between text-xs text-slate-500">Replying to {replyTo.authorName}<button type="button" onClick={() => setReplyTo(null)} className="font-semibold">Cancel</button></p>}
        <div className="flex gap-2">
          <input ref={inputRef} value={text} onChange={event => setText(event.target.value)} maxLength={500} placeholder={viewer ? 'Add a comment…' : 'Sign in to comment'} disabled={!viewer} className="min-h-11 min-w-0 flex-1 rounded-full bg-[#F2F4F7] px-4 text-sm focus:outline-none" />
          <button type="submit" disabled={busy || !text.trim()} aria-label="Post comment" className="grid h-11 w-11 place-items-center rounded-full bg-[#1877F2] text-white disabled:opacity-50"><Send size={17} /></button>
        </div>
      </form>
    </Sheet>
  );
};

// ---------------- Share ----------------
export const ShareSheet: React.FC<{ reel: Reel; viewer: Viewer | null; onClose: () => void; onToast: (message: string) => void }> = ({ reel, viewer, onClose, onToast }) => {
  const [busy, setBusy] = useState('');
  const link = reelLink(reel.id);
  const text = `${reel.caption ? `${reel.caption.slice(0, 120)} ` : ''}Watch on EChat: ${link}`;
  const run = async (key: string, action: () => Promise<void>, done: string) => {
    setBusy(key);
    try { await action(); onToast(done); onClose(); }
    catch (error) { onToast(error instanceof Error ? error.message : 'Could not share.'); }
    finally { setBusy(''); }
  };
  const item = (key: string, icon: React.ReactNode, label: string, onClick: () => void) => (
    <button key={key} type="button" disabled={Boolean(busy)} onClick={onClick} className="flex flex-col items-center gap-1.5 rounded-xl p-2 text-xs font-semibold text-slate-700 hover:bg-[#F2F4F7] disabled:opacity-50">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-[#F2F4F7] text-slate-800">{icon}</span>{busy === key ? '…' : label}
    </button>
  );
  return (
    <Sheet title="Share" onClose={onClose}>
      <div className="grid grid-cols-4 gap-1 p-4">
        {item('copy', <Copy size={20} />, 'Copy Link', () => void run('copy', () => navigator.clipboard.writeText(link), 'Link copied'))}
        {item('whatsapp', <MessageCircle size={20} className="text-emerald-600" />, 'WhatsApp', () => { window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener'); onClose(); })}
        {item('story', <SquarePlus size={20} className="text-[#1877F2]" />, 'Share to Story', () => {
          if (!viewer) { onToast('Sign in to share to your Story.'); return; }
          void run('story', async () => { await createStory(storyFromReel(reel, { id: viewer.uid, name: viewer.name, avatar: viewer.avatar, friends: viewer.friends })); }, 'Shared to your Story');
        })}
        {item('feed', <Share2 size={20} className="text-fuchsia-600" />, 'Share to Feed', () => {
          if (!viewer) { onToast('Sign in to share to your Feed.'); return; }
          void run('feed', async () => { await api.createPost({ content: `🎬 ${reel.creatorName}'s reel${reel.caption ? `: ${reel.caption.slice(0, 200)}` : ''}\n${link}`, privacy: 'public' }); }, 'Shared to your Feed');
        })}
        {typeof navigator.share === 'function' && item('more', <Link2 size={20} />, 'More apps', () => { void navigator.share({ title: 'EChat Reel', text: reel.caption, url: link }).then(onClose).catch(() => {}); })}
      </div>
    </Sheet>
  );
};

// ---------------- Sound ----------------
export const SoundSheet: React.FC<{ reel: Reel; viewer: Viewer | null; savedSounds: SavedSound[]; onClose: () => void; onUse: (sound: SoundInfo) => void; onToast: (message: string) => void }> = ({ reel, viewer, savedSounds, onClose, onUse, onToast }) => {
  const sound = reelSound(reel);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  if (!sound) return null;
  const saved = savedSounds.some(item => item.soundId === sound.id);
  const toggle = () => {
    if (playing) { audio.current?.pause(); setPlaying(false); return; }
    audio.current = audio.current || new Audio(sound.audioUrl);
    audio.current.onended = () => setPlaying(false);
    void audio.current.play().then(() => setPlaying(true)).catch(() => onToast('Could not play this sound.'));
  };
  const toggleSave = async () => {
    if (!viewer) { onToast('Sign in to save sounds.'); return; }
    try {
      if (saved) { await unsaveSound(viewer.uid, sound.id); onToast('Removed from Saved Sounds'); }
      else { await saveSound(viewer.uid, sound); onToast('Saved! Find it in Create Reel → Saved Sounds'); }
    } catch (error) { onToast(error instanceof Error ? error.message : 'Could not save sound.'); }
  };
  return (
    <Sheet title="Sound" onClose={onClose}>
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={toggle} aria-label={playing ? 'Pause sound' : 'Play sound'} className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#1877F2] to-fuchsia-500 text-white">{playing ? <Pause size={26} /> : <Play size={26} />}</button>
          <div className="min-w-0"><p className="flex items-center gap-1 font-extrabold text-slate-900"><Music2 size={16} />{sound.name}</p><p className="text-sm text-slate-500">{sound.artist}</p></div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void toggleSave()} className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl font-bold ${saved ? 'bg-[#E7F0FD] text-[#1877F2]' : 'bg-[#F2F4F7] text-slate-800'}`}>{saved ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}{saved ? 'Saved' : 'Save Sound'}</button>
          <button type="button" onClick={() => { audio.current?.pause(); onUse(sound); }} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#1877F2] font-bold text-white"><Music2 size={18} />Use this sound</button>
        </div>
      </div>
    </Sheet>
  );
};

// ---------------- More (⋯) ----------------
type MoreView = 'menu' | 'confirmDelete' | 'editCaption' | 'report';

export const MoreSheet: React.FC<{
  reel: Reel;
  viewer: Viewer | null;
  saved: boolean;
  onSave: (saved: boolean) => void;
  onClose: () => void;
  onStudio: (preset: StudioPreset) => void;
  onToast: (message: string) => void;
  /** Called right after a successful delete so the feed drops the reel instantly. */
  onDeleted: (reelId: string) => void;
  /** "Not interested": hide from this feed. */
  onHidden: (reelId: string) => void;
}> = ({ reel, viewer, saved, onSave, onClose, onStudio, onToast, onDeleted, onHidden }) => {
  const sound = reelSound(reel);
  const isOwner = Boolean(viewer && viewer.uid === reel.creatorId);
  const [view, setView] = useState<MoreView>('menu');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [caption, setCaption] = useState(reel.caption);

  const option = (icon: React.ReactNode, label: string, onClick: () => void, danger = false) => (
    <button type="button" onClick={onClick} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold hover:bg-[#F2F4F7] ${danger ? 'text-rose-600' : 'text-slate-800'}`}>{icon}{label}</button>
  );
  const copyLink = () => {
    void navigator.clipboard.writeText(reelLink(reel.id)).then(() => { onToast('Link copied'); onClose(); }).catch(() => onToast(reelLink(reel.id)));
  };
  const addToStory = () => {
    if (!viewer) { onToast('Sign in to add to your Story.'); return; }
    void createStory(storyFromReel(reel, { id: viewer.uid, name: viewer.name, avatar: viewer.avatar, friends: viewer.friends })).then(() => { onToast('Added to your Story'); onClose(); }).catch(err => onToast(err instanceof Error ? err.message : 'Could not add to Story.'));
  };

  const confirmDelete = async () => {
    setBusy(true);
    setError('');
    try {
      await deleteReel(reel.id);
      onDeleted(reel.id);
      onToast('Reel deleted');
      onClose();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      setError(code === 'permission-denied' ? 'Only the owner can delete this reel.' : err instanceof Error ? err.message : 'Could not delete. Try again.');
      setBusy(false);
    }
  };

  const saveCaption = async () => {
    setBusy(true);
    setError('');
    try {
      await updateReelCaption(reel.id, caption);
      onToast('Caption updated');
      onClose();
    } catch (err) {
      setError((err as { code?: string })?.code === 'permission-denied' ? 'Could not save (deploy the latest Firestore rules).' : err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  };

  const sendReport = async (reason: string) => {
    if (!viewer) { onToast('Sign in to report.'); return; }
    setBusy(true);
    try {
      await reportReel(reel, viewer.uid, reason);
      onToast('Thanks — we will review this reel');
    } catch (err) {
      // A second report from the same person is refused by the rules; treat it as already reported.
      onToast((err as { code?: string })?.code === 'permission-denied' ? 'You already reported this reel' : 'Could not send the report.');
    }
    onClose();
  };

  if (view === 'confirmDelete') {
    return (
      <div className="fixed inset-0 z-[95] grid place-items-center bg-black/60 p-4" role="alertdialog" aria-modal="true" aria-labelledby="delete-reel-title" aria-describedby="delete-reel-text">
        <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-center shadow-2xl">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-rose-100 text-rose-600"><Trash2 size={22} /></span>
          <h2 id="delete-reel-title" className="text-lg font-extrabold text-slate-900">Delete reel?</h2>
          <p id="delete-reel-text" className="mt-1 text-sm text-slate-600">Are you sure you want to delete this reel? This cannot be undone</p>
          {error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => { setView('menu'); setError(''); }} className="min-h-11 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700">Cancel</button>
            <button type="button" disabled={busy} onClick={() => void confirmDelete()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 text-sm font-bold text-white disabled:opacity-70">{busy && <Loader2 size={16} className="animate-spin" />}Delete</button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'editCaption') {
    return (
      <Sheet title="Edit caption" onClose={onClose}>
        <div className="space-y-3 p-4">
          <textarea value={caption} onChange={event => setCaption(event.target.value)} maxLength={2200} rows={5} autoFocus placeholder="Write a caption… #hashtags"
            className="w-full resize-none rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-[#1877F2]" />
          <p className="text-right text-xs text-slate-500">{caption.length}/2200</p>
          {error && <p role="alert" className="rounded-xl bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setView('menu')} className="min-h-11 rounded-xl border border-slate-300 text-sm font-bold text-slate-700">Cancel</button>
            <button type="button" disabled={busy} onClick={() => void saveCaption()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#1877F2] text-sm font-bold text-white disabled:opacity-60">{busy && <Loader2 size={16} className="animate-spin" />}Save</button>
          </div>
        </div>
      </Sheet>
    );
  }

  if (view === 'report') {
    return (
      <Sheet title="Report reel" onClose={onClose}>
        <div className="space-y-1 p-3">
          <p className="px-3 pb-1 text-sm text-slate-600">Why are you reporting this reel?</p>
          {REEL_REPORT_REASONS.map(reason => (
            <button key={reason} type="button" disabled={busy} onClick={() => void sendReport(reason)} className="flex min-h-12 w-full items-center rounded-xl px-3 text-left text-sm font-semibold text-slate-800 hover:bg-[#F2F4F7] disabled:opacity-60">{reason}</button>
          ))}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={isOwner ? 'Your reel' : 'More'} onClose={onClose}>
      <div className="space-y-1 p-3">
        {isOwner ? (
          <>
            {option(<Pencil size={18} />, 'Edit Caption', () => setView('editCaption'))}
            {option(<Trash2 size={18} />, 'Delete Reel', () => setView('confirmDelete'), true)}
            <div className="my-1 border-t border-slate-100" />
            {option(<Link2 size={18} />, 'Copy Link', copyLink)}
            {option(<SquarePlus size={18} />, 'Add to Story', addToStory)}
          </>
        ) : (
          <>
            {option(saved ? <BookmarkCheck size={18} /> : <Bookmark size={18} />, saved ? 'Remove from Saved' : 'Save', () => { onSave(!saved); onClose(); })}
            {option(<Flag size={18} />, 'Report', () => { if (!viewer) { onToast('Sign in to report.'); return; } setView('report'); }, true)}
            {option(<EyeOff size={18} />, 'Not Interested', () => { hideReel(reel.id); onHidden(reel.id); onToast("Got it — you'll see fewer reels like this"); onClose(); })}
            {option(<Link2 size={18} />, 'Copy Link', copyLink)}
            <div className="my-1 border-t border-slate-100" />
            {option(<Users size={18} />, 'Duet (side-by-side)', () => { if (!viewer) { onToast('Sign in to duet.'); return; } onStudio({ duetOf: { reelId: reel.id, mediaUrl: reel.mediaUrl, mediaType: reel.mediaType, creatorName: reel.creatorName, trimStart: reel.trimStart, trimEnd: reel.trimEnd }, sound: null }); })}
            {option(<Repeat2 size={18} />, 'Remix / Use template', () => { if (!viewer) { onToast('Sign in to remix.'); return; } onStudio({ sound, caption: reel.caption, remixOf: reel.id }); })}
            {option(<SquarePlus size={18} />, 'Add to Story', addToStory)}
          </>
        )}
      </div>
    </Sheet>
  );
};
