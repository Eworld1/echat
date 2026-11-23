import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Calendar, MapPin, Plus, Ticket } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { auth } from '../services/firebase';
import { api } from '../services/api';
import { EventCard } from '../components/events/EventCard';
import { BuyTicketModal } from '../components/events/BuyTicketModal';
import { isPastEvent, listenEvents, listenMyGoing, setGoing, type EchatEvent } from '../services/eventTickets';
import { navigateTo, shareEvent, usePathname } from '../utils/eventsNav';
import { CreateEventPage } from './events/CreateEventPage';
import { EventDetailPage, legacyToEchatEvent } from './events/EventDetailPage';
import type { EventItem } from '../types';

// The QR scanner library is only loaded when a creator opens the check-in page.
const EventCheckinPage = lazy(() => import('./events/EventCheckinPage').then(module => ({ default: module.EventCheckinPage })));

type Filter = 'all' | 'upcoming' | 'weekend' | 'free' | 'paid';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'weekend', label: 'This Weekend' },
  { id: 'free', label: 'Free' },
  { id: 'paid', label: 'Paid' }
];

/** Friday 17:00 → Sunday 23:59 of the current week (starting now if the weekend has begun). */
function thisWeekend(now = new Date()): { start: number; end: number } {
  const day = now.getDay(); // 0 Sun … 6 Sat
  const friday = new Date(now);
  friday.setDate(now.getDate() + (day === 0 ? -2 : 5 - day));
  friday.setHours(17, 0, 0, 0);
  const sunday = new Date(friday);
  sunday.setDate(friday.getDate() + 2);
  sunday.setHours(23, 59, 59, 999);
  return { start: Math.max(friday.getTime(), now.getTime()), end: sunday.getTime() };
}

const EventsFeed: React.FC = () => {
  const { user } = useAuth();
  const uid = auth.currentUser?.uid || '';
  const [events, setEvents] = useState<EchatEvent[] | null>(null);
  const [legacyEvents, setLegacyEvents] = useState<EventItem[]>([]);
  const [loadError, setLoadError] = useState('');
  const [goingIds, setGoingIds] = useState<Set<string>>(new Set());
  const [busyGoingId, setBusyGoingId] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [location, setLocation] = useState('All');
  const [buyEvent, setBuyEvent] = useState<EchatEvent | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => listenEvents(items => { setEvents(items); setLoadError(''); }, err => { setLoadError(err.message || 'Could not load events.'); setEvents([]); }), []);
  useEffect(() => { void api.getEvents().then(setLegacyEvents).catch(() => setLegacyEvents([])); }, []);
  useEffect(() => listenMyGoing(uid, setGoingIds), [uid]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 3000); return () => window.clearTimeout(timer); }, [notice]);

  const allEvents = useMemo(() => [...(events || []), ...legacyEvents.map(legacyToEchatEvent)], [events, legacyEvents]);
  const locations = useMemo(() => Array.from(new Set(allEvents.map(event => event.location.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [allEvents]);

  const visible = useMemo(() => {
    const now = Date.now();
    const weekend = thisWeekend();
    const filtered = allEvents.filter(event => {
      const time = Date.parse(event.dateTime);
      if (location !== 'All' && event.location.trim() !== location) return false;
      if (filter === 'upcoming') return !isPastEvent(event, now);
      if (filter === 'weekend') return Number.isFinite(time) && time >= weekend.start && time <= weekend.end;
      if (filter === 'free') return event.price <= 0;
      if (filter === 'paid') return event.price > 0;
      return true;
    });
    // Upcoming first (soonest first), past events at the bottom (most recent first).
    const upcoming = filtered.filter(event => !isPastEvent(event, now)).sort((a, b) => Date.parse(a.dateTime) - Date.parse(b.dateTime));
    const past = filtered.filter(event => isPastEvent(event, now)).sort((a, b) => Date.parse(b.dateTime) - Date.parse(a.dateTime));
    return [...upcoming, ...past];
  }, [allEvents, filter, location]);

  const isGoing = (event: EchatEvent) => event.legacy ? Boolean(user && legacyEvents.find(item => item.id === event.id)?.going?.includes(user.id)) : goingIds.has(event.id);

  const toggleGoing = async (event: EchatEvent) => {
    if (!user || !uid) { setNotice('Sign in to mark yourself as going.'); return; }
    setBusyGoingId(event.id);
    try {
      if (event.legacy) {
        const updated = await api.toggleEventGoing(event.id);
        setLegacyEvents(prev => prev.map(item => item.id === updated.id ? updated : item));
      } else {
        await setGoing(event.id, uid, !goingIds.has(event.id));
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not update.');
    } finally {
      setBusyGoingId('');
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-extrabold text-slate-900"><Calendar className="text-[#1877F2]" />Events</h1>
          <p className="text-sm text-slate-500">Concerts, meetups, church programmes and more.</p>
        </div>
        <div className="flex gap-2">
          {user && <button type="button" onClick={() => navigateTo('/my-tickets')} className="flex min-h-11 items-center gap-1.5 rounded-xl bg-slate-100 px-3 text-sm font-bold text-slate-700 hover:bg-slate-200"><Ticket size={17} />My Tickets</button>}
          {user && <button type="button" onClick={() => navigateTo('/events/create')} className="flex min-h-11 items-center gap-1.5 rounded-xl bg-[#1877F2] px-4 text-sm font-bold text-white hover:bg-[#166FE5]"><Plus size={18} />Create Event</button>}
        </div>
      </header>

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Event filters">
          {FILTERS.map(item => (
            <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} onClick={() => setFilter(item.id)} className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-bold ${filter === item.id ? 'bg-[#1877F2] text-white' : 'bg-[#F2F4F7] text-slate-700 hover:bg-slate-200'}`}>{item.label}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
          <MapPin size={16} className="text-rose-500" />
          <span className="sr-only sm:not-sr-only">Location</span>
          <select value={location} onChange={e => setLocation(e.target.value)} className="min-h-10 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm sm:flex-none">
            <option value="All">All locations</option>
            {locations.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>

      {notice && <p role="status" className="rounded-xl bg-slate-900 p-3 text-center text-sm font-semibold text-white">{notice}</p>}
      {loadError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{loadError}</p>}

      {events === null ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading events…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <Calendar size={40} className="mx-auto mb-2 text-slate-300" />
          <p className="font-bold text-slate-800">No events found</p>
          <p className="text-sm text-slate-500">{allEvents.length ? 'Try another filter or location.' : 'Be the first to create an event!'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {visible.map(event => (
            <EventCard
              key={event.id}
              event={event}
              isGoing={isGoing(event)}
              goingBusy={busyGoingId === event.id}
              onOpen={() => navigateTo(`/events/${event.id}`)}
              onBuy={() => user && uid ? setBuyEvent(event) : setNotice('Sign in to get tickets.')}
              onToggleGoing={() => void toggleGoing(event)}
              onShare={() => void shareEvent(event).then(message => message && setNotice(message))}
            />
          ))}
        </div>
      )}

      {buyEvent && user && uid && <BuyTicketModal event={buyEvent} buyer={{ id: uid, name: user.name || 'EChat member' }} onClose={() => setBuyEvent(null)} />}
    </div>
  );
};

interface EventsProps {
  initialEventId?: string | null;
  onNavigateBack?: () => void;
}

/**
 * /events                → feed
 * /events/create         → create form
 * /events/:id            → details (+ creator dashboard)
 * /events/:id/checkin    → QR check-in (creator / admin)
 */
export const Events: React.FC<EventsProps> = ({ initialEventId }) => {
  const pathname = usePathname();
  const segments = pathname.startsWith('/events/') ? pathname.slice('/events/'.length).split('/').filter(Boolean).map(decodeURIComponent) : [];
  if (segments[0] === 'create') return <CreateEventPage />;
  const eventId = segments[0] || initialEventId || '';
  if (eventId && segments[1] === 'checkin') return <Suspense fallback={<div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Opening scanner…</div>}><EventCheckinPage eventId={eventId} /></Suspense>;
  if (eventId) return <EventDetailPage eventId={eventId} />;
  return <EventsFeed />;
};
