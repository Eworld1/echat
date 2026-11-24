import { usePreferences } from '../context/PreferencesContext';
import { UserAvatar } from './UserAvatar';
import { openAvatarViewer } from './AvatarViewer';
import { getReelsMuted, setReelsMuted } from '../services/reels/reelSound';
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
import { useBackButton } from '../hooks/useBackButton';
import { PhotoViewer } from './PhotoViewer';
import { PostPhotoGrid } from './PostPhotoGrid';
import { LowDataVideoCover } from './LowData';
import { isUnlocked, lightVideoUrl, useLowDataMode } from '../services/lowData';
import { getPostImageUrls } from '../utils/postImages';
import { saveImageToDevice } from '../utils/saveImage';
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
  Download
  , Play
  , Loader2
} from 'lucide-react';

interface PostCardProps {
  post: Post;
  onPostUpdated: (post: Post) => void;
  onPostDeleted: (postId: string) => void;
  onViewProfile: (userId: string) => void;
  reelMode?: boolean;
  reelActive?: boolean;
  detailMode?: boolean;
  reelPreload?: 'metadata' | 'auto';
}

const SEE_MORE_CHARS = 280;

/** "Just now", "5m", "3h", "2d", then a date — like Facebook. */
function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d`;
  const date = new Date(timestamp);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

let likeCss = false;
if (typeof document !== 'undefined' && !likeCss) {
  likeCss = true;
  const style = document.createElement('style');
  style.textContent = '@keyframes echatLikePop { 0% { transform: scale(1); } 35% { transform: scale(1.35) rotate(-12deg); } 70% { transform: scale(0.92); } 100% { transform: scale(1); } }';
  document.head.appendChild(style);
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
  reelActive,
  detailMode = false,
  reelPreload = 'metadata'
}) => {
  const { user, isDeveloper, updateUser } = useAuth();
  const { t } = usePreferences();
  const [showReactionsBar, setShowReactionsBar] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [textExpanded, setTextExpanded] = useState(false);
  const [likePop, setLikePop] = useState(0);
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
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);
  const [imageMenuIndex, setImageMenuIndex] = useState<number | null>(null);
  const [imageToast, setImageToast] = useState('');
  const [showViewersModal, setShowViewersModal] = useState(false);
  const [postViewers, setPostViewers] = useState<{ id: string; name: string; avatar: string; viewedAt: number }[]>([]);
  const [loadingViewers, setLoadingViewers] = useState(false);
  const [isReelMuted, setIsReelMuted] = useState(() => typeof window === 'undefined' || getReelsMuted());
  const reelHoldTimer = useRef<number | null>(null);
  const reelHeld = useRef(false);
  const [isReelPlaying, setIsReelPlaying] = useState(false);
  const [isReelBuffering, setIsReelBuffering] = useState(true);
  const [reelPlaybackError, setReelPlaybackError] = useState(false);
  const [reelsAutoplay, setReelsAutoplay] = useState(() => { if (typeof window === 'undefined') return true; const saved = window.localStorage.getItem('reels_autoplay'); return saved !== null ? saved === 'true' : user?.reelsAutoplay !== false; });
  const [wifiOnlyAutoplay, setWifiOnlyAutoplay] = useState(() => { if (typeof window === 'undefined') return false; const saved = window.localStorage.getItem('reels_wifi_only'); return saved !== null ? saved === 'true' : Boolean(user?.reelsWifiOnly); });
  const manualPauseRef = useRef(false);
  const manualPlayRef = useRef(false);
  // Low Data Mode: no autoplay; videos show a cover (thumbnail + Play + size) and play a 480p copy when tapped.
  const [lowData] = useLowDataMode();
  const firstMediaUrl = assetUrl(getPostImageUrls(post)[0] || '');
  const [videoUnlocked, setVideoUnlocked] = useState(() => isUnlocked(firstMediaUrl));
  const [playRequested, setPlayRequested] = useState(false);
  const [lightVideoFailed, setLightVideoFailed] = useState(false);
  const videoGated = lowData && post.mediaType === 'video' && !videoUnlocked;
  const lightVideo = lowData && !lightVideoFailed ? lightVideoUrl(firstMediaUrl) : firstMediaUrl;
  const unlockVideo = () => { manualPauseRef.current = false; manualPlayRef.current = true; setPlayRequested(true); setVideoUnlocked(true); };
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
    setShowDetailModal(true);
  };

  const closePostDetail = () => {
    setShowDetailModal(false);
  };
  useBackButton(showDetailModal, closePostDetail, `post-detail-${post.id}`);
  useEffect(() => {
    if (detailMode) return;
    const match = window.location.pathname.match(/^\/photo\/([^/]+)\/(\d+)$/);
    if (!match) return;
    try { if (decodeURIComponent(match[1]) === post.id) setPhotoIndex(Number(match[2])); } catch { /* Ignore malformed photo links. */ }
  }, [post.id, detailMode]);
  useEffect(() => { if (!imageToast) return; const timer = window.setTimeout(() => setImageToast(''), 2200); return () => window.clearTimeout(timer); }, [imageToast]);

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
    if (!reelMode || !video || (reelActive === undefined && typeof IntersectionObserver === 'undefined')) return;
    const connection = (navigator as Navigator & { connection?: { type?: string; effectiveType?: string } }).connection;
    const isMobileData = connection?.type === 'cellular' || ['slow-2g', '2g', '3g'].includes(connection?.effectiveType || '');
    const blockedByDataSaver = wifiOnlyAutoplay && isMobileData;
    const pauseOtherReels = () => document.querySelectorAll<HTMLVideoElement>('[data-echat-reel-video="true"]').forEach(other => { if (other !== video) other.pause(); });
    const playWhenEligible = (allowManual = true) => {
      if (document.visibilityState === 'hidden') return;
      if (reelActive === false) {
        video.pause();
        return;
      }
      if ((reelsAutoplay && !blockedByDataSaver && !lowData && !manualPauseRef.current) || (allowManual && manualPlayRef.current)) {
        pauseOtherReels();
        video.muted = isReelMuted;
        void video.play().catch(async (error: unknown) => {
          // Browser blocked sound on autoplay: keep playing muted and show 🔇 truthfully.
          if ((error as DOMException)?.name === 'NotAllowedError' && !video.muted) {
            video.muted = true;
            setIsReelMuted(true);
            setReelsMuted(true, false);
            try { await video.play(); return; } catch { /* fall through to the play button */ }
          }
          manualPauseRef.current = true;
          setIsReelBuffering(false);
        });
      } else video.pause();
    };
    let observer: IntersectionObserver | undefined;
    if (reelActive !== undefined) {
      if (reelActive) playWhenEligible();
      else {
        manualPauseRef.current = false;
        manualPlayRef.current = false;
        video.pause();
        if (video.readyState > 0) video.currentTime = 0;
      }
    } else {
      observer = new IntersectionObserver(entries => {
        const visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.6);
        if (visible) playWhenEligible();
        else {
          manualPauseRef.current = false;
          manualPlayRef.current = false;
          video.pause();
          if (video.readyState > 0) video.currentTime = 0;
        }
      }, { threshold: [0, 0.6, 1] });
      observer.observe(video);
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') video.pause();
      else playWhenEligible(false);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', onVisibilityChange); video.pause(); };
  }, [reelMode, reelActive, post.id, reelsAutoplay, wifiOnlyAutoplay, isReelMuted, lowData, videoGated]);

  useEffect(() => {
    const onReelSettings = () => {
      setReelsAutoplay(window.localStorage.getItem('reels_autoplay') !== 'false');
      setWifiOnlyAutoplay(window.localStorage.getItem('reels_wifi_only') === 'true');
      setIsReelMuted(getReelsMuted());
    };
    window.addEventListener('echat:reels-settings', onReelSettings);
    return () => window.removeEventListener('echat:reels-settings', onReelSettings);
  }, []);

  /** Reel sound for every reel; applied to this video inside the tap so phones allow it. */
  const setReelSound = (muted: boolean) => {
    setIsReelMuted(muted);
    if (videoRef.current) videoRef.current.muted = muted;
    setReelsMuted(muted);
  };
  // Reels: tap = sound on/off (or play if paused), press and hold = pause while held.
  const onReelPressStart = () => {
    reelHeld.current = false;
    if (reelHoldTimer.current) window.clearTimeout(reelHoldTimer.current);
    reelHoldTimer.current = window.setTimeout(() => {
      const video = videoRef.current;
      if (video && !video.paused) { reelHeld.current = true; video.pause(); }
    }, 280);
  };
  const onReelPressEnd = () => {
    if (reelHoldTimer.current) window.clearTimeout(reelHoldTimer.current);
    reelHoldTimer.current = null;
    if (reelHeld.current) void videoRef.current?.play().catch(() => {});
  };
  const handleReelTap = () => {
    if (reelHeld.current) { reelHeld.current = false; return; }
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) { toggleReelPlayback(); return; }
    setReelSound(!isReelMuted);
  };

  const toggleReelPlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      manualPauseRef.current = false;
      manualPlayRef.current = true;
      video.muted = isReelMuted;
      void video.play().catch(() => {});
    } else {
      manualPauseRef.current = true;
      manualPlayRef.current = false;
      video.pause();
    }
  };

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
  }), ...(profileOverrides[post.authorId] || {}),
    // My own posts: show my current name + photo instantly after I change them.
    ...(user && post.authorId === user.id && !(post.author as { isPage?: boolean } | undefined)?.isPage ? { name: user.name, avatar: user.avatar } : {}) } as Partial<User> & { id: string; name: string; avatar: string };

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
  const postMediaUrls = getPostImageUrls(post);
  const openPhoto = (index: number) => {
    if (!window.location.pathname.startsWith('/photo/')) window.history.pushState({ ...window.history.state, echatPhotoViewer: true }, '', `/photo/${encodeURIComponent(post.id)}/${index}`);
    setPhotoIndex(index);
    setImageMenuIndex(null);
  };
  const saveTileImage = async (index: number) => {
    try { await saveImageToDevice(assetUrl(postMediaUrls[index]), `echat-${post.id}-${index + 1}.jpg`); setImageToast('Image saved to your device'); }
    catch (error) { setImageToast(error instanceof Error ? error.message : 'Image download failed.'); }
    finally { setImageMenuIndex(null); }
  };
  const network = typeof navigator !== 'undefined' ? (navigator as Navigator & { connection?: { type?: string; effectiveType?: string } }).connection : undefined;
  const autoplayBlockedByDataSaver = wifiOnlyAutoplay && (network?.type === 'cellular' || ['slow-2g', '2g', '3g'].includes(network?.effectiveType || ''));

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
  const isLongText = (post.content || '').length > SEE_MORE_CHARS + 40 || (post.content || '').split('\n').length > 7;

  return (
    <div ref={cardRef} id={`post-${post.id}`} onClick={handleCardClick} role={detailMode ? undefined : 'button'} tabIndex={detailMode ? undefined : 0} onKeyDown={detailMode ? undefined : e => { if (e.key === 'Enter' && e.target === e.currentTarget) openPostDetail(); }} className={reelMode ? 'relative isolate h-full min-h-0 w-full overflow-hidden bg-black text-white' : `bg-white rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.08),0_2px_8px_rgba(15,23,42,0.04)] border border-slate-200/80 overflow-hidden transition scroll-mt-20 ${detailMode ? '' : 'cursor-pointer'}`}>
      {/* Post Header */}
      <div className={reelMode ? 'absolute inset-x-0 top-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/75 to-transparent p-3 pb-7 text-white' : 'p-4 flex items-center justify-between'}>
        <div className="flex items-center gap-3">
          <UserAvatar src={author.avatar} name={author.name || 'EChat user'} size={40} onClick={() => openAvatarViewer({ userId: author.id, name: author.name || 'EChat user', avatar: author.avatar })} className={reelMode ? 'ring-2 ring-white/80' : 'ring-1 ring-slate-200'} />
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                onClick={() => onViewProfile(author.id)}
                className={`text-sm font-bold hover:underline cursor-pointer flex items-center gap-1 ${reelMode ? 'text-white' : 'text-slate-900'}`}
              >
                <span>{displayName}</span>
                {(author.isVerified || isDevAuthor) && <VerifiedBadge size={14} />}
              </span>
              {post.feeling && (
                <span className={`text-xs font-medium ${reelMode ? 'text-white/80' : 'text-slate-500'}`}>is {post.feeling}</span>
              )}
              {post.taggedUsers && post.taggedUsers.length > 0 && (
                <span className={`text-xs font-medium ${reelMode ? 'text-white/80' : 'text-slate-500'}`}>
                  — with{' '}
                  {post.taggedUsers.slice(0, 2).map((u, i, arr) => (
                    <span key={u.id}>
                      {i > 0 && (arr.length === 2 ? ' and ' : ', ')}
                      <span onClick={() => onViewProfile(u.id)} className={`font-bold hover:underline cursor-pointer ${reelMode ? 'text-white' : 'text-slate-700'}`}>
                        {u.name}
                      </span>
                    </span>
                  ))}
                  {post.taggedUsers.length > 2 && ` and ${post.taggedUsers.length - 2} other${post.taggedUsers.length - 2 > 1 ? 's' : ''}`}
                </span>
              )}
            </div>
            <div className={`flex items-center gap-1.5 text-xs font-medium mt-0.5 ${reelMode ? 'text-white/75' : 'text-slate-400'}`}>
              <time dateTime={new Date(post.createdAt).toISOString()} title={new Date(post.createdAt).toLocaleString()}>{timeAgo(post.createdAt)}</time>
              {post.editedAt && <span className={reelMode ? 'text-white/70' : 'text-slate-400'}>· Edited</span>}
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
            className={`rounded-full p-2 transition ${reelMode ? 'text-white hover:bg-white/15' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
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
        <div className={reelMode ? 'absolute bottom-28 left-3 right-16 z-20 max-h-[20dvh] overflow-hidden drop-shadow-md' : 'px-4 pb-3'}>
          <p className={`whitespace-pre-line break-words leading-relaxed ${reelMode ? 'line-clamp-4 text-sm text-white' : 'text-[15px] text-slate-800'}`}>
            {!reelMode && isLongText && !textExpanded ? `${post.content.slice(0, SEE_MORE_CHARS).trimEnd()}… ` : post.content}
            {!reelMode && isLongText && (
              <button type="button" onClick={event => { event.stopPropagation(); setTextExpanded(value => !value); }} className="font-semibold text-slate-500 hover:underline">
                {textExpanded ? ' See less' : 'See more'}
              </button>
            )}
          </p>
        </div>
      )}
      {!reelMode && !isEditing && post.content && <VideoLinkCard text={post.content} />}
      {!reelMode && !isEditing && post.content && <LinkPreviewCard text={post.content} />}

      {/* Re-shared post: the original is embedded */}
      {post.sharedPostId && !reelMode && (
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
                  ? <SharedVideo url={post.sharedPost.mediaUrl} />
                  : lowData ? <PostPhotoGrid urls={[post.sharedPost.mediaUrl]} altPrefix="Shared photo" />
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
        <div className={`relative mx-auto flex items-center justify-center overflow-hidden bg-slate-900 ${reelMode ? 'absolute inset-0 z-0 h-full w-full max-h-none max-w-none' : 'w-full'}`}>
          {post.mediaType === 'video' && videoGated ? (
            <LowDataVideoCover url={firstMediaUrl} poster={post.thumbnailUrl ? assetUrl(post.thumbnailUrl) : undefined} onPlay={unlockVideo} countsAsSaving={reelMode} label={reelMode ? 'Play Reel' : 'Play video'} className={reelMode ? 'h-full min-h-full' : 'aspect-video max-h-[500px]'} />
          ) : post.mediaType === 'video' ? (
            <video data-echat-reel-video={reelMode ? 'true' : undefined} ref={videoRef} src={lightVideo} autoPlay={playRequested} poster={post.thumbnailUrl ? assetUrl(post.thumbnailUrl) : undefined} controls={!reelMode} playsInline loop={reelMode} preload={reelMode ? (lowData ? 'none' : reelPreload) : 'none'} muted={reelMode ? isReelMuted : false} onClick={reelMode ? handleReelTap : undefined} onPointerDown={reelMode ? onReelPressStart : undefined} onPointerUp={reelMode ? onReelPressEnd : undefined} onPointerCancel={reelMode ? onReelPressEnd : undefined} onContextMenu={reelMode ? event => event.preventDefault() : undefined} onPlay={() => { setIsReelPlaying(true); setIsReelBuffering(false); }} onPause={() => setIsReelPlaying(false)} onLoadStart={() => { if (reelMode) { setIsReelBuffering(true); setReelPlaybackError(false); } }} onWaiting={() => reelMode && setIsReelBuffering(true)} onCanPlay={() => setIsReelBuffering(false)} onError={() => { if (lightVideo !== firstMediaUrl) { setLightVideoFailed(true); return; } if (reelMode) { setIsReelBuffering(false); setReelPlaybackError(true); } }} className={reelMode ? 'h-full w-full object-cover' : `w-full object-contain ${detailMode ? 'max-h-[78vh]' : 'max-h-[500px]'}`} />
          ) : (
            <>
              {!reelMode && (
                <PostPhotoGrid
                  urls={postMediaUrls.map(url => assetUrl(url))}
                  altPrefix="Post photo"
                  onSelect={openPhoto}
                  renderTileControls={index => (
                    <>
                      <button type="button" onClick={event => { event.stopPropagation(); setImageMenuIndex(value => value === index ? null : index); }} aria-label={`Options for photo ${index + 1}`} className="absolute right-2 top-2 z-20 grid h-9 w-9 place-items-center rounded-full bg-black/65 text-white shadow sm:opacity-0 sm:group-hover:opacity-100"><MoreHorizontal size={19} /></button>
                      {imageMenuIndex === index && <div className="absolute right-2 top-12 z-30 w-44 rounded-xl bg-white p-1 text-left text-xs font-semibold text-slate-800 shadow-xl"><button type="button" onClick={event => { event.stopPropagation(); void saveTileImage(index); }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 hover:bg-slate-100"><Download size={15} />Save This Image</button><button type="button" onClick={event => { event.stopPropagation(); openPhoto(index); }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 hover:bg-slate-100">View Full Screen</button></div>}
                    </>
                  )}
                />
              )}
              {reelMode && <img src={assetUrl(postMediaUrls[0])} alt="Post image" className="max-h-[78vh] w-full object-contain" />}
              {imageToast&&<p role="status" className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 text-xs font-semibold text-white">{imageToast}</p>}
            </>
          )}
          {reelMode && !videoGated && !isReelPlaying && (autoplayBlockedByDataSaver || !reelsAutoplay || manualPauseRef.current) && <button type="button" onClick={event => { event.stopPropagation(); toggleReelPlayback(); }} aria-label="Play Reel" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/25 text-white"><span className="grid h-14 w-14 place-items-center rounded-full bg-black/60"><Play size={24} fill="currentColor" /></span>{autoplayBlockedByDataSaver && <span className="rounded-full bg-black/60 px-3 py-1 text-xs">Tap to play — you’re on mobile data</span>}</button>}
          {reelMode && !videoGated && isReelBuffering && !isReelPlaying && !reelPlaybackError && ((reelsAutoplay && !autoplayBlockedByDataSaver) || manualPlayRef.current) && <div aria-label="Loading Reel" className="pointer-events-none absolute inset-0 grid place-items-center bg-black/10 text-white"><Loader2 size={32} className="animate-spin" /></div>}
          {reelMode && reelPlaybackError && <div className="absolute inset-0 grid place-items-center bg-black/60 p-4 text-center text-white"><div><p className="mb-2 text-sm font-semibold">This Reel couldn’t play.</p><button type="button" onClick={() => { setReelPlaybackError(false); setIsReelBuffering(true); videoRef.current?.load(); if (reelsAutoplay) videoRef.current?.play().catch(() => {}); }} className="rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-900">Tap to retry</button></div></div>}
          {/* Reels sound: the 🔊/🔇 button in the Reels top bar (and tapping the video) controls every reel. */}
        </div>
      )}

      {/* Stats Bar (Reactions summary & Comments count) */}
      <div className={reelMode ? 'absolute bottom-[58px] left-3 right-16 z-20 flex items-center justify-between gap-2 rounded-xl bg-black/55 px-3 py-1.5 text-[11px] font-semibold text-white drop-shadow-md' : 'px-4 py-2 border-b border-slate-100 flex items-center justify-between gap-3 text-xs text-slate-500 font-medium'}>
        {!reelMode ? (
          <>
            <div className="flex min-w-0 items-center gap-1.5">
              {(post.reactions?.length || 0) > 0 ? (
                <>
                  <span className="flex items-center">
                    {(topReactions.length ? topReactions : REACTIONS.slice(0, 1)).map(r => (
                      <span key={r.type} title={`${r.label}`} className="-ml-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white text-[11px] ring-2 ring-white first:ml-0">{r.emoji}</span>
                    ))}
                  </span>
                  <span className="whitespace-nowrap text-[13px] text-slate-500">{post.reactions.length}</span>
                </>
              ) : <span className="text-[13px] text-slate-400">Be the first to like this</span>}
            </div>
            <div className="flex shrink-0 items-center gap-3 text-[13px] text-slate-500">
              {(post.comments || []).length > 0 && <button onClick={() => setShowComments(!showComments)} className="whitespace-nowrap hover:underline">{(post.comments || []).length} comment{(post.comments || []).length === 1 ? '' : 's'}</button>}
              {(post.sharesCount || 0) > 0 && <span className="whitespace-nowrap">{post.sharesCount} share{post.sharesCount === 1 ? '' : 's'}</span>}
              {user?.id === post.authorId && <button onClick={handleLoadPostViewers} className="whitespace-nowrap hover:underline" title="See who viewed this post">{post.viewsCount || 0} views</button>}
            </div>
          </>
        ) : (
          <>
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
                  <span className="font-semibold text-white">{post.reactions.length}</span>
                </>
              ) : (
                <span>{t('be_first_react')}</span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowComments(!showComments)}
                className="cursor-pointer hover:underline"
              >
                {(post.comments || []).length} comments
              </button>
              <span>{post.sharesCount || 0} shares</span>
              {user?.id === post.authorId ? (
                <button onClick={handleLoadPostViewers} className="hover:underline" title="See who viewed this post">Viewed by {post.viewsCount || 0}</button>
              ) : <span>{post.viewsCount || 0} views</span>}
            </div>
          </>
        )}
      </div>

      {/* Interactive Action Bar (Like, Comment, Share) */}
      <div className={reelMode ? 'absolute bottom-2 left-2 right-14 z-20 flex items-center justify-between rounded-xl bg-black/55 px-1 py-1 text-xs font-semibold text-white drop-shadow-md' : 'relative px-2 py-1 flex items-center justify-between text-slate-600 font-semibold text-xs sm:text-sm'}>
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
          onClick={() => { setLikePop(value => value + 1); handleReact(myReaction ? myReaction.type : 'like'); }}
          aria-pressed={Boolean(myReaction)}
          className={`flex-1 py-2 flex items-center justify-center gap-2 rounded-xl transition cursor-pointer ${reelMode ? 'hover:bg-white/15' : 'hover:bg-slate-50'} ${
            currentReactionMeta ? `${currentReactionMeta.color} font-bold` : reelMode ? 'text-white' : 'text-slate-600'
          }`}
        >
          <span key={likePop} className="inline-flex" style={likePop ? { animation: 'echatLikePop .38s ease-out' } : undefined}>
            {currentReactionMeta ? (
              currentReactionMeta.type === 'like' ? <ThumbsUp size={18} className="fill-current" /> : <span className="text-base">{currentReactionMeta.emoji}</span>
            ) : (
              <ThumbsUp size={18} />
            )}
          </span>
          <span>{currentReactionMeta ? currentReactionMeta.label : 'Like'}</span>
        </button>

        {/* Comment Button */}
        <button
          onClick={() => setShowComments(!showComments)}
          className={`flex-1 py-2 flex items-center justify-center gap-2 rounded-xl transition cursor-pointer ${reelMode ? 'text-white hover:bg-white/15' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          <MessageCircle size={18} />
          <span>{t('comment')}</span>
        </button>

        {/* Share Button */}
        <button
          onClick={() => setShowShareModal(true)}
          className={`flex-1 py-2 flex items-center justify-center gap-2 rounded-xl transition cursor-pointer ${reelMode ? 'text-white hover:bg-white/15' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          <Share2 size={18} />
          <span>{t('share')}</span>
        </button>
      </div>

      {/* Comments Section */}
      {showComments && (
        <div className={reelMode ? 'absolute inset-x-0 bottom-0 z-30 max-h-[45%] overflow-y-auto overscroll-contain bg-white p-4 text-slate-900 shadow-2xl' : 'p-4 bg-slate-50/70 border-t border-slate-100 space-y-3'}>
          {/* Add comment input */}
          <form onSubmit={handleAddComment} className="flex items-center gap-2.5">
            <UserAvatar src={user?.avatar} name={user?.name || 'You'} size={32} />
            <div className="flex-1 relative flex items-center">
              <input
                type="text"
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                placeholder="Write a comment..."
                aria-label="Write a comment"
                className="min-h-[44px] w-full rounded-full border border-slate-200 bg-[#F0F2F5] py-2 pl-4 pr-16 text-base text-slate-800 transition focus:border-blue-400 focus:bg-white focus:outline-hidden"
              />
              <button
                type="submit"
                disabled={!commentInput.trim()}
                className="absolute right-1.5 flex min-h-8 items-center gap-1 rounded-full bg-[#1877F2] px-3 text-xs font-bold text-white transition hover:bg-[#166FE5] disabled:bg-slate-300 cursor-pointer"
              >
                <Send size={13} />Post
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
              }), ...(profileOverrides[comment.authorId] || {}), ...(user && comment.authorId === user.id ? { name: user.name, avatar: user.avatar } : {}) };
              return (
                <div key={comment.id} className="flex items-start gap-2.5 group">
                  <UserAvatar src={commentAuthor.avatar} name={commentAuthor.name || 'EChat user'} size={32} onClick={() => openAvatarViewer({ userId: comment.authorId, name: commentAuthor.name || 'EChat user', avatar: commentAuthor.avatar })} className="mt-0.5" />
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
            {loadingViewers ? <p className="py-6 text-center text-sm text-slate-500">Loading viewers…</p> : postViewers.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No viewers yet.</p> : <div className="max-h-[60vh] space-y-3 overflow-y-auto">{postViewers.map(viewer => <div key={viewer.id} className="flex items-center gap-3"><UserAvatar src={viewer.avatar} name={viewer.name} size={40} /><span className="flex-1 text-sm font-semibold text-slate-800">{viewer.name}</span><time className="text-xs text-slate-500">{new Date(viewer.viewedAt).toLocaleString()}</time></div>)}</div>}
          </section>
        </div>
      )}
      {photoIndex !== null && post.mediaType !== 'video' && <PhotoViewer post={post} images={postMediaUrls} initialIndex={photoIndex} onClose={() => setPhotoIndex(null)} onPostUpdated={onPostUpdated} />}
    </div>
  );
};

/** Re-shared video: in Low Data Mode a cover first, then a 480p copy. */
const SharedVideo: React.FC<{ url: string }> = ({ url }) => {
  const [lowData] = useLowDataMode();
  const [open, setOpen] = useState(() => isUnlocked(url));
  const [requested, setRequested] = useState(false);
  const [failed, setFailed] = useState(false);
  if (lowData && !open) return <LowDataVideoCover url={url} countsAsSaving={false} onPlay={() => { setOpen(true); setRequested(true); }} className="aspect-video max-h-80" />;
  const src = lowData && !failed ? lightVideoUrl(url) : url;
  return <video src={src} autoPlay={requested} controls playsInline preload="none" onError={() => { if (src !== url) setFailed(true); }} className="w-full max-h-80 object-contain bg-black" />;
};
