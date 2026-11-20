import React, { useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { api } from '../services/api';
import { compressImage } from '../utils/image';
import { gradientCover, initialsAvatar } from '../utils/avatar';

interface ImagePickerProps {
  label: string;
  value: string;
  onChange: (url: string) => void;
  variant: 'avatar' | 'cover';
  /** Name used to draw the placeholder until a photo is chosen. */
  fallbackName?: string;
  disabled?: boolean;
}

/** Choose a photo from the device gallery/camera, shrink it, upload it, and report the final URL. */
export const ImagePicker: React.FC<ImagePickerProps> = ({ label, value, onChange, variant, fallbackName = '', disabled }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const preview = value || (variant === 'avatar' ? initialsAvatar(fallbackName) : gradientCover(fallbackName));

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    if (!picked.type.startsWith('image/')) {
      setError('Please choose an image (JPG, PNG, WebP or GIF).');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const file = await compressImage(picked, variant === 'avatar' ? 640 : 1600);
      onChange(await api.uploadFile(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">{label}</label>
      <div className={variant === 'avatar' ? 'flex items-center gap-3' : 'space-y-2'}>
        <img
          src={preview}
          alt={label}
          className={
            variant === 'avatar'
              ? 'w-20 h-20 rounded-2xl object-cover border border-slate-200 bg-slate-100'
              : 'w-full h-28 rounded-xl object-cover border border-slate-200 bg-slate-100'
          }
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-bold transition"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
            {busy ? 'Uploading...' : value ? 'Change photo' : 'Choose from gallery'}
          </button>
          {value && !busy && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold transition"
            >
              Remove
            </button>
          )}
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      {error && <p className="mt-1.5 text-xs font-semibold text-red-600">{error}</p>}
    </div>
  );
};
