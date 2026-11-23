import React, { useEffect, useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { assetUrl } from '../services/apiBase';
import { compressImage } from '../utils/image';
import type { User } from '../types';

/** Shared bits for Jobs + Events: photo picker with preview, image/letter thumbnail, permission check. */

export const LISTING_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_LISTING_IMAGE_BYTES = 5 * 1024 * 1024;

/** Mirrors the server's isAdminUser() so Edit/Delete only show when the server will allow them. */
export function canManageListing(user: User | null | undefined, ownerId: string): boolean {
  if (!user) return false;
  const isAdmin = ['admin', 'super_admin', 'developer'].includes(user.role) || user.isAdmin === true;
  return isAdmin || user.id === ownerId;
}

const LETTER_COLORS = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-red-500', 'bg-teal-500', 'bg-rose-500', 'bg-indigo-500'];
function letterColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return LETTER_COLORS[hash % LETTER_COLORS.length];
}

/** Uploaded photo if there is one, otherwise the colored letter logo. */
export const ListingImage: React.FC<{ src?: string; name: string; className?: string; letterClassName?: string }> = ({ src, name, className = 'w-12 h-12 rounded-xl', letterClassName = 'text-xl' }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (src && !failed) {
    return <img src={assetUrl(src)} alt={name} loading="lazy" onError={() => setFailed(true)} className={`${className} object-cover shrink-0 bg-slate-100`} />;
  }
  return (
    <div className={`${className} ${letterColor(name || '?')} text-white flex items-center justify-center font-bold shrink-0 ${letterClassName}`}>
      {(name.trim().charAt(0) || '?').toUpperCase()}
    </div>
  );
};

export interface PhotoSelection {
  /** Newly chosen file (sent on save), or null. */
  file: File | null;
  /** True when the user removed the existing photo. */
  removed: boolean;
}

interface ListingPhotoPickerProps {
  /** Photo already saved on the listing (edit mode). */
  currentImage?: string;
  value: PhotoSelection;
  onChange: (value: PhotoSelection) => void;
  disabled?: boolean;
}

/** "Choose Photo" button that opens the phone gallery / file picker and previews before posting. */
export const ListingPhotoPicker: React.FC<ListingPhotoPickerProps> = ({ currentImage, value, onChange, disabled }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    if (!value.file) { setPreviewUrl(''); return; }
    const url = URL.createObjectURL(value.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value.file]);

  const shown = previewUrl || (!value.removed && currentImage ? assetUrl(currentImage) : '');

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    setError('');
    setBusy(true);
    try {
      // Shrinks big phone photos (and converts e.g. HEIC to JPG where the browser can decode it).
      const file = await compressImage(picked);
      if (!LISTING_IMAGE_TYPES.includes(file.type)) {
        setError('Please choose a JPG, PNG or WEBP photo.');
        return;
      }
      if (file.size > MAX_LISTING_IMAGE_BYTES) {
        setError('Photo is too large. Please choose one under 5 MB.');
        return;
      }
      onChange({ file, removed: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Photo (optional)</label>
      {shown ? (
        <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
          <img src={shown} alt="Selected photo preview" className="w-full h-40 object-cover" />
          <div className="absolute bottom-2 right-2 flex gap-2">
            <button type="button" disabled={disabled || busy} onClick={() => inputRef.current?.click()} className="px-3 py-1.5 rounded-full bg-white/95 text-slate-800 text-xs font-bold shadow flex items-center gap-1 cursor-pointer">
              <Camera size={14} /> Change
            </button>
            <button type="button" disabled={disabled || busy} onClick={() => onChange({ file: null, removed: true })} className="px-3 py-1.5 rounded-full bg-white/95 text-red-600 text-xs font-bold shadow flex items-center gap-1 cursor-pointer">
              <Trash2 size={14} /> Remove
            </button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={disabled || busy} onClick={() => inputRef.current?.click()} className="w-full border-2 border-dashed border-slate-300 rounded-xl py-6 flex flex-col items-center justify-center gap-1 text-slate-500 hover:bg-slate-50 cursor-pointer disabled:opacity-50">
          <Camera size={24} />
          <span className="text-sm font-bold">{busy ? 'Preparing photo...' : 'Choose Photo'}</span>
          <span className="text-[11px]">JPG, PNG or WEBP · max 5 MB</span>
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/*" className="hidden" onChange={handleFile} />
      {error && <p role="alert" className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
};

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

/** Turns contact text into a tappable link when it is clearly an email or phone number. */
export const ContactLink: React.FC<{ value: string }> = ({ value }) => {
  const v = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return <a href={`mailto:${v}`} className="text-blue-600 font-semibold break-all">{v}</a>;
  if (/^\+?[\d\s()-]{6,20}$/.test(v)) return <a href={`tel:${v.replace(/[^\d+]/g, '')}`} className="text-blue-600 font-semibold">{v}</a>;
  return <span className="break-words whitespace-pre-wrap">{v}</span>;
};
