import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, ImagePlus, Loader2, X } from 'lucide-react';
import { assetUrl } from '../../services/apiBase';
import {
  CONDITIONS, LOCATIONS, MAX_PHOTOS, SELL_CATEGORIES, categoryOf, formatPrice, marketErrorMessage, publishListing, saveListingEdits, uploadListingPhotos, validateListing, type Listing
} from '../../services/market';

/** A photo is either already uploaded (url) or a new local file waiting to upload. */
type Photo = { key: string; url?: string; file?: File; preview: string };

interface Props {
  /** Present when editing an existing listing. */
  listing?: Listing | null;
  seller: { id: string; name: string; avatar: string; verified: boolean; whatsappEnabled: boolean; whatsappDisplay: boolean; location?: string };
  onDone: (listingId: string) => void;
  onCancel: () => void;
}

const fieldClass = 'min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-[15px] text-slate-900 outline-none transition focus:border-[#1877F2] focus:ring-2 focus:ring-[#1877F2]/15';
const labelClass = 'mb-1 block text-sm font-bold text-slate-800';

export const ListingForm: React.FC<Props> = ({ listing, seller, onDone, onCancel }) => {
  const editing = Boolean(listing);
  const [photos, setPhotos] = useState<Photo[]>(() => (listing?.photos || []).map((url, index) => ({ key: `old-${index}`, url, preview: assetUrl(url) })));
  const [title, setTitle] = useState(listing?.title || '');
  const [price, setPrice] = useState(listing ? String(listing.price) : '');
  const [category, setCategory] = useState(listing ? categoryOf(listing) : 'Phones');
  const [condition, setCondition] = useState(listing?.condition || 'Used - Good');
  const [location, setLocation] = useState(listing?.location || (seller.location || '').split(',')[0] || 'Freetown');
  const [description, setDescription] = useState(listing?.description || '');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ percent: number; label: string } | null>(null);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => { photos.forEach(photo => { if (photo.file) URL.revokeObjectURL(photo.preview); }); abort.current?.abort(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = (list: FileList | null) => {
    setError('');
    const chosen = Array.from(list || []);
    const images = chosen.filter(file => /^image\/(jpeg|png|webp|heic|heif|gif)$/i.test(file.type) || /\.(jpe?g|png|webp|heic)$/i.test(file.name));
    const tooBig = images.filter(file => file.size > 15 * 1024 * 1024);
    const room = MAX_PHOTOS - photos.length;
    const accepted = images.filter(file => file.size <= 15 * 1024 * 1024).slice(0, Math.max(0, room));
    if (images.length < chosen.length) setError('Only photos (JPG, PNG, WEBP) can be added.');
    else if (tooBig.length) setError('Each photo must be 15 MB or less.');
    else if (images.length > room) setError(`You can add up to ${MAX_PHOTOS} photos.`);
    setPhotos(current => [...current, ...accepted.map((file, index) => ({ key: `new-${Date.now()}-${index}`, file, preview: URL.createObjectURL(file) }))]);
  };

  const move = (index: number, direction: -1 | 1) => setPhotos(current => {
    const target = index + direction;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const remove = (index: number) => setPhotos(current => {
    const photo = current[index];
    if (photo?.file) URL.revokeObjectURL(photo.preview);
    return current.filter((_, i) => i !== index);
  });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const numericPrice = category === 'Free Stuff' ? 0 : Number(price.replace(/[,\s]/g, ''));
    const draft = { title, price: numericPrice, category, condition, description, location, photos: photos.map(photo => photo.url || 'pending') };
    const problem = validateListing(draft);
    if (problem) { setError(problem); return; }
    setBusy(true);
    abort.current = new AbortController();
    try {
      const fresh = photos.filter(photo => photo.file);
      const uploaded = fresh.length ? await uploadListingPhotos(fresh.map(photo => photo.file!), (percent, label) => setProgress({ percent, label }), abort.current.signal) : [];
      let next = 0;
      const urls = photos.map(photo => photo.url || uploaded[next++]);
      setProgress({ percent: 100, label: editing ? 'Saving changes…' : 'Publishing…' });
      const input = { ...draft, photos: urls };
      if (editing && listing) { await saveListingEdits(listing.id, input); onDone(listing.id); }
      else { const created = await publishListing(input, seller); onDone(created.id); }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') setError('Upload cancelled.');
      else setError(marketErrorMessage(err));
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-4 pb-[calc(96px+env(safe-area-inset-bottom))] lg:pb-8">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel} aria-label="Back" className="grid h-10 w-10 place-items-center rounded-full bg-white shadow-sm hover:bg-slate-50"><ArrowLeft size={20} /></button>
        <h1 className="text-xl font-extrabold text-slate-900">{editing ? 'Edit listing' : 'Sell an item'}</h1>
      </div>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-extrabold text-slate-900">Photos</h2>
          <span className="text-xs font-semibold text-slate-500">{photos.length}/{MAX_PHOTOS} · first photo is the cover</span>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {photos.map((photo, index) => (
            <div key={photo.key} className="relative aspect-square overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200">
              <img src={photo.preview} alt={`Photo ${index + 1}`} className="h-full w-full object-cover" />
              {index === 0 && <span className="absolute bottom-1 left-1 rounded bg-[#1877F2] px-1.5 py-0.5 text-[10px] font-bold text-white">Cover</span>}
              <button type="button" onClick={() => remove(index)} disabled={busy} aria-label={`Remove photo ${index + 1}`} className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/65 text-white"><X size={15} /></button>
              <div className="absolute bottom-1 right-1 flex gap-1">
                {index > 0 && <button type="button" onClick={() => move(index, -1)} disabled={busy} aria-label="Move photo earlier" className="grid h-7 w-7 place-items-center rounded-full bg-black/65 text-white"><ChevronLeft size={15} /></button>}
                {index < photos.length - 1 && <button type="button" onClick={() => move(index, 1)} disabled={busy} aria-label="Move photo later" className="grid h-7 w-7 place-items-center rounded-full bg-black/65 text-white"><ChevronRight size={15} /></button>}
              </div>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 text-slate-600 hover:border-[#1877F2] hover:text-[#1877F2]">
              <ImagePlus size={26} /><span className="text-xs font-bold">Add photos</span>
            </button>
          )}
        </div>
        <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
      </section>

      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
        <label className="block"><span className={labelClass}>Title *</span>
          <input required maxLength={100} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. iPhone 12, 128GB, clean" className={fieldClass} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className={labelClass}>Category *</span>
            <select value={category} onChange={event => setCategory(event.target.value)} className={fieldClass}>{SELL_CATEGORIES.map(item => <option key={item}>{item}</option>)}</select>
          </label>
          <label className="block"><span className={labelClass}>Price (Le) *</span>
            <input inputMode="numeric" value={category === 'Free Stuff' ? '0' : price} disabled={category === 'Free Stuff'} onChange={event => setPrice(event.target.value.replace(/[^\d,]/g, ''))} placeholder="0 = Free" className={`${fieldClass} disabled:bg-slate-100`} />
            <span className="mt-1 block text-xs text-slate-500">{formatPrice(category === 'Free Stuff' ? 0 : Number(price.replace(/,/g, '')) || 0)}</span>
          </label>
          <label className="block"><span className={labelClass}>Condition</span>
            <select value={condition} onChange={event => setCondition(event.target.value)} className={fieldClass}>{CONDITIONS.map(item => <option key={item}>{item}</option>)}</select>
          </label>
          <label className="block"><span className={labelClass}>Location *</span>
            <input list="market-locations" required maxLength={80} value={location} onChange={event => setLocation(event.target.value)} placeholder="Freetown" className={fieldClass} />
            <datalist id="market-locations">{LOCATIONS.map(place => <option key={place} value={place} />)}</datalist>
          </label>
        </div>
        <label className="block"><span className={labelClass}>Description</span>
          <textarea maxLength={3000} rows={5} value={description} onChange={event => setDescription(event.target.value)} placeholder="Describe the item: brand, size, any faults, how to collect…" className={`${fieldClass} py-3`} />
        </label>
      </section>

      {progress && (
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70" role="status" aria-live="polite">
          <div className="flex items-center justify-between text-sm font-bold text-slate-800"><span>{progress.label}</span><span>{progress.percent}%</span></div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-[#1877F2] transition-[width]" style={{ width: `${progress.percent}%` }} /></div>
          {busy && progress.percent < 100 && <button type="button" onClick={() => abort.current?.abort()} className="mt-2 text-xs font-bold text-rose-600">Cancel upload</button>}
        </div>
      )}
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p>}

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="min-h-12 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700">Cancel</button>
        <button type="submit" disabled={busy} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#1877F2] text-sm font-extrabold text-white hover:bg-[#166FE5] disabled:opacity-60">
          {busy && <Loader2 size={17} className="animate-spin" />}{editing ? 'Save changes' : 'Publish'}
        </button>
      </div>
    </form>
  );
};
