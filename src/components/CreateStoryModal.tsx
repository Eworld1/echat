import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { X, Type, Image as ImageIcon, Sparkles, Check, Video } from 'lucide-react';

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

export const CreateStoryModal: React.FC<CreateStoryModalProps> = ({
  isOpen,
  onClose,
  onStoryCreated
}) => {
  const [mode, setMode] = useState<'text' | 'image' | 'video'>('text');
  const [text, setText] = useState('');
  const [selectedGradient, setSelectedGradient] = useState(GRADIENTS[0]);
  const [selectedPhoto, setSelectedPhoto] = useState(PRESET_PHOTOS[0]);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => () => { if (selectedPhoto.startsWith('blob:')) URL.revokeObjectURL(selectedPhoto); }, [selectedPhoto]);

  if (!isOpen) return null;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) { setError('Choose a photo or video file.'); return; }
    const isVideo = file.type.startsWith('video/');
    const url = URL.createObjectURL(file);
    setMediaFile(file);
    setSelectedPhoto(url);
    setMode(isVideo ? 'video' : 'image');
    setError('');
    if (isVideo) {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => { setVideoDuration(video.duration || 0); if (video.duration > 30) setError('Story videos must be 30 seconds or shorter.'); };
      video.onerror = () => { setError('Could not read this video. Choose another file.'); };
      video.src = url;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'text' && !text.trim()) return;
    if (mode === 'video' && videoDuration > 30) { setError('Story videos must be 30 seconds or shorter.'); return; }

    setIsSubmitting(true);
    setError('');
    try {
      const mediaUrl = (mode === 'image' || mode === 'video') ? (mediaFile ? await api.uploadFile(mediaFile) : selectedPhoto) : undefined;
      await api.createStory({
        type: mode,
        mediaUrl,
        text: text.trim() || undefined,
        backgroundGradient: mode === 'text' ? selectedGradient : undefined
      });
      onStoryCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to share this story. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in">
      <div className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col md:flex-row border border-slate-200">
        
        {/* Story Live Preview */}
        <div
          className="relative w-full md:w-1/2 h-72 md:h-auto min-h-[380px] p-6 flex flex-col justify-between items-center text-center overflow-hidden"
          style={{
            background: mode === 'text' ? selectedGradient : undefined
          }}
        >
          {mode === 'image' && (
            <img
              src={selectedPhoto}
              alt="preview"
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}
          {mode === 'video' && <video src={selectedPhoto} controls playsInline muted className="absolute inset-0 h-full w-full object-cover" />}

          <div className="relative z-10 w-full flex justify-between items-center text-white/80 text-xs font-semibold">
            <span>24h Status Preview</span>
            <span className="bg-black/30 backdrop-blur-xs px-2.5 py-1 rounded-full text-[10px]">
              Echat Stories
            </span>
          </div>

          <div className="relative z-10 my-auto max-w-xs">
            <p className="text-xl md:text-2xl font-bold text-white leading-relaxed drop-shadow-md">
              {text || (mode === 'text' ? 'Start typing your status...' : 'Add an optional caption...')}
            </p>
          </div>

          <div className="relative z-10 w-full text-center text-white/70 text-[11px]">
            Visible to friends for 24 hours
          </div>
        </div>

        {/* Story Configuration Form */}
        <div className="w-full md:w-1/2 p-6 flex flex-col justify-between bg-white">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Sparkles size={18} className="text-blue-600" />
                Create Story
              </h3>
              <button
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Mode Selector */}
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button
                type="button"
                onClick={() => { setMode('text'); setMediaFile(null); setError(''); }}
                className={`py-2 px-3 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition ${
                  mode === 'text'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <Type size={15} />
                Text Status
              </button>
              <button
                type="button"
                onClick={() => { setMode('image'); setMediaFile(null); setError(''); }}
                className={`py-2 px-3 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition ${
                  mode === 'image'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <ImageIcon size={15} />
                Photo Story
              </button>
            <button type="button" onClick={() => { setMode('video'); setMediaFile(null); setError('Choose a video up to 30 seconds.'); }} className={`py-2 px-3 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition ${mode === 'video' ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}><Video size={15}/>Video Story</button>
            </div>

            {/* Content Input */}
            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {mode === 'text' ? 'What’s on your mind?' : 'Add a caption'}
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                placeholder={mode === 'text' ? 'Type your thought, quote, or update...' : 'Say something about this photo...'}
                maxLength={200}
                className="w-full text-sm p-3 bg-slate-50 border border-slate-200 rounded-2xl focus:bg-white focus:border-blue-500 focus:outline-hidden transition"
              />
              <span className="text-[10px] text-slate-400 float-right mt-1">{text.length}/200</span>
              <div className="mt-2 flex flex-wrap gap-2">{['❤️','😂','🔥','🎉','🙏'].map(emoji => <button type="button" key={emoji} onClick={() => setText(value => `${value}${value ? ' ' : ''}${emoji}`.slice(0, 200))} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100" aria-label={`Add ${emoji} sticker`}>{emoji}</button>)}</div>
            </div>

            {/* Background or Photo selection */}
            {mode === 'text' ? (
              <div className="mt-4">
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  Select Background Gradient
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  {GRADIENTS.map((g, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedGradient(g)}
                      className="w-8 h-8 rounded-full border-2 transition flex items-center justify-center"
                      style={{
                        background: g,
                        borderColor: selectedGradient === g ? '#000' : 'transparent'
                      }}
                    >
                      {selectedGradient === g && <Check size={14} className="text-white" />}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-4">
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  Choose Photo or Upload
                </label>
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {PRESET_PHOTOS.map((p, idx) => (
                    <img
                      key={idx}
                      src={p}
                      alt="preset"
                      onClick={() => { setSelectedPhoto(p); setMediaFile(null); setError(''); }}
                      className={`h-14 w-full object-cover rounded-xl cursor-pointer border-2 transition ${
                        selectedPhoto === p ? 'border-blue-600 scale-95' : 'border-transparent'
                      }`}
                    />
                  ))}
                </div>
                <label className="block w-full py-2 px-3 text-center text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl cursor-pointer transition">
                  Upload Photo or Video (video max 30 seconds)
                  <input
                    type="file"
                    accept="image/*,video/*"
                    className="hidden"
                    onChange={handleImageUpload}
                  />
                </label>
                {mode === 'video' && <p className="mt-2 text-xs text-slate-500">{videoDuration ? `${Math.ceil(videoDuration)}s / 30s` : 'Video length will be checked before sharing.'}</p>}
              </div>
            )}
          </div>

          {error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-700">{error}</p>}
          {/* Action buttons */}
          <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-full transition"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || (mode === 'text' && !text.trim()) || (mode === 'video' && (!mediaFile || !videoDuration || videoDuration > 30))}
              className="px-6 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-full shadow-sm transition"
            >
              {isSubmitting ? 'Sharing...' : 'Share to Story'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
