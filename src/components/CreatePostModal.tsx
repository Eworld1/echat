import { usePreferences } from '../context/PreferencesContext';
import { UserAvatar } from './UserAvatar';
import { compressImage } from '../utils/image';
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { X, Image, Smile, Globe, Users, Lock, Sparkles, UserPlus } from 'lucide-react';
import { TagFriendsPicker } from './TagFriendsPicker';
import { parseVideoLink } from '../utils/embedVideo';
import { LinkPreviewCard } from './LinkPreviewCard';
import type { Post, User } from '../types';
import confetti from 'canvas-confetti';
import { makeVideoThumbnail, compressVideoInBrowser } from '../utils/video';
import { useBackButton } from '../hooks/useBackButton';
import { PostPhotoGrid } from './PostPhotoGrid';

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPostCreated: (post?: Post) => void;
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
  const [uploadedReelUrl, setUploadedReelUrl] = useState('');
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
  const [uploadStage, setUploadStage] = useState<'uploading' | 'compressing' | 'publishing'>('uploading');
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
  const draggedMediaIndex = useRef<number | null>(null);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);
  const cancelUpload = () => uploadAbortControllerRef.current?.abort();
  const postDisabled = isSubmitting || uploadError || (videoOnly
    ? !mediaFile || mediaType !== 'video' || mediaDuration <= 0 || mediaDuration > 90
    : !content.trim() && !mediaFile);
  useBackButton(isOpen, () => {
    if (videoOnly && isSubmitting) cancelUpload();
    else onClose();
  }, `create-post-${videoOnly ? 'reel' : 'post'}`);

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
  useEffect(() => () => {
    uploadAbortControllerRef.current?.abort();
    previewUrlsRef.current.forEach(URL.revokeObjectURL);
  }, []);
  useEffect(() => {
    if (isOpen) return;
    previewUrlsRef.current.forEach(URL.revokeObjectURL);
    previewUrlsRef.current = [];
    setMediaUrl('');
    setMediaFile(null);
    setUploadedReelUrl('');
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
    const existingFiles = [mediaFile, ...additionalMediaFiles].filter((file): file is File => Boolean(file));
    const appendImages = !videoOnly && !hasVideo && mediaType === 'image' && existingFiles.length > 0;
    if ((appendImages ? existingFiles.length : 0) + pickedFiles.length > 12) {
      setError('You can add up to 12 images to a post.');
      return;
    }
    if (hasVideo && pickedFiles.length > 1) {
      setError('Choose one video or up to 12 images in a post.');
      return;
    }
    const maxVideoSize = 30 * 1024 * 1024;
    if (pickedFiles.some(file => isVideo(file) && file.size > maxVideoSize)) {
      setError('Video must be 30MB or less');
      return;
    }
    if (videoOnly && pickedFiles.some(file => {
      const type = file.type.toLowerCase();
      const extensionAllowed = /\.(mp4|mov|webm)$/i.test(file.name);
      return !['video/mp4', 'video/webm', 'video/quicktime', 'video/x-quicktime', 'video/mov'].includes(type) && !(extensionAllowed && (!type || type === 'application/octet-stream'));
    })) {
      setError('Video format not supported - use MP4 / MOV / WebM.');
      return;
    }
    const newFiles = await Promise.all(pickedFiles.map(file => isVideo(file) ? file : compressImage(file)));
    if (newFiles.some(file => !isVideo(file) && file.size > 10 * 1024 * 1024)) {
      setError('A photo is still larger than 10 MB after compression. Choose a smaller photo.');
      return;
    }
    const files = appendImages ? [...existingFiles, ...newFiles] : newFiles;
    if (!appendImages) [mediaUrl, ...additionalMediaUrls].forEach(revokePreviewUrl);
    revokePreviewUrl(thumbnailPreviewUrl);
    setThumbnailPreviewUrl('');
    const urls = appendImages ? [...[mediaUrl, ...additionalMediaUrls], ...newFiles.map(createPreviewUrl)] : files.map(createPreviewUrl);
    setMediaType(appendImages ? 'image' : hasVideo ? 'video' : 'image');
    setMediaFile(files[0]);
    setMediaUrl(urls[0]);
    setUploadedReelUrl('');
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
      else setError('Could not read video duration. Choose another video.');
      if (metadata.duration > 90) setError('Video too long, please choose under 90s');
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
      setUploadedReelUrl('');
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

  const reorderMedia = (from: number, to: number) => {
    const files = [mediaFile, ...additionalMediaFiles].filter((file): file is File => Boolean(file));
    const urls = [mediaUrl, ...additionalMediaUrls];
    if (from === to || from < 0 || to < 0 || from >= files.length || to >= files.length) return;
    const [file] = files.splice(from, 1);
    const [url] = urls.splice(from, 1);
    files.splice(to, 0, file);
    urls.splice(to, 0, url);
    updateMediaOrder(files, urls);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (videoOnly && (!mediaFile || mediaType !== 'video')) {
      setError('Please select a video.');
      return;
    }
    if (videoOnly && mediaDuration > 90) { setError('Video too long, please choose under 90s'); return; }
    if (videoOnly && mediaDuration <= 0) { setError('Could not read video duration. Choose another video.'); return; }
    if (videoOnly && content.trim().length > 2200) { setError('Caption too long. Keep Reel captions under 2,200 characters.'); return; }
    if (!content.trim() && !mediaFile) return;
    if (videoOnly && showCompressionPrompt) { setError('Choose Compress & Upload or Upload Original to continue.'); return; }

    setIsSubmitting(true);
    setError('');
    setUploadError(false);
    setUploadProgress(0);
    setUploadStatus('');
    setUploadStage('uploading');
    const uploadController = videoOnly ? new AbortController() : null;
    uploadAbortControllerRef.current = uploadController;
    let submittedReelUrl = uploadedReelUrl;
    try {
      const files = [mediaFile, ...additionalMediaFiles].filter((file): file is File => Boolean(file));
      let uploadedUrls: string[];
      let reelSize = 0;
      if (videoOnly && mediaFile) {
        if (submittedReelUrl) {
          uploadedUrls = [submittedReelUrl];
          reelSize = mediaFile.size;
          setUploadProgress(100);
          setUploadStatus('Upload complete. Publishing Reel…');
        } else {
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
        }, { signal: uploadController?.signal, maxAttempts: 3, maxBytes: 100 * 1024 * 1024, chunkTimeoutMs: 60_000 });
        submittedReelUrl = result.url;
        setUploadedReelUrl(result.url);
        uploadedUrls = [result.url];
        }
      } else {
        uploadedUrls = await Promise.all(files.map(file => api.uploadFile(file)));
      }
      const uploadedThumbnail = videoOnly && thumbnailFile ? await api.uploadFile(thumbnailFile, uploadController?.signal) : undefined;
      if (videoOnly) setUploadStage('publishing');
      setUploadStatus('Publishing Reel…');
      const createdPost = await api.createPost({
        content: content.trim(),
        mediaUrl: uploadedUrls[0],
        mediaUrls: uploadedUrls,
        images: mediaType === 'image' ? uploadedUrls : undefined,
        imagesCount: mediaType === 'image' ? uploadedUrls.length : undefined,
        mediaType: uploadedUrls.length ? mediaType : undefined,
        type: videoOnly ? 'reel' : 'post',
        thumbnailUrl: uploadedThumbnail,
        mediaDuration: mediaDuration || undefined,
        mediaSize: reelSize || undefined,
        feeling: feeling || undefined,
        privacy: forcePublic ? 'public' : privacy,
        taggedUserIds: taggedFriends.map(f => f.id)
      }, uploadController?.signal);

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
      setUploadedReelUrl('');
      setThumbnailFile(null);
      setThumbnailPreviewUrl('');
      setMediaDuration(0);
      setVideoResolution('');
      setAdditionalMediaUrls([]);
      setAdditionalMediaFiles([]);
      setTaggedFriends([]);
      setShowTagPicker(false);
      setFeeling(null);
      onPostCreated(createdPost);
      if (videoOnly) {
        setSuccessMessage('Reel posted');
        window.setTimeout(() => onClose(), 900);
      } else onClose();
    } catch (err) {
      console.error('Failed to create post:', err);
      const reason = err instanceof Error ? err.message : 'Could not publish your post.';
      if (uploadController?.signal.aborted) {
        setUploadError(false);
        setUploadStatus('');
        setError('Upload cancelled. Your video is still selected.');
        return;
      }
      const compressionFailed = videoOnly && compressLargeVideo && !compressedFile;
      if (compressionFailed) setShowCompressionPrompt(true);
      const uploadFailed = videoOnly && Boolean(mediaFile) && !submittedReelUrl && !compressionFailed;
      setUploadError(uploadFailed);
      if (uploadFailed && mediaFile) setUploadStatus(`Paused at ${formatFileSize(Math.round(mediaFile.size * uploadProgress / 100))} / ${formatFileSize(mediaFile.size)}. Tap Retry Upload to resume.`);
      setError(compressionFailed ? `Could not compress this video: ${reason} Choose Upload Original to continue.` : reason);
    } finally {
      if (uploadAbortControllerRef.current === uploadController) uploadAbortControllerRef.current = null;
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
            onClick={isSubmitting && videoOnly ? cancelUpload : onClose}
            aria-label={isSubmitting && videoOnly ? 'Cancel Reel upload' : 'Close composer'}
            className="absolute right-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* User header */}
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <UserAvatar src={user?.avatar} name={user?.name || 'You'} size={44} className="ring-1 ring-slate-200" />
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
            disabled={isSubmitting}
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

          {mediaUrl && mediaType === 'image' && (
            <div className="mt-3">
              <PostPhotoGrid
                urls={[mediaUrl, ...additionalMediaUrls]}
                altPrefix="Post image"
                onTileDragStart={(index) => { draggedMediaIndex.current = index; }}
                onTileDragOver={(_index, event) => event.preventDefault()}
                onTileDrop={(index, event) => {
                  event.preventDefault();
                  if (draggedMediaIndex.current !== null) reorderMedia(draggedMediaIndex.current, index);
                  draggedMediaIndex.current = null;
                }}
                renderTileControls={index => (
                  <div className="absolute right-1 top-1 z-20 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                    <button type="button" disabled={index === 0} onClick={() => moveMedia(index, -1)} className="rounded-full bg-black/65 p-1.5 text-white disabled:opacity-30" aria-label="Move image earlier">←</button>
                    <button type="button" disabled={index === additionalMediaUrls.length} onClick={() => moveMedia(index, 1)} className="rounded-full bg-black/65 p-1.5 text-white disabled:opacity-30" aria-label="Move image later">→</button>
                    <button type="button" onClick={() => removeMediaAt(index)} disabled={isSubmitting} className="rounded-full bg-black/65 p-1.5 text-white disabled:opacity-50" aria-label="Remove attachment"><X size={14} /></button>
                  </div>
                )}
              />
            </div>
          )}
          {mediaUrl && mediaType === 'video' && (
            <div className="group relative mt-3 overflow-hidden bg-slate-900">
                {videoOnly && !previewReady && !previewUnavailable ? <div className="flex min-h-48 flex-col items-center justify-center gap-2 bg-slate-900 p-5 text-center text-white">
                  {thumbnailPreviewUrl && <img src={thumbnailPreviewUrl} alt="Video thumbnail" className="mb-1 max-h-40 max-w-full rounded-lg object-contain" />}
                  <p className="text-sm font-semibold">Loading video preview…</p>
                  <p className="text-xs text-slate-300">{mediaFile ? `${mediaFile.name} · ${formatFileSize(mediaFile.size)}` : ''}</p>
                </div> : videoOnly && previewUnavailable ? <div className="flex min-h-48 flex-col items-center justify-center gap-2 bg-slate-900 p-5 text-center text-white">
                  {thumbnailPreviewUrl && <img src={thumbnailPreviewUrl} alt="Video thumbnail" className="mb-1 max-h-40 max-w-full rounded-lg object-contain" />}
                  <p className="max-w-full break-all text-sm font-semibold">{mediaFile?.name}</p>
                  <p className="text-xs text-slate-300">{mediaFile ? formatFileSize(mediaFile.size) : ''} · Video preview not available in this browser. The original file can still be uploaded.</p>
                </div> : <video src={mediaUrl} poster={videoOnly ? thumbnailPreviewUrl || undefined : undefined} controls preload="metadata" playsInline muted className="max-h-72 w-full object-contain" onLoadedMetadata={event => {
                  const video = event.currentTarget;
                  if (Number.isFinite(video.duration)) {
                    setMediaDuration(video.duration);
                    if (videoOnly) {
                      if (video.duration > 90) setError('Video too long, please choose under 90s');
                      else setError(current => current === 'Could not read video duration. Choose another video.' ? '' : current);
                    }
                  }
                  if (video.videoWidth && video.videoHeight) setVideoResolution(`${video.videoWidth} × ${video.videoHeight}`);
                  setPreviewUnavailable(false);
                  setPreviewReady(true);
                }} onError={() => { if (videoOnly) setPreviewUnavailable(true); }} />}
                <div className="absolute right-1 top-1 flex gap-1">
                  <button type="button" onClick={() => removeMediaAt(0)} disabled={isSubmitting} className="rounded-full bg-black/65 p-1.5 text-white disabled:opacity-50" aria-label="Remove attachment"><X size={14} /></button>
                </div>
            </div>
          )}
          {videoOnly && mediaFile && <div className="mt-2 px-1 text-xs font-semibold text-slate-500">{formatFileSize(mediaFile.size)} / 30 MB{mediaDuration > 0 && ` · ${Math.floor(mediaDuration / 60)}:${String(Math.floor(mediaDuration % 60)).padStart(2, '0')}`}{videoResolution && ` · ${videoResolution}`}</div>}
          {videoOnly && showCompressionPrompt && mediaFile && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-bold">This video is large ({formatFileSize(mediaFile.size)}). Compress it for faster upload?</p>
            <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => { setCompressLargeVideo(true); setShowCompressionPrompt(false); setError(''); }} className="min-h-10 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-white">Compress &amp; Upload</button><button type="button" onClick={() => { setCompressLargeVideo(false); setShowCompressionPrompt(false); setError(''); }} className="min-h-10 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold">Upload Original</button></div>
          </div>}
          {(isSubmitting || uploadError) && videoOnly && <div className="mt-3 rounded-xl bg-slate-50 p-3" role="status" aria-live="polite"><div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-slate-600"><span>{isSubmitting ? uploadStage === 'compressing' ? `Compressing ${uploadProgress}%` : uploadStage === 'publishing' ? 'Posting Reel…' : `Uploading... ${uploadProgress}%` : uploadStatus || 'Upload paused'}</span></div>{uploadStatus && <p className="mb-1 text-[11px] text-slate-500">{uploadStatus}</p>}<div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-600 transition-[width]" style={{ width: `${uploadProgress}%` }} /></div></div>}
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
              <label className="p-2 text-emerald-500 hover:bg-emerald-50 rounded-full cursor-pointer transition" title={mediaFile && mediaType==='image' ? 'Add more photos' : 'Photo/Video'}>
                <Image size={20} />
                <input
                  type="file"
                  accept={videoOnly ? 'video/*' : 'image/*,video/*'}
                  multiple={!videoOnly}
                  className="hidden"
                  disabled={isSubmitting}
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

          {videoOnly && !mediaFile && <p className="mb-2 text-center text-xs font-medium text-slate-500">Choose a video to create your Reel.</p>}
          <div className="flex gap-2">
            {videoOnly && isSubmitting && <button type="button" onClick={cancelUpload} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700">Cancel</button>}
            <button
              onClick={() => void handleSubmit()}
              disabled={postDisabled}
              className="min-h-11 flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400"
            >
              {isSubmitting ? (videoOnly ? uploadStage === 'publishing' ? 'Posting Reel…' : `${uploadStage === 'compressing' ? 'Compressing' : 'Uploading'} ${uploadProgress}%` : t('posting')) : uploadError ? 'Retry upload first' : t('post')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
