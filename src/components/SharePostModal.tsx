import React, { useState } from 'react';
import { Copy, Mail, Send, Share2, X, Check } from 'lucide-react';
import { api } from '../services/api';
import { Post } from '../types';
import { useAuth } from '../context/AuthContext';
import { initialsAvatar } from '../utils/avatar';

interface SharePostModalProps {
  post: Post;
  onClose: () => void;
  /** Called after the post was re-shared to the user's timeline or sent to another app. */
  onShared: (sharesCount: number) => void;
}

export function postPermalink(postId: string): string {
  return `${window.location.origin}/?post=${encodeURIComponent(postId)}`;
}

const Badge: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span className="w-12 h-12 rounded-full flex items-center justify-center text-white text-base font-extrabold" style={{ backgroundColor: color }}>
    {children}
  </span>
);

export const SharePostModal: React.FC<SharePostModalProps> = ({ post, onClose, onShared }) => {
  const { user } = useAuth();
  const [comment, setComment] = useState('');
  const [privacy, setPrivacy] = useState<'public' | 'friends' | 'only_me'>('public');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState(false);

  const isPublic = post.privacy === 'public';
  const canReshare = isPublic || post.authorId === user?.id;
  const url = postPermalink(post.id);
  const authorName = post.author?.name || 'Echat user';
  const text = `${authorName} on Echat: ${(post.content || '').slice(0, 120)}`.trim();
  const e = encodeURIComponent;

  const targets: { name: string; color: string; glyph: React.ReactNode; href: string }[] = [
    { name: 'WhatsApp', color: '#25D366', glyph: 'W', href: `https://wa.me/?text=${e(`${text} ${url}`)}` },
    { name: 'Facebook', color: '#1877F2', glyph: 'f', href: `https://www.facebook.com/sharer/sharer.php?u=${e(url)}` },
    { name: 'X', color: '#111827', glyph: 'X', href: `https://twitter.com/intent/tweet?text=${e(text)}&url=${e(url)}` },
    { name: 'Telegram', color: '#229ED9', glyph: <Send size={20} />, href: `https://t.me/share/url?url=${e(url)}&text=${e(text)}` },
    { name: 'LinkedIn', color: '#0A66C2', glyph: 'in', href: `https://www.linkedin.com/sharing/share-offsite/?url=${e(url)}` },
    { name: 'Email', color: '#64748B', glyph: <Mail size={20} />, href: `mailto:?subject=${e(`${authorName} shared a post on Echat`)}&body=${e(`${text}\n\n${url}`)}` }
  ];

  const countExternalShare = () => {
    api.sharePost(post.id).then(r => {
      const n = (r as { sharesCount?: number })?.sharesCount;
      if (typeof n === 'number') onShared(n);
    }).catch(() => {});
  };

  const openTarget = (href: string) => {
    window.open(href, '_blank', 'noopener,noreferrer');
    countExternalShare();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('Copy this link:', url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title: 'Echat', text, url });
      countExternalShare();
    } catch { /* user closed the share sheet */ }
  };

  const shareToTimeline = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api.sharePost(post.id, { toTimeline: true, comment, privacy });
      onShared(result.sharesCount ?? (post.sharesCount || 0) + 1);
      setDone(true);
      setTimeout(onClose, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not share this post.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-end sm:items-center justify-center p-3" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl max-h-[92vh] overflow-y-auto" onClick={ev => ev.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-base font-extrabold text-slate-900">Share post</h3>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-full" aria-label="Close"><X size={18} /></button>
        </div>

        {/* 1. Re-share on your own timeline */}
        <div className="p-5 border-b border-slate-100">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Share to your timeline</p>
          {canReshare ? (
            <>
              <div className="flex items-start gap-2.5">
                <img src={user?.avatar || initialsAvatar(user?.name || '')} alt="" className="w-9 h-9 rounded-full object-cover" />
                <textarea
                  value={comment}
                  onChange={ev => setComment(ev.target.value)}
                  rows={2}
                  placeholder="Say something about this..."
                  className="flex-1 p-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="mt-2.5 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600 line-clamp-3">
                <span className="font-bold text-slate-800">{authorName}: </span>
                {post.content || (post.mediaUrl ? '[photo/video]' : '')}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <select
                  value={privacy}
                  onChange={ev => setPrivacy(ev.target.value as 'public' | 'friends' | 'only_me')}
                  className="text-xs font-bold bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-2"
                >
                  <option value="public">Public</option>
                  <option value="friends">Friends</option>
                  <option value="only_me">Only me</option>
                </select>
                <button
                  onClick={shareToTimeline}
                  disabled={busy || done}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold inline-flex items-center gap-1.5"
                >
                  {done ? <><Check size={15} /> Shared</> : busy ? 'Sharing...' : <><Share2 size={15} /> Share now</>}
                </button>
              </div>
              {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
            </>
          ) : (
            <p className="text-sm text-slate-500">Only public posts can be shared. This post is limited to its audience.</p>
          )}
        </div>

        {/* 2. Send to other apps */}
        <div className="p-5">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Share to other apps</p>
          {isPublic ? (
            <div className="grid grid-cols-4 gap-y-4 gap-x-2 text-center">
              {targets.map(t => (
                <button key={t.name} onClick={() => openTarget(t.href)} className="flex flex-col items-center gap-1.5">
                  <Badge color={t.color}>{t.glyph}</Badge>
                  <span className="text-[11px] font-semibold text-slate-600">{t.name}</span>
                </button>
              ))}
              <button onClick={copyLink} className="flex flex-col items-center gap-1.5">
                <Badge color={copied ? '#16A34A' : '#475569'}>{copied ? <Check size={20} /> : <Copy size={20} />}</Badge>
                <span className="text-[11px] font-semibold text-slate-600">{copied ? 'Copied' : 'Copy link'}</span>
              </button>
              {typeof navigator !== 'undefined' && 'share' in navigator && (
                <button onClick={nativeShare} className="flex flex-col items-center gap-1.5">
                  <Badge color="#7C3AED"><Share2 size={20} /></Badge>
                  <span className="text-[11px] font-semibold text-slate-600">More...</span>
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-slate-500">This post is not public, so it can't be sent to other apps.</p>
              <button onClick={copyLink} className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold whitespace-nowrap">
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
