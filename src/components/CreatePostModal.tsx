import { usePreferences } from '../context/PreferencesContext';
import { compressImage } from '../utils/image';
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { X, Image, Smile, Globe, Users, Lock, Sparkles, UserPlus } from 'lucide-react';
import { TagFriendsPicker } from './TagFriendsPicker';
import { parseVideoLink } from '../utils/embedVideo';
import { LinkPreviewCard } from './LinkPreviewCard';
import type { User } from '../types';
import confetti from 'canvas-confetti';
import { makeVideoThumbnail, compressVideoInBrowser } from '../utils/video';

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPostCreated: () => void;
  forcePublic?: boolean;
  title?: string;
  videoOnly?: boolean;
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

const formatFileSize = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export const CreatePostModal: React.FC<CreatePostModalProps> = ({
  isOpen,
  onClose,
  onPostCreated,
  forcePublic = false,
  title,
  videoOnly = false
}) => {
  const { user } = useAuth();
  const { t } = usePreferences();
  const [content, setContent] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [additionalMediaUrls, setAdditionalMediaUrls] = useState<string[]>([]);
  const [additionalMediaFiles, setAdditionalMediaFiles] = useState<File[]>([]);
  const [taggedFriends, setTaggedFriends] = useState<User[]>([]);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [error, setError] = useState('');
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [feeling, setFeeling] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<'public' | 'friends' | 'only_me'>(
    forcePublic ? 'public' : user?.privacySettings?.postVisibility === 'friends' || user?.privacySettings?.postVisibility === 'only_me'
      ? user.privacySettings.postVisibility
      : 'public'
  );
  const [showFeelingsList, setShowFeelingsList] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadStage, setUploadStage] = useState<'uploading' | 'compressing'>('uploading');
  const [uploadError, setUploadError] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [showCompressionPrompt, setShowCompressionPrompt] = useState(false);
  const [compressLargeVideo, setCompressLargeVideo] = useState(false);
  const [compressedFile, setCompressedFile] = useState<File | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreviewUrl, setThumbnailPreviewUrl] = useState('');
  const [mediaDuration, setMediaDuration] = useState(0);
  const [videoResolution, setVideoResolution] = useState('');
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const previewUrlsRef = useRef<string[]>([]);

  const createPreviewUrl = (file: Blob) => {
    const url = URL.createObjectURL(file);
    previewUrlsRef.current.push(url);
    return url;
  };
  const revokePreviewUrl = (url: string) => {
    if (!url.startsWith('blob:')) return;
    URL.revokeObjectURL(url);
    previewUrlsRef.current = previewUrlsRef.current.filter(item => item !== url);
  };
  useEffect(() => () => previewUrlsRef.current.forEach(URL.revokeObjectURL), []);
  useEffect(() => {
    if (isOpen) return;
    previewUrlsRef.current.forEach(URL.revokeObjectURL);
    previewUrlsRef.current = [];
    setMediaUrl('');
    setMediaFile(null);
    setAdditionalMediaUrls([]);
    setAdditionalMediaFiles([]);
    setThumbnailFile(null);
    setThumbnailPreviewUrl('');
    setMediaDuration(0);
    setVideoResolution('');
    setPreviewReady(false);
    setPreviewUnavailable(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const pickedFiles = Array.from(e.target.files || []);
    e.target.value = '';
    if (pickedFiles.length === 0) return;
    setError('');

    const isVideo = (file: File) => file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(file.name);
    const hasVideo = pickedFiles.some(isVideo);
    if (videoOnly && (pickedFiles.length !== 1 || !hasVideo)) {
      [mediaUrl, ...additionalMediaUrls].forEach(revokePreviewUrl);
      revokePreviewUrl(thumbnailPreviewUrl);
      setMediaFile(null);
      setMediaUrl('');
      setThumbnailFile(null);
      setThumbnailPreviewUrl('');
      setMediaDuration(0);
      setPreviewUnavailable(false);
      setPreviewReady(false);
      setError('Please select a video file - MP4, MOV, or WebM.');
      return;
    }
    if (pickedFiles.length > 10) {
      setError('You can add up to 10 images to a post.');
      return;
    }
    if (hasVideo && pickedFiles.length > 1) {
      setError('Choose one video or up to 10 images in a post.');
      return;
    }
    const maxVideoSize = (videoOnly ? 250 : 15) * 1024 * 1024;
    if (pickedFiles.some(file => isVideo(file) && file.size > maxVideoSize)) {
      setError(videoOnly ? 'Video too large - Max 250MB. Please compress or trim your video.' : 'Video is too large. Maximum size is 15 MB.');
      return;
    }
    if (videoOnly && pickedFiles.some(file => !['video/mp4', 'video/webm', 'video/quicktime', 'video/mov', 'video/x-m4v', ''].includes(file.type) && !/\.(mp4|mov|webm|m4v)$/i.test(file.name))) {
      setError('Video format not supported - use MP4 / MOV.');
      return;
    }
    const files = await Promise.all(pickedFiles.map(file => isVideo(file) ? file : compressImage(file)));
    [mediaUrl, ...additionalMediaUrls].forEach(revokePreviewUrl);
    revokePreviewUrl(thumbnailPreviewUrl);
    setThumbnailPreviewUrl('');
    const urls = files.map(createPreviewUrl);
    setMediaType(hasVideo ? 'video' : 'image');
    setMediaFile(files[0]);
    setMediaUrl(urls[0]);
    setAdditionalMediaFiles(files.slice(1));
    setAdditionalMediaUrls(urls.slice(1));
    setUploadProgress(0);
    setUploadStatus('');
    setUploadError(false);
    setPreviewUnavailable(false);
    setPreviewReady(false);
    setVideoResolution('');
    setMediaDuration(0);
    setCompressedFile(null);
    setCompressLargeVideo(false);
    setShowCompressionPrompt(Boolean(videoOnly && files[0].size > 100 * 1024 * 1024));
    if (videoOnly && hasVideo) {
      const metadata = await makeVideoThumbnail(files[0]).catch(() => ({ file: null, duration: 0 }));
      setThumbnailFile(metadata.file);
      if (metadata.file) setThumbnailPreviewUrl(createPreviewUrl(metadata.file));
      if (metadata.duration > 0) setMediaDuration(metadata.duration);
    } else {
      setThumbnailFile(null);
      setMediaDuration(0);
    }
  };

  const updateMediaOrder = (files: File[], urls: string[]) => {
    setMediaFile(files[0] || null);
    setMediaUrl(urls[0] || '');
    setAdditionalMediaFiles(files.slice(1));
    setAdditionalMediaUrls(urls.slice(1));
    setMediaType(files[0]?.type.startsWith('video') ? 'video' : 'image');
  };

  const removeMediaAt = (index: number) => {
    const files = [mediaFile, ...additionalMediaFiles].filter((file): file is File => Boolean(file));
    const urls = [mediaUrl, ...additionalMediaUrls];
    revokePreviewUrl(urls[index]);
    files.splice(index, 1);
    urls.splice(index, 1);
    updateMediaOrder(files, urls);
    if (!files.length) {
      revokePreviewUrl(thumbnailPreviewUrl);
      setThumbnailPreviewUrl('');
      setThumbnailFile(null); setMediaDuration(0); setVideoResolution(''); setPreviewUnavailable(false); setPreviewReady(false); setShowCompressionPrompt(false); setCompressedFile(null);
    }
  };

  const moveMedia = (index: number, direction: -1 | 1) => {
    const files = [mediaFile, ...additionalMediaFiles].filter((file): file is File => Boolean(file));
    const urls = [mediaUrl, ...additionalMediaUrls];
    const next = index + direction;
    if (next < 0 || next >= files.length) return;
    [files[index], files[next]] = [files[next], files[index]];
    [urls[index], urls[next]] = [urls[next], urls[index]];
    updateMediaOrder(files, urls);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (videoOnly && (!mediaFile || mediaType !== 'video')) {
      setError('Please select a video.');
      return;
    }
    if (videoOnly && content.trim().length > 2200) { setError('Caption too long. Keep Reel captions under 2,200 characters.'); return; }
    if (!content.trim() && !mediaFile) return;
    if (videoOnly && showCompressionPrompt) { setError('Choose Compress & Upload or Upload Original to continue.'); return; }

    setIsSubmitting(true);
    setError('');
    setUploadError(false);
    setUploadProgress(0);
    setUploadStatus('');
    try {
      const files = [mediaFile, ...additionalMediaFiles].filter((file): file is File => Boolean(file));
      let uploadedUrls: string[];
      let reelSize = 0;
      if (videoOnly && mediaFile) {
        let reelFile = compressedFile || mediaFile;
        if (compressLargeVideo && !compressedFile) {
          setUploadStage('compressing');
          reelFile = await compressVideoInBrowser(mediaFile, setUploadProgress);
          setCompressedFile(reelFile);
        }
        setUploadStage('uploading');
        reelSize = mediaFile.size;
        const result = await api.uploadReelFile(reelFile, (progress, status) => {
          setUploadProgress(progress);
          if (status) setUploadStatus(status);
        });
        uploadedUrls = [result.url];
      } else {
        uploadedUrls = await Promise.all(files.map(file => api.uploadFile(file)));
      }
      const uploadedThumbnail = videoOnly && thumbnailFile ? await api.uploadFile(thumbnailFile) : undefined;
      await api.createPost({
        content: content.trim(),
        mediaUrl: uploadedUrls[0],
        mediaUrls: uploadedUrls,
        mediaType: uploadedUrls.length ? mediaType : undefined,
        type: videoOnly ? 'reel' : 'post',
        thumbnailUrl: uploadedThumbnail,
        mediaDuration: mediaDuration || undefined,
        mediaSize: reelSize || undefined,
        feeling: feeling || undefined,
        privacy: forcePublic ? 'public' : privacy,
        taggedUserIds: taggedFriends.map(f => f.id)
      });

      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.8 }
      });

      setContent('');
      [mediaUrl, ...additionalMediaUrls].forEach(revokePreviewUrl);
      revokePreviewUrl(thumbnailPreviewUrl);
      setMediaUrl('');
      setMediaFile(null);
      setThumbnailFile(null);
      setThumbnailPreviewUrl('');
      setMediaDuration(0);
      setVideoResolution('');
      setAdditionalMediaUrls([]);
      setAdditionalMediaFiles([]);
      setTaggedFriends([]);
      setShowTagPicker(false);
      setFeeling(null);
      onPostCreated();
      if (videoOnly) {
        setSuccessMessage('Reel posted');
        window.setTimeout(() => onClose(), 900);
      } else onClose();
    } catch (err) {
      console.error('Failed to create post:', err);
      const reason = err instanceof Error ? err.message : 'Could not publish your post.';
      const compressionFailed = videoOnly && compressLargeVideo && !compressedFile;
      if (compressionFailed) setShowCompressionPrompt(true);
      setUploadError(videoOnly && Boolean(mediaFile) && !compressionFailed);
      if (videoOnly && mediaFile && !compressionFailed) setUploadStatus(`Paused at ${formatFileSize(Math.round(mediaFile.size * uploadProgress / 100))} / ${formatFileSize(mediaFile.size)}. Tap Retry Upload to resume.`);
      setError(compressionFailed ? `Could not compress this video: ${reason} Choose Upload Original to continue.` : videoOnly && mediaFile ? `Reel upload failed: ${reason}` : reason);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in">
      <div className="bg-white rounded-none sm:rounded-3xl w-full max-w-lg shadow-2xl border border-slate-200 overflow-hidden flex flex-col h-[100dvh] sm:h-auto max-h-[100dvh] sm:max-h-[90vh]">
        {/* Header */}
        <div className="relative px-6 py-4 border-b border-slate-100 flex items-center justify-center">
          <h3 className="text-base font-bold text-slate-900">{title || t('create_post')}</h3>
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
              {!forcePublic && <button
                type="button"
                onClick={() => setPrivacy(p => (p === 'public' ? 'friends' : p === 'friends' ? 'only_me' : 'public'))}
                className="mt-0.5 inline-flex items-center gap-1 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded-md text-[11px] font-semibold text-slate-700 transition"
              >
                {privacy === 'public' ? <Globe size={11} /> : privacy === 'friends' ? <Users size={11} /> : <Lock size={11} />}
                <span>{privacy === 'public' ? 'Public' : privacy === 'friends' ? 'Friends' : 'Only me'}</span>
              </button>}
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
            maxLength={videoOnly ? 2200 : undefined}
            onChange={(e) => { setContent(e.target.value); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 360)}px`; }}
            placeholder={t('composer_mind', { name: user?.name?.split(' ')[0] || '' })}
            rows={4}
            className="min-h-[80px] w-full text-[17px] leading-relaxed sm:text-lg text-slate-800 placeholder-slate-400 focus:outline-hidden resize-none bg-transparent"
          />
          {content && <LinkPreviewCard text={content} />}
          {parseVideoLink(content) && <p className="mt-2 rounded-xl bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">Video link detected. Your post will include an in-app player with an external fallback.</p>}

          {/* Media preview */}
          {error && <div role="alert" className="mx-4 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-red-700"><span>{error}</span>{uploadError && <button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting} className="min-h-10 rounded-lg bg-rose-600 px-3 py-1.5 text-white disabled:opacity-50">Retry Upload</button>}</div>}
          {successMessage && <p role="status" className="mx-4 mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">{successMessage}</p>}

          {mediaUrl && (
            <div className={`mt-3 grid gap-2 ${mediaType === 'image' && additionalMediaUrls.length ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {[mediaUrl, ...additionalMediaUrls].map((url, index) => <div key={url} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-slate-900">
                {mediaType === 'video' ? videoOnly && !previewReady && !previewUnavailable ? <div className="flex min-h-48 flex-col items-center justify-center gap-2 bg-slate-900 p-5 text-center text-white">
                  {thumbnailPreviewUrl && <img src={thumbnailPreviewUrl} alt="Video thumbnail" className="mb-1 max-h-40 max-w-full rounded-lg object-contain" />}
                  <p className="text-sm font-semibold">Loading video preview…</p>
                  <p className="text-xs text-slate-300">{mediaFile ? `${mediaFile.name} · ${formatFileSize(mediaFile.size)}` : ''}</p>
                </div> : videoOnly && previewUnavailable ? <div className="flex min-h-48 flex-col items-center justify-center gap-2 bg-slate-900 p-5 text-center text-white">
                  {thumbnailPreviewUrl && <img src={thumbnailPreviewUrl} alt="Video thumbnail" className="mb-1 max-h-40 max-w-full rounded-lg object-contain" />}
                  <p className="max-w-full break-all text-sm font-semibold">{mediaFile?.name}</p>
                  <p className="text-xs text-slate-300">{mediaFile ? formatFileSize(mediaFile.size) : ''} · Video preview not available in this browser. The original file can still be uploaded.</p>
                </div> : <video src={url} poster={videoOnly ? thumbnailPreviewUrl || undefined : undefined} controls preload="metadata" playsInline muted className="max-h-72 w-full object-contain" onLoadedMetadata={event => {
                  const video = event.currentTarget;
                  if (Number.isFinite(video.duration)) setMediaDuration(video.duration);
                  if (video.videoWidth && video.videoHeight) setVideoResolution(`${video.videoWidth} × ${video.videoHeight}`);
                  setPreviewUnavailable(false);
                  setPreviewReady(true);
                }} onError={() => { if (videoOnly) setPreviewUnavailable(true); }} /> : <img src={url} alt={`Post image ${index + 1}`} className="h-40 w-full object-cover" />}
                <div className="absolute right-1 top-1 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                  {mediaType === 'image' && <><button type="button" disabled={index === 0} onClick={() => moveMedia(index, -1)} className="rounded-full bg-black/65 p-1.5 text-white disabled:opacity-30" aria-label="Move image earlier">←</button><button type="button" disabled={index === additionalMediaUrls.length} onClick={() => moveMedia(index, 1)} className="rounded-full bg-black/65 p-1.5 text-white disabled:opacity-30" aria-label="Move image later">→</button></>}
                  <button type="button" onClick={() => removeMediaAt(index)} className="rounded-full bg-black/65 p-1.5 text-white" aria-label="Remove attachment"><X size={14} /></button>
                </div>
              </div>)}
            </div>
          )}
          {videoOnly && mediaFile && <div className="mt-2 px-1 text-xs font-semibold text-slate-500">{formatFileSize(mediaFile.size)} / 250 MB{mediaDuration > 0 && ` · ${Math.floor(mediaDuration / 60)}:${String(Math.floor(mediaDuration % 60)).padStart(2, '0')}`}{videoResolution && ` · ${videoResolution}`}</div>}
          {videoOnly && showCompressionPrompt && mediaFile && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-bold">This video is large ({formatFileSize(mediaFile.size)}). Compress it for faster upload?</p>
            <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => { setCompressLargeVideo(true); setShowCompressionPrompt(false); setError(''); }} className="min-h-10 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-white">Compress &amp; Upload</button><button type="button" onClick={() => { setCompressLargeVideo(false); setShowCompressionPrompt(false); setError(''); }} className="min-h-10 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold">Upload Original</button></div>
          </div>}
          {(isSubmitting || uploadError) && videoOnly && <div className="mt-3 rounded-xl bg-slate-50 p-3" role="status" aria-live="polite"><div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-slate-600"><span>{isSubmitting && uploadStage === 'compressing' ? 'Compressing video…' : uploadStatus || 'Uploading Reel…'}</span><span>{uploadProgress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-600 transition-[width]" style={{ width: `${uploadProgress}%` }} /></div></div>}
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
                  accept={videoOnly ? 'video/mp4,video/webm,video/quicktime,video/mov,video/x-m4v,.mp4,.mov,.webm,.m4v' : 'image/*,video/*'}
                  multiple={!videoOnly}
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
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || uploadError || (!content.trim() && !mediaFile)}
            className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 text-white disabled:text-slate-400 font-bold text-sm shadow-sm transition cursor-pointer"
          >
            {isSubmitting ? (videoOnly ? `${uploadStage === 'compressing' ? 'Compressing' : 'Uploading'} ${uploadProgress}%` : t('posting')) : uploadError ? 'Retry upload first' : t('post')}
          </button>
        </div>
      </div>
    </div>
  );
};
