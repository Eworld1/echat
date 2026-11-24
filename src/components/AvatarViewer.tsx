import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, MessageSquare, Send, ThumbsUp, Trash2, User as UserIcon, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useBackButton } from '../hooks/useBackButton';
import { avatarSrc, UserAvatar } from './UserAvatar';
import { isUsableAvatarUrl } from '../utils/avatar';
import {
  addProfilePhotoComment, deleteProfilePhotoComment, findProfilePhotoPostId, listenProfilePhotoComments, listenProfilePhotoPost,
  setProfilePhotoLike, type ProfilePhotoComment, type ProfilePhotoPost
} from '../services/profilePhotoPosts';

export interface AvatarViewerTarget {
  userId: string;
  name: string;
  avatar?: string | null;
  /** When opened from a profile-picture post, Like / Comment act on that post. */
  postId?: string;
  /** Open with the comments panel showing. */
  showComments?: boolean;
}

const OPEN_EVENT = 'echat:view-avatar';

/** Open the full-screen profile picture viewer from anywhere (feed, profile, comments, DMs…). */
export function openAvatarViewer(target: AvatarViewerTarget): void {
  window.dispatchEvent(new CustomEvent<AvatarViewerTarget>(OPEN_EVENT, { detail: target }));
}

/** Click handler for an avatar: opens the viewer and stops the click from also opening the row/link around it. */
export function avatarClick(target: AvatarViewerTarget) {
  return (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    openAvatarViewer(target);
  };
}

const formatDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const MAX_SCALE = 4;

/** Mounted once (in App). Listens for openAvatarViewer() calls. */
export const AvatarViewerHost: React.FC<{ onViewProfile: (userId: string) => void; onSendMessage: (target: AvatarViewerTarget) => void }> = ({ onViewProfile, onSendMessage }) => {
  const [target, setTarget] = useState<AvatarViewerTarget | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<AvatarViewerTarget>).detail;
      if (detail?.userId || detail?.avatar) setTarget(detail);
    };
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);
  if (!target) return null;
  return (
    <AvatarViewer
      key={`${target.userId}:${target.avatar}:${target.postId || ''}`}
      target={target}
      onClose={() => setTarget(null)}
      onViewProfile={() => { setTarget(null); onViewProfile(target.userId); }}
      onSendMessage={() => { setTarget(null); onSendMessage(target); }}
    />
  );
};

const AvatarViewer: React.FC<{ target: AvatarViewerTarget; onClose: () => void; onViewProfile: () => void; onSendMessage: () => void }> = ({ target, onClose, onViewProfile, onSendMessage }) => {
  const { user } = useAuth();
  const isMe = Boolean(user && user.id === target.userId);
  const hasPhoto = isUsableAvatarUrl(target.avatar);
  const src = avatarSrc(target.avatar, target.name);

  // ---- Like / comment: the profile-picture post for this picture, when there is one ----
  const [postId, setPostId] = useState<string | null>(target.postId || null);
  const [post, setPost] = useState<ProfilePhotoPost | null>(null);
  const [lookupDone, setLookupDone] = useState(Boolean(target.postId));
  const [commentsOpen, setCommentsOpen] = useState(Boolean(target.showComments));
  const [comments, setComments] = useState<ProfilePhotoComment[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (target.postId || !hasPhoto) { setLookupDone(true); return; }
    let active = true;
    void findProfilePhotoPostId(target.userId, String(target.avatar)).then(id => { if (active) { setPostId(id); setLookupDone(true); } }).catch(() => { if (active) setLookupDone(true); });
    return () => { active = false; };
  }, [target.postId, target.userId, target.avatar, hasPhoto]);
  useEffect(() => (postId ? listenProfilePhotoPost(postId, setPost) : undefined), [postId]);
  useEffect(() => (postId && commentsOpen ? listenProfilePhotoComments(postId, setComments) : undefined), [postId, commentsOpen]);

  const liked = Boolean(user && post?.likes.includes(user.id));
  const toggleLike = async () => {
    if (!user || !post) return;
    setError('');
    try { await setProfilePhotoLike(post.id, user.id, !liked); } catch { setError('Could not update your like. Check your connection.'); }
  };
  const sendComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !post || !draft.trim()) return;
    setBusy(true); setError('');
    try { await addProfilePhotoComment(post.id, user, draft); setDraft(''); } catch { setError('Could not post your comment. Try again.'); } finally { setBusy(false); }
  };

  // ---- Zoom / pan / swipe-down ----
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragY, setDragY] = useState(0);
  const [animating, setAnimating] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startDistance: number; startScale: number; startX: number; startY: number; startOffset: { x: number; y: number }; mode: 'pinch' | 'pan' | 'swipe' | null }>({ startDistance: 0, startScale: 1, startX: 0, startY: 0, startOffset: { x: 0, y: 0 }, mode: null });
  const lastTap = useRef(0);

  const resetZoom = useCallback(() => { setAnimating(true); setScale(1); setOffset({ x: 0, y: 0 }); }, []);
  const zoomTo = (next: number) => { setAnimating(true); const clamped = Math.min(MAX_SCALE, Math.max(1, next)); setScale(clamped); if (clamped === 1) setOffset({ x: 0, y: 0 }); };

  const onPointerDown = (event: React.PointerEvent) => {
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setAnimating(false);
    const points = [...pointers.current.values()];
    if (points.length === 2) {
      gesture.current = { ...gesture.current, mode: 'pinch', startDistance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) || 1, startScale: scale };
    } else if (points.length === 1) {
      gesture.current = { ...gesture.current, mode: scale > 1 ? 'pan' : 'swipe', startX: event.clientX, startY: event.clientY, startOffset: offset };
    }
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = gesture.current;
    const points = [...pointers.current.values()];
    if (g.mode === 'pinch' && points.length >= 2) {
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      setScale(Math.min(MAX_SCALE, Math.max(1, g.startScale * (distance / g.startDistance))));
    } else if (g.mode === 'pan') {
      setOffset({ x: g.startOffset.x + event.clientX - g.startX, y: g.startOffset.y + event.clientY - g.startY });
    } else if (g.mode === 'swipe') {
      setDragY(Math.max(0, event.clientY - g.startY));
    }
  };
  const onPointerUp = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    const g = gesture.current;
    if (g.mode === 'swipe') {
      const moved = Math.abs(event.clientY - g.startY) + Math.abs(event.clientX - g.startX);
      if (dragY > 110) { onClose(); return; }
      setAnimating(true); setDragY(0);
      if (moved < 8) {
        // Double tap toggles zoom.
        const now = Date.now();
        if (now - lastTap.current < 300) { zoomTo(scale > 1 ? 1 : 2.5); lastTap.current = 0; } else lastTap.current = now;
      }
    }
    if (g.mode === 'pinch' && scale <= 1.02) resetZoom();
    if (pointers.current.size === 0) gesture.current.mode = null;
    else if (pointers.current.size === 1) {
      const [point] = [...pointers.current.values()];
      gesture.current = { ...gesture.current, mode: scale > 1 ? 'pan' : null, startX: point.x, startY: point.y, startOffset: offset };
    }
  };
  const onWheel = (event: React.WheelEvent) => { zoomTo(scale * (event.deltaY < 0 ? 1.2 : 1 / 1.2)); };

  // ---- Close with Esc / phone back button; no page scroll behind ----
  useBackButton(true, onClose, 'avatar-viewer');
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = previous; };
  }, []);

  const fade = Math.max(0.35, 1 - dragY / 400);
  const dateLabel = post ? formatDate(post.createdAt) : '';

  return (
    <div role="dialog" aria-modal="true" aria-label={`${target.name}'s profile picture`} className="fixed inset-0 z-[9000] flex flex-col text-white" style={{ backgroundColor: `rgba(0,0,0,${fade})` }}>
      {/* Top bar */}
      <div className="relative z-10 flex items-center gap-3 px-3 pb-2 pt-[calc(10px+env(safe-area-inset-top))]" style={{ opacity: fade }}>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20"><X size={24} /></button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold">{target.name}</p>
          <p className="truncate text-xs text-white/70">{dateLabel ? `Profile picture · ${dateLabel}` : 'Profile picture'}</p>
        </div>
      </div>

      {/* Picture */}
      <div
        className="relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel}
        onDoubleClick={() => zoomTo(scale > 1 ? 1 : 2.5)}
      >
        <img
          src={src}
          alt={`${target.name}'s profile picture`}
          draggable={false}
          className="max-h-full w-full object-contain"
          style={{
            maxWidth: 'min(100vw, 900px)',
            transform: `translate(${offset.x}px, ${offset.y + dragY}px) scale(${scale})`,
            transition: animating ? 'transform 180ms ease-out' : 'none',
            cursor: scale > 1 ? 'grab' : 'zoom-in'
          }}
        />
        {!hasPhoto && <p className="absolute bottom-6 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">No profile picture yet</p>}
      </div>

      {/* Bottom actions */}
      <div className="relative z-10 space-y-2 px-3 pb-[calc(12px+env(safe-area-inset-bottom))] pt-2" style={{ opacity: fade }}>
        {post && (post.likes.length > 0 || post.comments > 0) && (
          <div className="flex items-center justify-between px-1 text-sm text-white/80">
            <span>{post.likes.length > 0 && <><span className="mr-1 inline-grid h-5 w-5 place-items-center rounded-full bg-[#1877F2] align-middle"><ThumbsUp size={11} fill="white" /></span>{post.likes.length}</>}</span>
            {post.comments > 0 && <button type="button" onClick={() => setCommentsOpen(true)} className="hover:underline">{post.comments} comment{post.comments === 1 ? '' : 's'}</button>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 border-y border-white/15 py-1">
          <button type="button" onClick={() => void toggleLike()} disabled={!post} title={post ? undefined : lookupDone ? 'Likes and comments open on the next profile picture update' : 'Loading…'}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-bold hover:bg-white/10 disabled:opacity-40 ${liked ? 'text-[#4599FF]' : ''}`}>
            <ThumbsUp size={19} fill={liked ? 'currentColor' : 'none'} />Like
          </button>
          <button type="button" onClick={() => setCommentsOpen(value => !value)} disabled={!post} title={post ? undefined : 'Likes and comments open on the next profile picture update'}
            className="flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-bold hover:bg-white/10 disabled:opacity-40">
            <MessageCircle size={19} />Comment
          </button>
        </div>
        <div className={`grid gap-2 ${isMe ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <button type="button" onClick={onViewProfile} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white/15 text-sm font-bold hover:bg-white/25"><UserIcon size={18} />View Profile</button>
          {!isMe && <button type="button" onClick={onSendMessage} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#1877F2] text-sm font-bold hover:bg-[#166FE5]"><MessageSquare size={18} />Send Message</button>}
        </div>
        {error && <p role="alert" className="text-center text-xs text-rose-300">{error}</p>}
      </div>

      {/* Comments sheet */}
      {commentsOpen && post && (
        <div className="absolute inset-x-0 bottom-0 z-20 mx-auto flex max-h-[70vh] w-full max-w-xl flex-col rounded-t-2xl bg-white text-slate-900 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <p className="font-extrabold">Comments</p>
            <button type="button" onClick={() => setCommentsOpen(false)} aria-label="Close comments" className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 hover:bg-slate-200"><X size={18} /></button>
          </div>
          <div className="min-h-[120px] flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {comments.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No comments yet. Be the first.</p>}
            {comments.map(comment => (
              <div key={comment.id} className="flex gap-2">
                <UserAvatar src={comment.userAvatar} name={comment.userName} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="inline-block max-w-full rounded-2xl bg-slate-100 px-3 py-2">
                    <p className="text-xs font-bold">{comment.userName}</p>
                    <p className="whitespace-pre-wrap break-words text-sm">{comment.text}</p>
                  </div>
                  {(comment.userId === user?.id || isMe) && (
                    <button type="button" onClick={() => void deleteProfilePhotoComment(post.id, comment.id).catch(() => setError('Could not delete that comment.'))} className="ml-2 mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-rose-600"><Trash2 size={11} />Delete</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={event => void sendComment(event)} className="flex gap-2 border-t border-slate-200 p-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
            <input value={draft} onChange={event => setDraft(event.target.value)} maxLength={1000} placeholder="Write a comment…" aria-label="Write a comment" className="h-11 min-w-0 flex-1 rounded-full bg-slate-100 px-4 text-base outline-none focus:ring-2 focus:ring-blue-300" />
            <button type="submit" disabled={busy || !draft.trim()} aria-label="Post comment" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#1877F2] text-white disabled:opacity-50"><Send size={17} /></button>
          </form>
        </div>
      )}
    </div>
  );
};
