import React, { useEffect, useState } from 'react';
import { ArrowLeft, CalendarPlus, Camera, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { auth } from '../../services/firebase';
import { api } from '../../services/api';
import { compressImage } from '../../utils/image';
import { createEvent } from '../../services/eventTickets';
import { navigateTo } from '../../utils/eventsNav';
import { ApplyMethodField, encodeApply, validateApply, type ApplyMethod } from '../../components/ApplyActions';

type Errors = Partial<Record<'title' | 'date' | 'time' | 'location' | 'description' | 'price' | 'totalTickets' | 'whatsapp' | 'cover', string>>;

const inputClass = (invalid?: string) => `w-full rounded-xl border bg-white px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1877F2]/30 ${invalid ? 'border-rose-400' : 'border-slate-300 focus:border-[#1877F2]'}`;

export const CreateEventPage: React.FC = () => {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [isPaid, setIsPaid] = useState(false);
  const [price, setPrice] = useState('');
  const [totalTickets, setTotalTickets] = useState('100');
  const [contactMethod, setContactMethod] = useState<ApplyMethod>('whatsapp');
  const [whatsapp, setWhatsapp] = useState('');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!coverFile) { setCoverPreview(''); return; }
    const url = URL.createObjectURL(coverFile);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  if (!user || !auth.currentUser) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-extrabold text-slate-900">Sign in to create an event</h1>
        <p className="mt-1 text-sm text-slate-500">Only signed-in members can publish events.</p>
        <button type="button" onClick={() => navigateTo('/events')} className="mt-4 rounded-xl bg-[#1877F2] px-4 py-2.5 text-sm font-bold text-white">Back to Events</button>
      </div>
    );
  }

  const pickCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    if (!picked.type.startsWith('image/')) { setErrors(prev => ({ ...prev, cover: 'Choose an image (JPG, PNG or WEBP).' })); return; }
    const file = await compressImage(picked, 1600, 0.82);
    if (file.size > 2 * 1024 * 1024) { setErrors(prev => ({ ...prev, cover: 'Image is too large. Choose one under 2 MB.' })); return; }
    setErrors(prev => ({ ...prev, cover: undefined }));
    setCoverFile(file);
  };

  const validate = (): { errors: Errors; dateTime: string } => {
    const next: Errors = {};
    if (title.trim().length < 3) next.title = 'Title must be at least 3 characters.';
    else if (title.trim().length > 120) next.title = 'Title must be 120 characters or less.';
    if (!date) next.date = 'Choose a date.';
    if (!time) next.time = 'Choose a time.';
    let dateTime = '';
    if (date && time) {
      const when = new Date(`${date}T${time}`);
      if (Number.isNaN(when.getTime())) next.date = 'Enter a valid date and time.';
      else if (when.getTime() < Date.now()) next.date = 'The event must be in the future.';
      else dateTime = when.toISOString();
    }
    if (location.trim().length < 2) next.location = 'Enter where the event takes place.';
    if (description.length > 5000) next.description = 'Description must be 5,000 characters or less.';
    if (isPaid) {
      const amount = Number(price);
      if (!price || !Number.isInteger(amount) || amount < 1) next.price = 'Enter the ticket price in Leones (whole number).';
      else if (amount > 1_000_000_000) next.price = 'Price is too high.';
    }
    const total = Number(totalTickets);
    if (!Number.isInteger(total) || total < 1 || total > 100000) next.totalTickets = 'Enter between 1 and 100,000 tickets.';
    const contactError = validateApply(contactMethod, whatsapp);
    if (contactError) next.whatsapp = contactError;
    else if (encodeApply(contactMethod, whatsapp).length > 300) next.whatsapp = 'This link is too long (300 characters max).';
    return { errors: next, dateTime };
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');
    const { errors: next, dateTime } = validate();
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    const creatorId = auth.currentUser?.uid;
    if (!creatorId) { setSubmitError('Please sign in again.'); return; }
    setBusy(true);
    try {
      const coverUrl = coverFile ? await api.uploadFile(coverFile) : '';
      const id = await createEvent({
        title,
        coverUrl,
        dateTime,
        location,
        description,
        price: isPaid ? Number(price) : 0,
        totalTickets: Number(totalTickets),
        whatsapp: encodeApply(contactMethod, whatsapp)
      }, { id: creatorId, name: user.name || 'EChat member' });
      navigateTo(`/events/${id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not publish your event.';
      setSubmitError(/permission|insufficient/i.test(message) ? 'Could not publish. Please sign in again and retry.' : message);
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (key: keyof Errors) => errors[key] ? <p role="alert" className="mt-1 text-xs text-rose-600">{errors[key]}</p> : null;

  return (
    <div className="mx-auto max-w-xl space-y-4 pb-16">
      <button type="button" onClick={() => navigateTo('/events')} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm"><ArrowLeft size={16} />Back to Events</button>
      <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h1 className="flex items-center gap-2 text-xl font-extrabold text-slate-900"><CalendarPlus className="text-[#1877F2]" />Create Event</h1>

        <div>
          <label htmlFor="ev-title" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">Title *</label>
          <input id="ev-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Freetown Music Night" className={inputClass(errors.title)} />
          {fieldError('title')}
        </div>

        <div>
          <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">Cover Image</span>
          {coverPreview ? (
            <div className="relative overflow-hidden rounded-xl border border-slate-200">
              <img src={coverPreview} alt="Cover preview" className="h-44 w-full object-cover" />
              <button type="button" onClick={() => setCoverFile(null)} className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-white/95 px-3 py-1.5 text-xs font-bold text-rose-600 shadow"><Trash2 size={14} />Remove</button>
            </div>
          ) : (
            <label className="flex h-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 hover:bg-slate-50">
              <Camera size={24} /><span className="text-sm font-bold">Upload cover image</span><span className="text-[11px]">JPG, PNG or WEBP</span>
              <input type="file" accept="image/*" className="hidden" onChange={e => void pickCover(e)} />
            </label>
          )}
          {fieldError('cover')}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ev-date" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">Date *</label>
            <input id="ev-date" type="date" value={date} onChange={e => setDate(e.target.value)} className={inputClass(errors.date)} />
            {fieldError('date')}
          </div>
          <div>
            <label htmlFor="ev-time" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">Time *</label>
            <input id="ev-time" type="time" value={time} onChange={e => setTime(e.target.value)} className={inputClass(errors.time)} />
            {fieldError('time')}
          </div>
        </div>

        <div>
          <label htmlFor="ev-location" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">Location *</label>
          <input id="ev-location" value={location} onChange={e => setLocation(e.target.value)} maxLength={150} list="ev-locations" placeholder="e.g. National Stadium, Freetown" className={inputClass(errors.location)} />
          <datalist id="ev-locations">{['Freetown', 'Bo', 'Kenema', 'Makeni', 'Koidu', 'Online'].map(item => <option key={item} value={item} />)}</datalist>
          {fieldError('location')}
        </div>

        <div>
          <label htmlFor="ev-description" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">Description</label>
          <textarea id="ev-description" value={description} onChange={e => setDescription(e.target.value)} rows={4} maxLength={5000} placeholder="Tell people what to expect…" className={inputClass(errors.description)} />
          {fieldError('description')}
        </div>

        <div>
          <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">Ticket Price *</span>
          <div className="flex rounded-xl bg-[#F2F4F7] p-1">
            <button type="button" onClick={() => setIsPaid(false)} aria-pressed={!isPaid} className={`min-h-10 flex-1 rounded-lg text-sm font-bold ${!isPaid ? 'bg-white text-[#1877F2] shadow-sm' : 'text-slate-600'}`}>Free</button>
            <button type="button" onClick={() => setIsPaid(true)} aria-pressed={isPaid} className={`min-h-10 flex-1 rounded-lg text-sm font-bold ${isPaid ? 'bg-white text-[#1877F2] shadow-sm' : 'text-slate-600'}`}>Paid (Le)</button>
          </div>
          {isPaid && <div className="mt-2 flex items-center gap-2"><span className="text-sm font-bold text-slate-600">Le</span><input type="number" inputMode="numeric" min={1} step={1} value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 50000" aria-label="Ticket price in Leones" className={inputClass(errors.price)} /></div>}
          {fieldError('price')}
        </div>

        <div>
          <label htmlFor="ev-total" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">Total Tickets Available *</label>
          <input id="ev-total" type="number" inputMode="numeric" min={1} max={100000} step={1} value={totalTickets} onChange={e => setTotalTickets(e.target.value)} className={inputClass(errors.totalTickets)} />
          {fieldError('totalTickets')}
        </div>

        <div>
          <ApplyMethodField kind="event" idPrefix="ev-contact" method={contactMethod} value={whatsapp}
            onMethod={method => { setContactMethod(method); setErrors(prev => ({ ...prev, whatsapp: undefined })); }}
            onValue={setWhatsapp} error={errors.whatsapp} inputClassName={inputClass(errors.whatsapp)} />
        </div>

        {submitError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{submitError}</p>}
        <button type="submit" disabled={busy} className="min-h-12 w-full rounded-xl bg-[#1877F2] text-base font-extrabold text-white hover:bg-[#166FE5] disabled:opacity-60">{busy ? 'Publishing…' : 'Publish Event'}</button>
      </form>
    </div>
  );
};
