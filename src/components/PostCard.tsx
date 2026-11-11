import { usePreferences } from '../context/PreferencesContext';
import { SharePostModal, postPermalink } from './SharePostModal';
import { initialsAvatar } from '../utils/avatar';
import React, { useEffect, useRef, useState } from 'react';
import { Post, ReactionType, User } from '../types';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { assetUrl } from '../services/apiBase';
import { VerifiedBadge } from './VerifiedBadge';
import { VideoLinkCard } from './VideoLinkCard';
import { LinkPreviewCard } from './LinkPreviewCard';
import confetti from 'canvas-confetti';
import {
  ThumbsUp,
  MessageCircle,
  Share2,
  MoreHorizontal,
  Trash2,
  Pencil,
  Bookmark,
  Lock,
  Flag,
  Globe,
  Users,
  Send,
  Download,
  Volume2,
  VolumeX
} from 'lucide-react';

interface PostCardProps {
  post: Post;
  onPostUpdated: (post: Post) => void;
  onPostDeleted: (postId: string) => void;
  onViewProfile: (userId: string) => void;
  reelMode?: boolean;
  detailMode?: boolean;
}

const REACTIONS: { type: ReactionType; label: string; emoji: string; color: string }[] = [
  { type: 'like', label: 'Like', emoji: '👍', color: 'text-blue-600' },
  { type: 'love', label: 'Love', emoji: '❤️', color: 'text-rose-500' },
  { type: 'haha', label: 'Haha', emoji: '😂', color: 'text-amber-500' },
  { type: 'wow', label: 'Wow', emoji: '😮', color: 'text-amber-500' },
  { type: 'sad', label: 'Sad', emoji: '😢', color: 'text-amber-600' },
  { type: 'angry', label: 'Angry', emoji: '😡', color: 'text-orange-600' }
];

export const PostCard: React.FC<PostCardProps> = ({
  post,
  onPostUpdated,
  onPostDeleted,
  onViewProfile,
  reelMode = false,
  detailMode = false
}) => {
  const { user, isDeveloper, updateUser } = useAuth();
  const { t } = usePreferences();
  const [showReactionsBar, setShowReactionsBar] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('Inappropriate or offensive content');
  const [copiedLink, setCopiedLink] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editText, setEditText] = useState(post.content || '');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showViewersModal, setShowViewersModal] = useState(false);
  const [postViewers, setPostViewers] = useState<{ id: string; name: string; avatar: string; viewedAt: number }[]>([]);
  const [loadingViewers, setLoadingViewers] = useState(false);
  const [isReelMuted, setIsReelMuted] = useState(true);
  const [profileOverrides, setProfileOverrides] = useState<Record<string, Partial<User>>>({});

  useEffect(() => {
    const updateProfile = (event: Event) => {
      const profile = (event as CustomEvent<Partial<User>>).detail;
      const id = profile?.id;
      if (id) setProfileOverrides(current => ({ ...current, [id]: { ...current[id], ...profile } }));
    };
    window.addEventListener('echat:profile-updated', updateProfile);
    return () => window.removeEventListener('echat:profile-updated', updateProfile);
  }, []);

  const openPostDetail = () => {
    if (detailMode || showDetailModal) return;
    window.history.pushState({ echatPostDetail: post.id }, '', `${window.location.pathname}${window.location.search}#post-${encodeURIComponent(post.id)}`);
    setShowDetailModal(true);
  };

  const closePostDetail = () => {
    setShowDetailModal(false);
    if (window.history.state?.echatPostDetail === post.id) window.history.back();
  };

  useEffect(() => {
    if (!showDetailModal) return;
    const handlePopState = () => setShowDetailModal(false);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [showDetailModal]);

  useEffect(() => {
    const node = cardRef.current;
    if (!node || !user || post.authorId === user.id || typeof IntersectionObserver === 'undefined') return;
    let recorded = false;
    const observer = new IntersectionObserver(entries => {
      if (recorded || !entries.some(entry => entry.isIntersecting)) return;
      recorded = true;
      api.recordPostView(post.id).then(({ viewsCount }) => onPostUpdated({ ...post, viewsCount })).catch(() => {});
      observer.disconnect();
    }, { threshold: 0.6 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [post.id, user?.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!reelMode || !video || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      const visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.65);
      if (visible) video.play().catch(() => {});
      else video.pause();
    }, { threshold: [0, 0.65, 1] });
    observer.observe(video);
    return () => { observer.disconnect(); video.pause(); };
  }, [reelMode, post.id]);

  const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (detailMode) return;
    const target = event.target as HTMLElement;
    if (target.closest('button,a,input,textarea,select,video,[role="dialog"]')) return;
    openPostDetail();
  };

  const handleLoadPostViewers = async () => {
    setShowViewersModal(true);
    setLoadingViewers(true);
    try { setPostViewers(await api.getPostViewers(post.id)); }
    catch (err) { alert(err instanceof Error ? err.message : 'Could not load viewers.'); }
    finally { setLoadingViewers(false); }
  };

  // Safe author access
  const author: Partial<User> & { id: string; name: string; avatar: string } = { ...(post.author || {
    id: post.authorId,
    name: 'EChat User',
    avatar: initialsAvatar('Echat User'),
    isVerified: false
  }), ...(profileOverrides[post.authorId] || {}) } as Partial<User> & { id: string; name: string; avatar: string };

  const myReaction = user ? post.reactions.find(r => r.userId === user.id) : null;
  const currentReactionMeta = myReaction ? REACTIONS.find(r => r.type === myReaction.type) : null;

  const handleReact = async (type: ReactionType) => {
    setShowReactionsBar(false);
    try {
      const updated = await api.reactToPost(post.id, type);
      onPostUpdated(updated);
    } catch (err) {
      console.error('Failed to react to post:', err);
      alert(err instanceof Error ? err.message : 'Could not react to this post. Please try again.');
    }
  };

  const isSaved = Boolean(user?.savedPosts?.includes(post.id));
  const postMediaUrls = post.mediaUrls?.length ? post.mediaUrls : (post.mediaUrl ? [post.mediaUrl] : []);

  const handleToggleSave = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      const { savedPosts } = await api.toggleSavePost(post.id);
      updateUser({ ...user, savedPosts });
      setShowOptions(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not update your saved posts.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    setIsSavingEdit(true);
    setEditError('');
    try {
      const updated = await api.editPost(post.id, { content: editText });
      onPostUpdated(updated);
      setIsEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Could not save your changes.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentInput.trim() || !user) return;
    try {
      const updated = await api.commentPost(post.id, commentInput.trim());
      setCommentInput('');
      onPostUpdated(updated);
    } catch (err) {
      console.error('Failed to comment:', err);
    }
  };

  const handleSharedCount = (sharesCount: number) => {
    confetti({ particleCount: 35, spread: 50, origin: { y: 0.8 } });
    onPostUpdated({ ...post, sharesCount });
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await api.deletePost(post.id);
      setShowDeleteConfirm(false);
      onPostDeleted(post.id);
    } catch (err) {
      console.error('Failed to delete post:', err);
      alert(err instanceof Error ? err.message : 'Could not delete this post. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleReport = async () => {
    try {
      await api.reportPost(post.id, reportReason);
      setShowReportModal(false);
      alert('Post reported to Developer / Admin for review.');
    } catch (err) {
      console.error('Failed to report post:', err);
    }
  };

  const canDelete = Boolean(user && (user.id === post.authorId || isDeveloper));

  // Count distinct reactions
  const reactionCounts = (post.reactions || []).reduce((acc, r) => {
    acc[r.type] = (acc[r.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const topReactions = REACTIONS.filter(r => reactionCounts[r.type]).slice(0, 3);

  const isDevAuthor = author.isOfficialDeveloper || author.email?.toLowerCase().trim() === 'eldermoses89@gmail.com';
  const displayName = isDevAuthor ? 'EChat Official - Developer' : author.name;

  return (
    <div ref={cardRef} id={`post-${post.id}`} onClick={handleCardClick} role={detailMode ? undefined : 'button'} tabIndex={detailMode ? undefined : 0} onKeyDown={detailMode ? undefined : e => { if (e.key === 'Enter' && e.target === e.currentTarget) openPostDetail(); }} className={`bg-white rounded-2xl shadow-xs border border-slate-200/90 overflow-hidden transition scroll-mt-20 ${detailMode ? '' : 'cursor-pointer'}`}>
      {/* Post Header */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src={author.avatar || initialsAvatar(author.name || '')}
            alt={author.name}
            onClick={() => onViewProfile(author.id)}
            className="w-10 h-10 rounded-full object-cover cursor-pointer hover:opacity-90 transition border border-slate-100"
          />
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                onClick={() => onViewProfile(author.id)}
                className="text-sm font-bold text-slate-900 hover:underline cursor-pointer flex items-center gap-1"
              >
                <span>{displayName}</span>
                {(author.isVerified || isDevAuthor) && <VerifiedBadge size={14} />}
              </span>
              {post.feeling && (
                <span className="text-xs text-slate-500 font-medium">is {post.feeling}</span>
              )}
              {post.taggedUsers && post.taggedUsers.length > 0 && (
                <span className="text-xs text-slate-500 font-medium">
                  — with{' '}
                  {post.taggedUsers.slice(0, 2).map((u, i, arr) => (
                    <span key={u.id}>
                      {i > 0 && (arr.length === 2 ? ' and ' : ', ')}
                      <span onClick={() => onViewProfile(u.id)} className="font-bold text-slate-700 hover:underline cursor-pointer">
                        {u.name}
                      </span>
                    </span>
                  ))}
                  {post.taggedUsers.length > 2 && ` and ${post.taggedUsers.length - 2} other${post.taggedUsers.length - 2 > 1 ? 's' : ''}`}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium mt-0.5">
              <span>{new Date(post.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              {post.editedAt && <span className="text-slate-400">· Edited</span>}
              <span>•</span>
              {post.privacy === 'only_me' ? (
                <span title="Only me"><Lock size={12} /></span>
              ) : post.privacy === 'friends' ? (
                <span title="Friends"><Users size={12} /></span>
              ) : (
                <span title="Public"><Globe size={12} /></span>
              )}
            </div>
          </div>
        </div>

        {/* Options Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowOptions(!showOptions)}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-full transition"
          >
            <MoreHorizontal size={18} />
          </button>

          {showOptions && (
            <div className="absolute right-0 top-10 w-44 bg-white rounded-2xl shadow-xl border border-slate-100 py-1.5 z-30 animate-in fade-in">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(postPermalink(post.id)).catch(() => {});
                  setCopiedLink(true);
                  setShowOptions(false);
                  setTimeout(() => setCopiedLink(false), 2000);
                }}
                className="w-full text-left px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
              >
                <Share2 size={14} />
                {t('copy_link')}
              </button>

              {postMediaUrls.length > 0 && (
                <a
                  href={assetUrl(postMediaUrls[0])}
                  download
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setShowOptions(false)}
                  className="w-full text-left px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                >
                  <Download size={14} /> Download media
                </a>
              )}

              <button
                onClick={() => {
                  setShowReportModal(true);
                  setShowOptions(false);
                }}
                className="w-full text-left px-3.5 py-2 text-xs font-semibold text-amber-600 hover:bg-amber-50 flex items-center gap-2"
              >
                <Flag size={14} />
                {t('report_post')}
              </button>

              {user && (
                <button
                  onClick={handleToggleSave}
                  disabled={isSaving}
                  className="w-full text-left px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-60"
                >
                  <Bookmark size={14} className={isSaved ? 'fill-amber-400 text-amber-500' : ''} />
                  {isSaved ? t('unsave_post') : t('save_post')}
                </button>
              )}

              {user?.id === post.authorId && (
                <button
                  onClick={() => {
                    setEditText(post.content || '');
                    setEditError('');
                    setIsEditing(true);
                    setShowOptions(false);
                  }}
                  className="w-full text-left px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                >
                  <Pencil size={14} />
                  {t('edit_post')}
                </button>
              )}

              {canDelete && (
                <button
                  onClick={() => { setShowOptions(false); setShowDeleteConfirm(true); }}
                  className="w-full text-left px-3.5 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-slate-100 mt-1"
                >
                  <Trash2 size={14} />
                  {t('delete_post')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {showShareModal && (
        <SharePostModal post={post} onClose={() => setShowShareModal(false)} onShared={handleSharedCount} />
      )}

      {/* Delete confirmation (in-app, works in every browser) */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4" onClick={() => !isDeleting && setShowDeleteConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-extrabold text-slate-900">{t('delete_confirm_title')}</h3>
            <p className="text-sm text-slate-500 mt-1.5">This can't be undone. The post, its reactions and comments will be removed.</p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-bold text-slate-700 disabled:opacity-60"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-sm font-bold text-white disabled:opacity-60"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inline editor (author only) */}
      {isEditing && (
        <div className="px-4 pb-3">
          <textarea
            value={editText}
            onChange={e => setEditText(e.target.value)}
            rows={4}
            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {editError && <p className="text-xs font-semibold text-red-600 mt-1">{editError}</p>}
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => setIsEditing(false)}
              className="px-3.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700"
            >
              {t('cancel')}
            </button>
            <button
              disabled={isSavingEdit}
              onClick={handleSaveEdit}
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-xs font-bold text-white"
            >
              {isSavingEdit ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Post Text Content */}
      {!isEditing && post.content && (
        <div className="px-4 pb-3">
          <p className="text-sm sm:text-base text-slate-800 leading-relaxed whitespace-pre-line">
            {post.content}
          </p>
        </div>
      )}
      {!isEditing && post.content && <VideoLinkCard text={post.content} />}
      {!isEditing && post.content && <LinkPreviewCard text={post.content} />}

      {/* Re-shared post: the original is embedded */}
      {post.sharedPostId && (
        <div className="mx-4 mb-3 rounded-2xl border border-slate-200 overflow-hidden bg-slate-50/60">
          {post.sharedPost ? (
            <>
              <div className="p-3 flex items-center gap-2.5">
                <img
                  src={post.sharedPost.author.avatar || initialsAvatar(post.sharedPost.author.name || '')}
                  alt=""
                  onClick={() => post.sharedPost?.author.id && onViewProfile(post.sharedPost.author.id)}
                  className="w-8 h-8 rounded-full object-cover cursor-pointer"
                />
                <div>
                  <p className="text-xs font-bold text-slate-900">{post.sharedPost.author.name}</p>
                  <p className="text-[10px] text-slate-400">
                    {new Date(post.sharedPost.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
              {post.sharedPost.content && (
                <p className="px-3 pb-3 text-sm text-slate-800 whitespace-pre-wrap break-words">{post.sharedPost.content}</p>
              )}
              {post.sharedPost.mediaUrl && (
                post.sharedPost.mediaType === 'video'
                  ? <video src={post.sharedPost.mediaUrl} controls className="w-full max-h-80 object-contain bg-black" />
                  : <img src={post.sharedPost.mediaUrl} alt="" className="w-full max-h-80 object-cover" />
              )}
            </>
          ) : (
            <p className="p-4 text-xs text-slate-500">This post is no longer available.</p>
          )}
        </div>
      )}

      {/* Post Media (Image / Video) */}
      {postMediaUrls.length > 0 && (
        <div className={`relative mx-auto flex items-center justify-center overflow-hidden bg-slate-900 ${reelMode ? 'aspect-[9/16] max-h-[68dvh] w-full max-w-[min(100%,390px)]' : `w-full ${detailMode ? 'max-h-[78vh]' : 'max-h-[500px]'}`}`}>
          {post.mediaType === 'video' ? (
            <video ref={videoRef} src={assetUrl(postMediaUrls[0])} controls playsInline preload={reelMode ? 'metadata' : 'none'} muted={reelMode ? isReelMuted : false} className={reelMode ? 'h-full w-full object-cover' : `w-full object-contain ${detailMode ? 'max-h-[78vh]' : 'max-h-[500px]'}`} />
          ) : (
            <div className={`grid w-full gap-0.5 ${postMediaUrls.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {postMediaUrls.slice(0, 10).map((mediaUrl, index) => <img key={`${post.id}-${index}`} src={assetUrl(mediaUrl)} alt={`Post attachment ${index + 1}`} loading="lazy" className={`w-full object-cover cursor-pointer hover:opacity-95 transition ${detailMode ? 'max-h-[78vh]' : 'max-h-[500px]'} ${postMediaUrls.length > 4 && index > 3 ? 'hidden' : ''}`} />)}
            </div>
          )}
          {reelMode && <button type="button" onClick={event => { event.stopPropagation(); setIsReelMuted(value => !value); }} aria-label={isReelMuted ? 'Unmute Reel' : 'Mute Reel'} className="absolute bottom-3 right-3 rounded-full bg-black/70 p-2 text-white">{isReelMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>}
        </div>
      )}

      {/* Stats Bar (Reactions summary & Comments count) */}
      <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between text-xs text-slate-500 font-medium">
        <div className="flex items-center gap-1.5">
          {(post.reactions || []).length > 0 ? (
            <>
              <div className="flex items-center -space-x-1">
                {topReactions.map(r => (
                  <span
                    key={r.type}
                    className="w-5 h-5 rounded-full bg-white shadow-xs flex items-center justify-center text-xs"
                  >
                    {r.emoji}
                  </span>
                ))}
              </div>
              <span className="font-semibold text-slate-700">{post.reactions.length}</span>
            </>
          ) : (
            <span>{t('be_first_react')}</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowComments(!showComments)}
            className="hover:underline cursor-pointer"
          >
            {(post.comments || []).length} comments
          </button>
          <span>{post.sharesCount || 0} shares</span>
          {user?.id === post.authorId ? (
            <button onClick={handleLoadPostViewers} className="hover:underline" title="See who viewed this post">Viewed by {post.viewsCount || 0}</button>
          ) : <span>{post.viewsCount || 0} views</span>}
        </div>
      </div>

      {/* Interactive Action Bar (Like, Comment, Share) */}
      <div className="relative px-2 py-1 flex items-center justify-between text-slate-600 font-semibold text-xs sm:text-sm">
        {/* Reaction Popover Bar */}
        {showReactionsBar && (
          <div
            onMouseLeave={() => setShowReactionsBar(false)}
            className="absolute -top-12 left-4 bg-white rounded-full shadow-2xl border border-slate-200 px-2 py-1.5 flex items-center gap-1.5 z-30 animate-in fade-in slide-in-from-bottom-2"
          >
            {REACTIONS.map((r) => (
              <button
                key={r.type}
                onClick={() => handleReact(r.type)}
                className="hover:scale-125 active:scale-95 transition text-2xl p-1 cursor-pointer"
                title={r.label}
              >
                {r.emoji}
              </button>
            ))}
          </div>
        )}

        {/* Like Button */}
        <button
          onMouseEnter={() => setShowReactionsBar(true)}
          onClick={() => handleReact(myReaction ? myReaction.type : 'like')}
          className={`flex-1 py-2 flex items-center justify-center gap-2 hover:bg-slate-50 rounded-xl transition cursor-pointer ${
            currentReactionMeta ? `${currentReactionMeta.color} font-bold` : 'text-slate-600'
          }`}
        >
          {currentReactionMeta ? (
            <span className="text-base">{currentReactionMeta.emoji}</span>
          ) : (
            <ThumbsUp size={18} />
          )}
          <span>{currentReactionMeta ? currentReactionMeta.label : 'Like'}</span>
        </button>

        {/* Comment Button */}
        <button
          onClick={() => setShowComments(!showComments)}
          className="flex-1 py-2 flex items-center justify-center gap-2 hover:bg-slate-50 rounded-xl transition cursor-pointer text-slate-600"
        >
          <MessageCircle size={18} />
          <span>{t('comment')}</span>
        </button>

        {/* Share Button */}
        <button
          onClick={() => setShowShareModal(true)}
          className="flex-1 py-2 flex items-center justify-center gap-2 hover:bg-slate-50 rounded-xl transition cursor-pointer text-slate-600"
        >
          <Share2 size={18} />
          <span>{t('share')}</span>
        </button>
      </div>

      {/* Comments Section */}
      {showComments && (
        <div className="p-4 bg-slate-50/70 border-t border-slate-100 space-y-3">
          {/* Add comment input */}
          <form onSubmit={handleAddComment} className="flex items-center gap-2.5">
            <img
              src={user?.avatar || initialsAvatar(user?.name || '')}
              alt={user?.name || 'User'}
              className="w-8 h-8 rounded-full object-cover border border-slate-200"
            />
            <div className="flex-1 relative flex items-center">
              <input
                type="text"
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                placeholder={t('write_comment')}
                className="min-h-[48px] w-full bg-white text-slate-800 text-base pl-4 pr-10 py-2 rounded-full border border-slate-200 focus:border-blue-400 focus:outline-hidden transition shadow-2xs"
              />
              <button
                type="submit"
                disabled={!commentInput.trim()}
                className="absolute right-2 p-1.5 text-blue-600 hover:text-blue-700 disabled:opacity-30 transition cursor-pointer"
              >
                <Send size={15} />
              </button>
            </div>
          </form>

          {/* Comments list */}
          <div className="space-y-2.5 pt-1">
            {(post.comments || []).map((comment) => {
              const commentAuthor = { ...(comment.author || {
                id: comment.authorId,
                name: 'User',
                avatar: initialsAvatar('Echat User')
              }), ...(profileOverrides[comment.authorId] || {}) };
              return (
                <div key={comment.id} className="flex items-start gap-2.5 group">
                  <img
                    src={commentAuthor.avatar || initialsAvatar(commentAuthor.name || '')}
                    alt={commentAuthor.name}
                    onClick={() => onViewProfile(comment.authorId)}
                    className="w-8 h-8 rounded-full object-cover cursor-pointer hover:opacity-90 transition mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="bg-white rounded-2xl px-3.5 py-2 shadow-2xs border border-slate-200/70 inline-block max-w-full">
                      <p
                        onClick={() => onViewProfile(comment.authorId)}
                        className="text-xs font-bold text-slate-900 hover:underline cursor-pointer"
                      >
                        {commentAuthor.name}
                      </p>
                      <p className="text-xs text-slate-700 mt-0.5 leading-relaxed break-words">
                        {comment.content}
                      </p>
                      <VideoLinkCard text={comment.content} />
                      <LinkPreviewCard text={comment.content} compact />
                    </div>
                    <div className="flex items-center gap-3 px-2 mt-0.5 text-[10px] text-slate-400 font-semibold">
                      <span>{new Date(comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <button className="hover:text-blue-600 hover:underline cursor-pointer">{t('like')}</button>
                      <button className="hover:text-blue-600 hover:underline cursor-pointer">{t('reply')}</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-base font-bold text-slate-900 mb-2">{t('report_post')}</h3>
            <p className="text-xs text-slate-500 mb-4">
              Help us keep Echat safe. Why are you reporting this post to Developer Mode?
            </p>
            <div className="space-y-2 mb-6">
              {[
                'Inappropriate or offensive content',
                'Harassment or hate speech',
                'Spam or misleading information',
                'Violence or dangerous content'
              ].map(reason => (
                <label key={reason} className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer p-2 rounded-xl hover:bg-slate-50">
                  <input
                    type="radio"
                    name="reportReason"
                    checked={reportReason === reason}
                    onChange={() => setReportReason(reason)}
                    className="text-blue-600"
                  />
                  <span>{reason}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowReportModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-full"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleReport}
                className="px-4 py-2 text-xs font-semibold bg-red-600 text-white rounded-full hover:bg-red-700"
              >
                Submit Report
              </button>
            </div>
          </div>
        </div>
      )}

      {showDetailModal && !detailMode && (
        <div role="dialog" aria-modal="true" aria-label="Post details" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-2 sm:p-5" onClick={closePostDetail}>
          <div className="relative max-h-[96vh] w-full max-w-3xl overflow-y-auto rounded-2xl" onClick={e => e.stopPropagation()}>
            <button onClick={closePostDetail} aria-label="Close post" className="sticky top-2 z-20 float-right mr-2 mt-2 rounded-full bg-white p-2 text-slate-700 shadow"><span aria-hidden="true">×</span></button>
            <PostCard post={post} onPostUpdated={onPostUpdated} onPostDeleted={onPostDeleted} onViewProfile={onViewProfile} detailMode />
          </div>
        </div>
      )}

      {showViewersModal && (
        <div role="dialog" aria-modal="true" aria-label="Post viewers" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={() => setShowViewersModal(false)}>
          <section className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between"><h2 className="font-bold text-slate-900">Post viewers</h2><button onClick={() => setShowViewersModal(false)} className="rounded-full p-2 hover:bg-slate-100" aria-label="Close">×</button></div>
            {loadingViewers ? <p className="py-6 text-center text-sm text-slate-500">Loading viewers…</p> : postViewers.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No viewers yet.</p> : <div className="max-h-[60vh] space-y-3 overflow-y-auto">{postViewers.map(viewer => <div key={viewer.id} className="flex items-center gap-3"><img src={viewer.avatar || initialsAvatar(viewer.name)} alt="" className="h-10 w-10 rounded-full object-cover"/><span className="flex-1 text-sm font-semibold text-slate-800">{viewer.name}</span><time className="text-xs text-slate-500">{new Date(viewer.viewedAt).toLocaleString()}</time></div>)}</div>}
          </section>
        </div>
      )}
    </div>
  );
};
