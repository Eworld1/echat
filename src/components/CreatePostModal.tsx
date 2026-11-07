import { usePreferences } from '../context/PreferencesContext';
import { compressImage } from '../utils/image';
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { X, Image, Smile, Globe, Users, Lock, Sparkles, UserPlus } from 'lucide-react';
import { TagFriendsPicker } from './TagFriendsPicker';
import type { User } from '../types';
import confetti from 'canvas-confetti';

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPostCreated: () => void;
}

const FEELINGS = [
  'feeling happy 😊',
  'feeling blessed 🙏',
  'feeling excited 🔥',
  'feeling motivated 💪',
  'feeling festive 🥳',
  'feeling relaxed 🌿',
  'celebrating 🎉'
];

export const CreatePostModal: React.FC<CreatePostModalProps> = ({
  isOpen,
  onClose,
  onPostCreated
}) => {
  const { user } = useAuth();
  const { t } = usePreferences();
  const [content, setContent] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [taggedFriends, setTaggedFriends] = useState<User[]>([]);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [error, setError] = useState('');
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [feeling, setFeeling] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<'public' | 'friends' | 'only_me'>(
    user?.privacySettings?.postVisibility === 'friends' || user?.privacySettings?.postVisibility === 'only_me'
      ? user.privacySettings.postVisibility
      : 'public'
  );
  const [showFeelingsList, setShowFeelingsList] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    setError('');

    const isVid = picked.type.startsWith('video');
    if (isVid && picked.size > 15 * 1024 * 1024) {
      setError('Video is too large. Maximum size is 15 MB.');
      return;
    }
    const file = isVid ? picked : await compressImage(picked);
    setMediaType(isVid ? 'video' : 'image');
    setMediaFile(file);
    if (mediaUrl.startsWith('blob:')) URL.revokeObjectURL(mediaUrl);
    setMediaUrl(URL.createObjectURL(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() && !mediaFile) return;

    setIsSubmitting(true);
    setError('');
    try {
      const uploadedUrl = mediaFile ? await api.uploadFile(mediaFile) : undefined;
      await api.createPost({
        content: content.trim(),
        mediaUrl: uploadedUrl,
        mediaType: uploadedUrl ? mediaType : undefined,
        feeling: feeling || undefined,
        privacy,
        taggedUserIds: taggedFriends.map(f => f.id)
      });

      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.8 }
      });

      setContent('');
      if (mediaUrl.startsWith('blob:')) URL.revokeObjectURL(mediaUrl);
      setMediaUrl('');
      setMediaFile(null);
      setTaggedFriends([]);
      setShowTagPicker(false);
      setFeeling(null);
      onPostCreated();
      onClose();
    } catch (err) {
      console.error('Failed to create post:', err);
      setError(err instanceof Error ? err.message : 'Could not publish your post. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
      <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="relative px-6 py-4 border-b border-slate-100 flex items-center justify-center">
          <h3 className="text-base font-bold text-slate-900">{t('create_post')}</h3>
          <button
            onClick={onClose}
            className="absolute right-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* User header */}
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={user?.avatar}
              alt={user?.name}
              className="w-11 h-11 rounded-full object-cover border border-slate-200 shadow-xs"
            />
            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-sm font-bold text-slate-900">{user?.name}</p>
                {feeling && (
                  <span className="text-xs text-slate-500 font-medium">{feeling}</span>
                )}
              </div>
              
              {/* Privacy selector */}
              <button
                type="button"
                onClick={() => setPrivacy(p => (p === 'public' ? 'friends' : p === 'friends' ? 'only_me' : 'public'))}
                className="mt-0.5 inline-flex items-center gap-1 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded-md text-[11px] font-semibold text-slate-700 transition"
              >
                {privacy === 'public' ? <Globe size={11} /> : privacy === 'friends' ? <Users size={11} /> : <Lock size={11} />}
                <span>{privacy === 'public' ? 'Public' : privacy === 'friends' ? 'Friends' : 'Only me'}</span>
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowFeelingsList(!showFeelingsList)}
            className="p-2 text-amber-500 hover:bg-amber-50 rounded-full transition"
            title="Add feeling or activity"
          >
            <Smile size={20} />
          </button>
        </div>

        {/* Feelings dropdown */}
        {showFeelingsList && (
          <div className="px-4 pb-2 flex items-center gap-1.5 flex-wrap border-b border-slate-100">
            {FEELINGS.map(f => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setFeeling(feeling === f ? null : f);
                  setShowFeelingsList(false);
                }}
                className={`text-xs px-2.5 py-1 rounded-full transition ${
                  feeling === f ? 'bg-amber-500 text-white font-bold' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        )}

        {/* Text input */}
        <div className="p-4 flex-1 overflow-y-auto">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('composer_mind', { name: user?.name?.split(' ')[0] || '' })}
            rows={4}
            className="w-full text-base sm:text-lg text-slate-800 placeholder-slate-400 focus:outline-hidden resize-none bg-transparent"
          />

          {/* Media preview */}
          {error && (
            <p className="mx-4 mb-2 text-sm font-semibold text-red-600">{error}</p>
          )}

          {mediaUrl && (
            <div className="relative mt-3 rounded-2xl overflow-hidden border border-slate-200 bg-slate-50">
              {mediaType === 'image' ? (
                <img src={mediaUrl} alt="media preview" className="w-full max-h-72 object-cover" />
              ) : (
                <video src={mediaUrl} controls className="w-full max-h-72 object-cover" />
              )}
              <button
                onClick={() => setMediaUrl('')}
                className="absolute top-3 right-3 p-1.5 bg-black/60 hover:bg-black/80 text-white rounded-full transition"
              >
                <X size={16} />
              </button>
            </div>
          )}
        </div>

        {/* Tagged friends */}
        {taggedFriends.length > 0 && !showTagPicker && (
          <p className="px-5 pb-2 text-xs text-slate-500">
            — with <span className="font-bold text-slate-700">{taggedFriends.map(f => f.name).join(', ')}</span>
          </p>
        )}
        {showTagPicker && (
          <TagFriendsPicker selected={taggedFriends} onChange={setTaggedFriends} onClose={() => setShowTagPicker(false)} />
        )}

        {/* Media & Attachments Bar */}
        <div className="p-4 border-t border-slate-100 bg-white">
          <div className="p-3 border border-slate-200 rounded-2xl flex items-center justify-between mb-4">
            <span className="text-xs font-bold text-slate-700">{t('add_to_post')}</span>
            <div className="flex items-center gap-1">
              <label className="p-2 text-emerald-500 hover:bg-emerald-50 rounded-full cursor-pointer transition" title="Photo/Video">
                <Image size={20} />
                <input
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={handleMediaUpload}
                />
              </label>

              <button
                type="button"
                onClick={() => setShowTagPicker(v => !v)}
                className={`p-2 rounded-full transition ${taggedFriends.length ? 'bg-blue-100 text-blue-600' : 'text-blue-500 hover:bg-blue-50'}`}
                title="Tag friends"
              >
                <UserPlus size={20} />
              </button>

              <button
                type="button"
                onClick={() => setShowFeelingsList(!showFeelingsList)}
                className="p-2 text-amber-500 hover:bg-amber-50 rounded-full transition"
                title="Feelings"
              >
                <Smile size={20} />
              </button>

              <button
                type="button"
                onClick={() => {
                  setContent(prev => prev ? prev + ' #Echat' : 'Excited to be connecting with everyone on Echat! 🚀 #Echat');
                }}
                className="p-2 text-blue-500 hover:bg-blue-50 rounded-full transition"
                title="Tag topic"
              >
                <Sparkles size={18} />
              </button>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={isSubmitting || (!content.trim() && !mediaFile)}
            className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 text-white disabled:text-slate-400 font-bold text-sm shadow-sm transition cursor-pointer"
          >
            {isSubmitting ? t('posting') : t('post')}
          </button>
        </div>
      </div>
    </div>
  );
};
