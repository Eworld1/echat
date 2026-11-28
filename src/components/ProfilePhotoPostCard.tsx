import React, { useEffect, useRef, useState } from 'react';
import { Globe2, MessageCircle, MoreHorizontal, Send, Share2, ThumbsUp, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { UserAvatar, avatarSrc } from './UserAvatar';
import { openAvatarViewer } from './AvatarViewer';
import { timeAgo } from '../services/market';
import { useLiveProfiles, withLive } from '../services/liveProfiles';
import { VerifiedBadge } from './VerifiedBadge';
import {
  addProfilePhotoComment, deleteProfilePhotoComment, deleteProfilePhotoPost, listenProfilePhotoComments, profilePhotoPostLink,
  setProfilePhotoLike, type ProfilePhotoComment, type ProfilePhotoPost
} from '../services/profilePhotoPosts';

interface Props {
  post: ProfilePhotoPost;
  onViewProfile: (userId: string) => void;
}

/** Facebook-style "[Name] updated their profile picture." post. */
export const ProfilePhotoPostCard: React.FC<Props> = ({ post, onViewProfile }) => {
  const { user } = useAuth();
  const isOwner = user?.id === post.userId;
  const liked = Boolean(user && post.likes.includes(user.id));
  const [likePop, setLikePop] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<ProfilePhotoComment[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => (commentsOpen ? listenProfilePhotoComments(post.id, setComments) : undefined), [commentsOpen, post.id]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3000); return () => clearTimeout(timer); }, [notice]);

  // Live name / current photo / badge of the author and commenters (not the copies saved in the post).
  const live = useLiveProfiles([post.userId, ...comments.map(comment => comment.userId)]);
  const author = withLive({ name: post.userName, avatar: post.newPhotoURL, isVerified: false, isOfficialDeveloper: false }, live[post.userId]);
  const name = author.name;
  const view = () => openAvatarViewer({ userId: post.userId, name, avatar: post.newPhotoURL, postId: post.id });
  const toggleLike = async () => {
    if (!user) return;
    if (!liked) { setLikePop(true); setTimeout(() => setLikePop(false), 400); }
    try { await setProfilePhotoLike(post.id, user.id, !liked); } catch { setNotice('Could not update your like.'); }
  };
  const openComments = () => { setCommentsOpen(true); setTimeout(() => inputRef.current?.focus(), 50); };
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !draft.trim()) return;
    setBusy(true);
    try { await addProfilePhotoComment(post.id, user, draft); setDraft(''); } catch { setNotice('Could not post your comment.'); } finally { setBusy(false); }
  };
  const share = async () => {
    const url = profilePhotoPostLink(post.id);
    const text = `${name} updated their profile picture on EChat`;
    try {
      if (navigator.share) { await navigator.share({ title: 'EChat', text, url }); return; }
      await navigator.clipboard.writeText(url);
      setNotice('Link copied');
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') setNotice('Could not share this post.');
    }
  };
  const remove = async () => {
    setMenuOpen(false);
    if (!window.confirm('Delete this post? Your profile picture stays the same.')) return;
    try { await deleteProfilePhotoPost(post.id); } catch { setNotice('Could not delete this post.'); }
  };

  return (
    <article id={`post-${post.id}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-start gap-3 px-4 pb-2 pt-3">
        <UserAvatar src={author.avatar || post.newPhotoURL} name={name} size={40} onClick={() => onViewProfile(post.userId)} className="ring-1 ring-slate-200" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-5 text-slate-900">
            <button type="button" onClick={() => onViewProfile(post.userId)} className="font-bold hover:underline">{name}</button>{(author.isVerified || author.isOfficialDeveloper) && <span className="ml-1 inline-flex align-[-2px]"><VerifiedBadge size={14} /></span>}
            <span className="text-slate-600"> updated their profile picture.</span>
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">{timeAgo(post.createdAt)} · <Globe2 size={12} aria-label="Public" /></p>
        </div>
        {isOwner && (
          <div className="relative">
            <button type="button" onClick={() => setMenuOpen(value => !value)} aria-label="Post options" aria-expanded={menuOpen} className="grid h-9 w-9 place-items-center rounded-full text-slate-600 hover:bg-slate-100"><MoreHorizontal size={20} /></button>
            {menuOpen && (
              <div className="absolute right-0 top-10 z-20 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                <button type="button" onClick={() => void remove()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50"><Trash2 size={16} />Delete post</button>
              </div>
            )}
          </div>
        )}
      </header>

      {/* Big round picture on a soft backdrop, like Facebook */}
      <button type="button" onClick={view} aria-label={`View ${name}'s profile picture`} className="relative block w-full overflow-hidden bg-gradient-to-b from-slate-200 to-slate-100">
        <img src={avatarSrc(post.newPhotoURL, name)} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl" />
        <span className="relative flex justify-center py-8">
          <img
            src={avatarSrc(post.newPhotoURL, name)}
            alt={`${name}'s new profile picture`}
            data-avatar=""
            data-name={name}
            loading="lazy"
            className="aspect-square w-[min(72%,320px)] rounded-full border-4 border-white bg-slate-200 object-cover shadow-xl"
          />
        </span>
      </button>

      {(post.likes.length > 0 || post.comments > 0) && (
        <div className="flex items-center justify-between px-4 pt-2 text-sm text-slate-500">
          <span className="flex items-center gap-1.5">{post.likes.length > 0 && <><span className="grid h-5 w-5 place-items-center rounded-full bg-[#1877F2] text-white"><ThumbsUp size={11} fill="white" /></span>{post.likes.length}</>}</span>
          {post.comments > 0 && <button type="button" onClick={() => setCommentsOpen(value => !value)} className="hover:underline">{post.comments} comment{post.comments === 1 ? '' : 's'}</button>}
        </div>
      )}

      <div className="mx-3 mt-2 grid grid-cols-3 border-t border-slate-200 py-1">
        <button type="button" onClick={() => void toggleLike()} aria-pressed={liked} className={`flex min-h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold hover:bg-slate-100 ${liked ? 'text-[#1877F2]' : 'text-slate-600'}`}>
          <ThumbsUp size={18} fill={liked ? 'currentColor' : 'none'} className={likePop ? 'scale-125 transition-transform' : 'transition-transform'} />Like
        </button>
        <button type="button" onClick={openComments} className="flex min-h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100"><MessageCircle size={18} />Comment</button>
        <button type="button" onClick={() => void share()} className="flex min-h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100"><Share2 size={18} />Share</button>
      </div>

      {commentsOpen && (
        <div className="space-y-3 border-t border-slate-200 px-4 py-3">
          {comments.map(saved => { const comment = { ...saved, ...(live[saved.userId]?.name ? { userName: live[saved.userId].name! } : {}), ...(live[saved.userId]?.avatar ? { userAvatar: live[saved.userId].avatar! } : {}) }; return (
            <div key={comment.id} className="flex gap-2">
              <UserAvatar src={comment.userAvatar} name={comment.userName} size={32} onClick={() => onViewProfile(comment.userId)} />
              <div className="min-w-0 flex-1">
                <div className="inline-block max-w-full rounded-2xl bg-slate-100 px-3 py-2">
                  <button type="button" onClick={() => onViewProfile(comment.userId)} className="text-xs font-bold text-slate-900 hover:underline">{comment.userName}</button>
                  <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{comment.text}</p>
                </div>
                <div className="ml-2 mt-0.5 flex gap-3 text-[11px] font-semibold text-slate-500">
                  <span>{timeAgo(comment.createdAt)}</span>
                  {(comment.userId === user?.id || isOwner) && <button type="button" onClick={() => void deleteProfilePhotoComment(post.id, comment.id).catch(() => setNotice('Could not delete that comment.'))} className="hover:text-rose-600">Delete</button>}
                </div>
              </div>
            </div>
          ); })}
          <form onSubmit={event => void send(event)} className="flex items-center gap-2">
            <UserAvatar src={user?.avatar} name={user?.name || 'You'} size={32} />
            <input ref={inputRef} value={draft} onChange={event => setDraft(event.target.value)} maxLength={1000} placeholder="Write a comment…" aria-label="Write a comment" className="h-10 min-w-0 flex-1 rounded-full bg-slate-100 px-4 text-[15px] outline-none focus:ring-2 focus:ring-blue-200" />
            <button type="submit" disabled={busy || !draft.trim()} className="flex h-10 items-center gap-1 rounded-full bg-[#1877F2] px-4 text-sm font-bold text-white disabled:opacity-50"><Send size={15} />Post</button>
          </form>
        </div>
      )}
      {notice && <p role="status" className="px-4 pb-3 text-xs font-semibold text-slate-600">{notice}</p>}
    </article>
  );
};
