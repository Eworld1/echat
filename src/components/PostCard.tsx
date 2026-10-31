import React, { useState } from 'react';
import { Post, ReactionType, User } from '../types';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { VerifiedBadge } from './VerifiedBadge';
import confetti from 'canvas-confetti';
import {
  ThumbsUp,
  MessageCircle,
  Share2,
  MoreHorizontal,
  Trash2,
  Flag,
  Globe,
  Users,
  Send
} from 'lucide-react';

interface PostCardProps {
  post: Post;
  onPostUpdated: (post: Post) => void;
  onPostDeleted: (postId: string) => void;
  onViewProfile: (userId: string) => void;
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
  onViewProfile
}) => {
  const { user, isDeveloper } = useAuth();
  const [showReactionsBar, setShowReactionsBar] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('Inappropriate or offensive content');
  const [copiedLink, setCopiedLink] = useState(false);

  // Safe author access
  const author: Partial<User> & { id: string; name: string; avatar: string } = post.author || {
    id: post.authorId,
    name: 'EChat User',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
    isVerified: false
  };

  const myReaction = user ? post.reactions.find(r => r.userId === user.id) : null;
  const currentReactionMeta = myReaction ? REACTIONS.find(r => r.type === myReaction.type) : null;

  const handleReact = async (type: ReactionType) => {
    setShowReactionsBar(false);
    try {
      const updated = await api.reactToPost(post.id, type);
      onPostUpdated(updated);
    } catch (err) {
      console.error('Failed to react to post:', err);
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

  const handleShare = async () => {
    try {
      await api.sharePost(post.id);
      confetti({ particleCount: 35, spread: 50, origin: { y: 0.8 } });
      onPostUpdated({ ...post, sharesCount: (post.sharesCount || 0) + 1 });
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (err) {
      console.error('Failed to share:', err);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this post?')) return;
    try {
      await api.deletePost(post.id);
      onPostDeleted(post.id);
    } catch (err) {
      console.error('Failed to delete post:', err);
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
    <div id={`post-${post.id}`} className="bg-white rounded-2xl shadow-xs border border-slate-200/90 overflow-hidden transition scroll-mt-20">
      {/* Post Header */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src={author.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80'}
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
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium mt-0.5">
              <span>{new Date(post.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              <span>•</span>
              {post.privacy === 'public' ? (
                <span title="Public"><Globe size={12} /></span>
              ) : (
                <span title="Friends"><Users size={12} /></span>
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
                  navigator.clipboard.writeText(window.location.href);
                  setCopiedLink(true);
                  setShowOptions(false);
                  setTimeout(() => setCopiedLink(false), 2000);
                }}
                className="w-full text-left px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
              >
                <Share2 size={14} />
                Copy Link to Post
              </button>

              <button
                onClick={() => {
                  setShowReportModal(true);
                  setShowOptions(false);
                }}
                className="w-full text-left px-3.5 py-2 text-xs font-semibold text-amber-600 hover:bg-amber-50 flex items-center gap-2"
              >
                <Flag size={14} />
                Report Post
              </button>

              {canDelete && (
                <button
                  onClick={handleDelete}
                  className="w-full text-left px-3.5 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-slate-100 mt-1"
                >
                  <Trash2 size={14} />
                  Delete Post
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Post Text Content */}
      {post.content && (
        <div className="px-4 pb-3">
          <p className="text-sm sm:text-base text-slate-800 leading-relaxed whitespace-pre-line">
            {post.content}
          </p>
        </div>
      )}

      {/* Post Media (Image / Video) */}
      {post.mediaUrl && (
        <div className="relative bg-slate-900 max-h-[500px] overflow-hidden flex items-center justify-center">
          {post.mediaType === 'video' ? (
            <video src={post.mediaUrl} controls className="w-full max-h-[500px] object-contain" />
          ) : (
            <img
              src={post.mediaUrl}
              alt="post attachment"
              className="w-full max-h-[500px] object-cover cursor-pointer hover:opacity-95 transition"
            />
          )}
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
            <span>Be the first to react</span>
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
          <span>Comment</span>
        </button>

        {/* Share Button */}
        <button
          onClick={handleShare}
          className="flex-1 py-2 flex items-center justify-center gap-2 hover:bg-slate-50 rounded-xl transition cursor-pointer text-slate-600"
        >
          <Share2 size={18} />
          <span>{copiedLink ? 'Shared! 🎉' : 'Share'}</span>
        </button>
      </div>

      {/* Comments Section */}
      {showComments && (
        <div className="p-4 bg-slate-50/70 border-t border-slate-100 space-y-3">
          {/* Add comment input */}
          <form onSubmit={handleAddComment} className="flex items-center gap-2.5">
            <img
              src={user?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80'}
              alt={user?.name || 'User'}
              className="w-8 h-8 rounded-full object-cover border border-slate-200"
            />
            <div className="flex-1 relative flex items-center">
              <input
                type="text"
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                placeholder="Write a comment..."
                className="w-full bg-white text-slate-800 text-xs sm:text-sm pl-4 pr-10 py-2 rounded-full border border-slate-200 focus:border-blue-400 focus:outline-hidden transition shadow-2xs"
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
              const commentAuthor = comment.author || {
                id: comment.authorId,
                name: 'User',
                avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80'
              };
              return (
                <div key={comment.id} className="flex items-start gap-2.5 group">
                  <img
                    src={commentAuthor.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80'}
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
                    </div>
                    <div className="flex items-center gap-3 px-2 mt-0.5 text-[10px] text-slate-400 font-semibold">
                      <span>{new Date(comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <button className="hover:text-blue-600 hover:underline cursor-pointer">Like</button>
                      <button className="hover:text-blue-600 hover:underline cursor-pointer">Reply</button>
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
            <h3 className="text-base font-bold text-slate-900 mb-2">Report Post</h3>
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
                Cancel
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
    </div>
  );
};