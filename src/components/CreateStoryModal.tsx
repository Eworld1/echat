import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../services/api';
import { Check, Image as ImageIcon, LoaderCircle, Sparkles, Type, Video, Volume2, VolumeX, X } from 'lucide-react';

interface CreateStoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStoryCreated: () => void;
}

const GRADIENTS = [
  'linear-gradient(135deg, #1877F2 0%, #00C6FF 100%)',
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #243949 0%, #517fa4 100%)'
];

const PRESET_PHOTOS = [
  'https://images.unsplash.com/photo-1513151233558-d860c5398176?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=800&q=80'
];

const formatDuration = (seconds: number) => {
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export const CreateStoryModal: React.FC<CreateStoryModalProps> = ({ isOpen, onClose, onStoryCreated }) => {
  const [mode, setMode] = useState<'text' | 'image' | 'video'>('text');
  const [statusText, setStatusText] = useState('');
  const [caption, setCaption] = useState('');
  const [selectedGradient, setSelectedGradient] = useState(GRADIENTS[0]);
  const [selectedPhoto, setSelectedPhoto] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState('');
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoMuted, setVideoMuted] = useState(true);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const videoPreviewRef = useRef('');

  useEffect(() => {
    if (!selectedPhoto.startsWith('blob:')) return;
    return () => URL.revokeObjectURL(selectedPhoto);
  }, [selectedPhoto]);

  useEffect(() => {
    if (!videoPreview.startsWith('blob:')) return;
    return () => URL.revokeObjectURL(videoPreview);
  }, [videoPreview]);

  const resetForm = () => {
    setMode('text');
    setStatusText('');
    setCaption('');
    setSelectedGradient(GRADIENTS[0]);
    setSelectedPhoto('');
    setPhotoFile(null);
    setVideoFile(null);
    setVideoPreview('');
    videoPreviewRef.current = '';
    setVideoDuration(0);
    setVideoMuted(true);
    setError('');
  };

  const closeModal = () => {
    if (isSubmitting) return;
    resetForm();
    onClose();
  };

  const changeMode = (nextMode: 'text' | 'image' | 'video') => {
    if (isSubmitting) return;
    setMode(nextMode);
    setError('');
    setSelectedPhoto('');
    setPhotoFile(null);
    setVideoFile(null);
    setVideoPreview('');
    videoPreviewRef.current = '';
    setVideoDuration(0);
    setVideoMuted(true);
  };

  const handlePhotoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file for a Photo Story.');
      return;
    }
    setSelectedPhoto(URL.createObjectURL(file));
    setPhotoFile(file);
    setError('');
  };

  const handleVideoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setError('Choose a video file for a Video Story.');
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    videoPreviewRef.current = previewUrl;
    setVideoFile(file);
    setVideoPreview(previewUrl);
    setVideoDuration(0);
    setVideoMuted(true);
    setError('');

    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      if (videoPreviewRef.current !== previewUrl) return;
      const duration = Number.isFinite(probe.duration) ? probe.duration : 0;
      setVideoDuration(duration);
      setError(duration > 30 ? 'Video must be 30 seconds or less' : '');
    };
    probe.onerror = () => {
      if (videoPreviewRef.current === previewUrl) setError('Could not read this video. Choose another file.');
    };
    probe.src = previewUrl;
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (mode === 'text' && !statusText.trim()) return;
    if (mode === 'image' && !selectedPhoto) {
      setError('Select a photo to share.');
      return;
    }
    if (mode === 'video' && (!videoFile || !videoDuration)) {
      setError('Choose a video up to 30 seconds.');
      return;
    }
    if (mode === 'video' && videoDuration > 30) {
      setError('Video must be 30 seconds or less');
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      let mediaUrl: string | undefined;
      if (mode === 'image') {
        mediaUrl = photoFile ? await api.uploadFile(photoFile) : selectedPhoto;
      } else if (mode === 'video' && videoFile) {
        mediaUrl = (await api.uploadReelFile(videoFile, () => undefined)).url;
      }

      await api.createStory({
        type: mode,
        mediaUrl,
        text: (mode === 'text' ? statusText : caption).trim() || undefined,
        backgroundGradient: mode === 'text' ? selectedGradient : undefined
      });

      resetForm();
      onClose();
      onStoryCreated();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to share this story. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const currentText = mode === 'text' ? statusText : caption;
  const canShare = mode === 'text'
    ? Boolean(statusText.trim())
    : mode === 'image'
      ? Boolean(selectedPhoto)
      : Boolean(videoFile && videoDuration > 0 && videoDuration <= 30);
  const helperText = mode === 'text'
    ? !statusText.trim() ? 'Write a status to share.' : ''
    : mode === 'image'
      ? !selectedPhoto ? 'Select a photo to share.' : ''
      : !videoFile
        ? 'Choose a video up to 30 seconds.'
        : !videoDuration
          ? 'Checking video duration…'
          : videoDuration <= 30
            ? `${formatDuration(videoDuration)} / 0:30 maximum`
            : '';

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-4"
      style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))', paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      onMouseDown={event => { if (event.target === event.currentTarget) closeModal(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-story-title"
        className="flex max-h-[calc(100dvh-1rem)] min-h-0 w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-6">
          <h2 id="create-story-title" className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <Sparkles size={19} className="text-blue-600" />
            Create Story
          </h2>
          <button type="button" onClick={closeModal} disabled={isSubmitting} aria-label="Close story modal" className="grid h-10 w-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-50">
            <X size={20}/>
          </button>
        </header>

        <main className="min-h-0 max-h-[80vh] flex-1 overflow-y-auto overscroll-contain">
          <div className="grid min-w-0 gap-5 p-4 sm:p-6 md:grid-cols-2">
            <section className="min-w-0" aria-label="Story preview">
              <div
                className="relative mx-auto flex h-[min(48dvh,520px)] max-h-full w-auto max-w-full aspect-[9/16] items-center justify-center overflow-hidden rounded-2xl bg-slate-950 text-center shadow-inner"
                style={mode === 'text' ? { background: selectedGradient } : undefined}
              >
                {mode === 'image' && selectedPhoto && <img src={selectedPhoto} alt="Photo story preview" className="absolute inset-0 h-full w-full object-contain"/>}
                {mode === 'video' && videoPreview && <video src={videoPreview} controls playsInline muted={videoMuted} className="absolute inset-0 h-full w-full object-contain"/>}
                {mode === 'text'
                  ? <p className="relative z-10 max-h-full overflow-hidden px-6 text-xl font-bold leading-relaxed text-white drop-shadow-md sm:text-2xl">{statusText || 'Start typing your status…'}</p>
                  : mode === 'image' && !selectedPhoto
                    ? <div className="flex flex-col items-center gap-2 px-5 text-white/80"><ImageIcon size={34}/><span className="text-sm">Select a photo to preview your Story</span></div>
                    : mode === 'video' && !videoPreview
                      ? <div className="flex flex-col items-center gap-2 px-5 text-white/80"><Video size={34}/><span className="text-sm">Choose a video up to 30 seconds</span></div>
                      : null}
                <span className="absolute left-3 top-3 z-10 rounded-full bg-black/55 px-3 py-1.5 text-[11px] font-semibold text-white">24h Story Preview</span>
              </div>
              {mode !== 'text' && currentText && <p className="mt-2 whitespace-pre-wrap break-words text-center text-sm text-slate-600">{currentText}</p>}
              {mode === 'video' && videoFile && <div className="mt-3 flex items-center justify-center gap-3 text-xs text-slate-600">
                <button type="button" onClick={() => setVideoMuted(value => !value)} aria-label={videoMuted ? 'Unmute video preview' : 'Mute video preview'} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-slate-100 px-3 font-semibold">
                  {videoMuted ? <VolumeX size={16}/> : <Volume2 size={16}/>}
                  {videoMuted ? 'Muted' : 'Sound on'}
                </button>
                <span>{videoDuration ? `${formatDuration(videoDuration)} video` : 'Reading duration…'}</span>
              </div>}
            </section>

            <section className="min-w-0">
              <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Story type">
                <button type="button" role="tab" aria-selected={mode === 'text'} disabled={isSubmitting} onClick={() => changeMode('text')} className={`flex min-h-10 items-center justify-center gap-1 rounded-xl px-2 text-[11px] font-semibold transition sm:text-xs ${mode === 'text' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}><Type size={15}/>Text</button>
                <button type="button" role="tab" aria-selected={mode === 'image'} disabled={isSubmitting} onClick={() => changeMode('image')} className={`flex min-h-10 items-center justify-center gap-1 rounded-xl px-2 text-[11px] font-semibold transition sm:text-xs ${mode === 'image' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}><ImageIcon size={15}/>Photo</button>
                <button type="button" role="tab" aria-selected={mode === 'video'} disabled={isSubmitting} onClick={() => changeMode('video')} className={`flex min-h-10 items-center justify-center gap-1 rounded-xl px-2 text-[11px] font-semibold transition sm:text-xs ${mode === 'video' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}><Video size={15}/>Video</button>
              </div>

              <div className="mt-4">
                <label htmlFor="story-text" className="mb-1 block text-xs font-semibold text-slate-700">{mode === 'text' ? 'What’s on your mind?' : 'Caption (optional)'}</label>
                <textarea
                  id="story-text"
                  value={currentText}
                  onChange={event => mode === 'text' ? setStatusText(event.target.value) : setCaption(event.target.value)}
                  rows={3}
                  placeholder={mode === 'text' ? 'Type your thought, quote, or update…' : 'Say something about your Story…'}
                  maxLength={200}
                  disabled={isSubmitting}
                  className="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm transition focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60"
                />
                <span className="mt-1 block text-right text-[10px] text-slate-400">{currentText.length}/200</span>
                <div className="mt-2 flex flex-wrap gap-2">{['❤️','😂','🔥','🎉','🙏'].map(emoji => <button type="button" key={emoji} disabled={isSubmitting} onClick={() => mode === 'text' ? setStatusText(value => `${value}${value ? ' ' : ''}${emoji}`.slice(0,200)) : setCaption(value => `${value}${value ? ' ' : ''}${emoji}`.slice(0,200))} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 disabled:opacity-50" aria-label={`Add ${emoji} sticker`}>{emoji}</button>)}</div>
              </div>

              {mode === 'text'
                ? <div className="mt-5">
                    <p className="mb-2 text-xs font-semibold text-slate-700">Select Background Gradient</p>
                    <div className="flex flex-wrap items-center gap-2">{GRADIENTS.map((gradient,index)=><button type="button" key={index} disabled={isSubmitting} onClick={()=>setSelectedGradient(gradient)} aria-label={`Select background ${index+1}`} className="flex h-9 w-9 items-center justify-center rounded-full border-2 transition disabled:opacity-50" style={{background:gradient,borderColor:selectedGradient===gradient?'#0f172a':'transparent'}}>{selectedGradient===gradient&&<Check size={15} className="text-white"/>}</button>)}</div>
                  </div>
                : mode === 'image'
                  ? <div className="mt-5">
                      <p className="mb-2 text-xs font-semibold text-slate-700">Choose a photo</p>
                      <div className="mb-3 grid grid-cols-4 gap-2">{PRESET_PHOTOS.map((photo,index)=><button type="button" key={photo} disabled={isSubmitting} onClick={()=>{setSelectedPhoto(photo);setPhotoFile(null);setError('');}} aria-label={`Choose preset photo ${index+1}`} className={`h-16 overflow-hidden rounded-xl border-2 disabled:opacity-50 ${selectedPhoto===photo?'border-blue-600':'border-transparent'}`}><img src={photo} alt="" className="h-full w-full object-cover"/></button>)}</div>
                      <label className="block cursor-pointer rounded-xl bg-blue-50 px-3 py-2.5 text-center text-xs font-semibold text-blue-700 transition hover:bg-blue-100">Upload Photo<input type="file" accept="image/*" className="hidden" disabled={isSubmitting} onChange={handlePhotoUpload}/></label>
                      {!selectedPhoto && <p className="mt-2 text-xs text-slate-500">Select a photo to share.</p>}
                    </div>
                  : <div className="mt-5">
                      <p className="mb-2 text-xs font-semibold text-slate-700">Choose a video up to 30 seconds</p>
                      <label className="block cursor-pointer rounded-xl bg-blue-50 px-3 py-2.5 text-center text-xs font-semibold text-blue-700 transition hover:bg-blue-100">Choose Video<input type="file" accept="video/*" className="hidden" disabled={isSubmitting} onChange={handleVideoUpload}/></label>
                      {videoFile && <p className="mt-2 truncate text-xs text-slate-600">{videoFile.name}</p>}
                    </div>}
              {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-700">{error}</p>}
            </section>
          </div>
        </main>

        <footer className="sticky bottom-0 z-20 flex shrink-0 flex-col gap-2 border-t border-slate-100 bg-white px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p role="status" className="min-h-4 text-xs text-slate-500">{helperText}</p>
          <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto sm:gap-3">
            <button type="button" onClick={closeModal} disabled={isSubmitting} className="min-h-11 rounded-full px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50">Cancel</button>
            <button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting || !canShare} className="flex min-h-11 min-w-36 items-center justify-center gap-2 rounded-full bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none">
              {isSubmitting && <LoaderCircle size={16} className="animate-spin"/>}
              {isSubmitting ? 'Sharing...' : 'Share to Story'}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
};
