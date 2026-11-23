import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Banknote, CalendarDays, CheckCircle2, MapPin, MessageCircle, QrCode, Share2, Star, Ticket, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { auth } from '../../services/firebase';
import { api } from '../../services/api';
import { ListingImage } from '../../components/ListingPhoto';
import { BuyTicketModal } from '../../components/events/BuyTicketModal';
import {
  confirmTicket,
  formatLeones,
  isPastEvent,
  listenEvent,
  listenEventTickets,
  listenMyGoing,
  setGoing,
  ticketsRemaining,
  type EchatEvent,
  type EventTicket
} from '../../services/eventTickets';
import { formatEventDate, navigateTo, shareEvent } from '../../utils/eventsNav';
import type { EventItem, User } from '../../types';

/** Must match isAdmin() in firestore.rules (role based), otherwise admin queries would be denied. */
export const isEventsAdmin = (user: User | null | undefined) => Boolean(user && ['admin', 'super_admin', 'developer'].includes(user.role));

/** Older events from the Express Events API, shown read-only. */
export function legacyToEchatEvent(item: EventItem): EchatEvent {
  const time = Date.parse(item.date);
  return {
    id: item.id,
    title: item.title,
    coverUrl: item.cover || '',
    dateTime: Number.isFinite(time) ? new Date(time).toISOString() : '',
    location: item.location || 'Online',
    description: item.description || '',
    price: 0,
    totalTickets: 0,
    ticketsSold: 0,
    goingCount: item.going?.length || 0,
    whatsapp: item.contactInfo || '',
    creatorId: item.ownerId,
    creatorName: item.organizer || item.ownerName || 'Host',
    createdAt: item.createdAt || 0,
    status: 'published',
    legacy: true
  };
}

const whatsappLink = (value: string) => {
  const digits = value.replace(/[^\d]/g, '');
  return digits.length >= 6 ? `https://wa.me/${digits}` : '';
};

const statusBadge = (status: EventTicket['status']) =>
  status === 'Confirmed' ? 'bg-emerald-100 text-emerald-700' : status === 'Checked-in' ? 'bg-[#E7F0FD] text-[#1877F2]' : 'bg-amber-100 text-amber-800';

export const EventDetailPage: React.FC<{ eventId: string }> = ({ eventId }) => {
  const { user } = useAuth();
  const uid = auth.currentUser?.uid || '';
  const isLegacy = eventId.startsWith('event_');
  const [event, setEvent] = useState<EchatEvent | null | undefined>(undefined);
  const [legacyRaw, setLegacyRaw] = useState<EventItem | null>(null);
  const [error, setError] = useState('');
  const [goingIds, setGoingIds] = useState<Set<string>>(new Set());
  const [goingBusy, setGoingBusy] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [tickets, setTickets] = useState<EventTicket[]>([]);
  const [ticketsError, setTicketsError] = useState('');
  const [confirmingId, setConfirmingId] = useState('');

  useEffect(() => {
    setEvent(undefined);
    if (isLegacy) {
      let active = true;
      api.getEvent(eventId).then(item => {
        if (!active) return;
        setLegacyRaw(item);
        setEvent(legacyToEchatEvent(item));
      }).catch(() => { if (active) setEvent(null); });
      return () => { active = false; };
    }
    return listenEvent(eventId, setEvent, err => { setError(err.message); setEvent(null); });
  }, [eventId, isLegacy]);

  useEffect(() => isLegacy ? undefined : listenMyGoing(uid, setGoingIds), [uid, isLegacy]);

  const isCreator = Boolean(event && !event.legacy && uid && event.creatorId === uid);
  const isAdmin = isEventsAdmin(user);
  const canManage = Boolean(event && !event.legacy && (isCreator || isAdmin));

  useEffect(() => {
    if (!canManage || !event) { setTickets([]); return; }
    return listenEventTickets(event.id, { id: uid, isAdmin: isAdmin && !isCreator }, items => { setTickets(items); setTicketsError(''); }, err => setTicketsError(err.message));
  }, [canManage, event?.id, uid, isAdmin, isCreator]);

  const stats = useMemo(() => {
    const paid = tickets.filter(ticket => ticket.status !== 'Pending');
    return {
      sold: tickets.reduce((sum, ticket) => sum + ticket.qty, 0),
      revenue: paid.reduce((sum, ticket) => sum + ticket.totalPrice, 0),
      pendingRevenue: tickets.filter(ticket => ticket.status === 'Pending').reduce((sum, ticket) => sum + ticket.totalPrice, 0),
      checkedIn: tickets.filter(ticket => ticket.status === 'Checked-in').reduce((sum, ticket) => sum + ticket.qty, 0)
    };
  }, [tickets]);

  if (event === undefined) return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading event…</div>;
  if (event === null) return (
    <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-lg font-extrabold text-slate-900">Event not found</h1>
      <p className="mt-1 text-sm text-slate-500">{error || 'This event may have been removed.'}</p>
      <button type="button" onClick={() => navigateTo('/events')} className="mt-4 rounded-xl bg-[#1877F2] px-4 py-2.5 text-sm font-bold text-white">Back to Events</button>
    </div>
  );

  const past = isPastEvent(event);
  const remaining = ticketsRemaining(event);
  const soldOut = !event.legacy && remaining <= 0;
  const isGoing = event.legacy ? Boolean(user && legacyRaw?.going?.includes(user.id)) : goingIds.has(event.id);
  const wa = whatsappLink(event.whatsapp);

  const toggleGoing = async () => {
    if (!user) { setNotice('Sign in to mark yourself as going.'); return; }
    setGoingBusy(true);
    try {
      if (event.legacy) {
        const updated = await api.toggleEventGoing(event.id);
        setLegacyRaw(updated);
        setEvent(legacyToEchatEvent(updated));
      } else {
        if (!uid) throw new Error('Please sign in again.');
        await setGoing(event.id, uid, !isGoing);
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not update.');
    } finally {
      setGoingBusy(false);
    }
  };

  const confirm = async (ticket: EventTicket) => {
    setConfirmingId(ticket.ticketId);
    try { await confirmTicket(ticket.ticketId); }
    catch (err) { setTicketsError(err instanceof Error ? err.message : 'Could not confirm ticket.'); }
    finally { setConfirmingId(''); }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-16">
      <button type="button" onClick={() => navigateTo('/events')} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm"><ArrowLeft size={16} />Back to Events</button>

      <article className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${past ? 'opacity-80' : ''}`}>
        <div className="relative h-52 bg-slate-100 sm:h-72">
          <ListingImage src={event.coverUrl} name={event.title} className="h-full w-full" letterClassName="text-7xl" />
          {past && <span className="absolute bottom-3 left-3 rounded-full bg-slate-900/80 px-3 py-1 text-xs font-bold text-white">This event has ended</span>}
        </div>
        <div className="space-y-4 p-4 sm:p-6">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">{event.title}</h1>
            <p className="mt-1 text-sm text-slate-500">By <strong className="text-slate-700">{event.creatorName || 'Host'}</strong></p>
          </div>
          <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            <p className="flex items-center gap-2"><CalendarDays size={17} className="text-[#1877F2]" />{formatEventDate(event.dateTime, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
            <p className="flex items-center gap-2"><MapPin size={17} className="text-rose-500" />{event.location}</p>
            <p className="flex items-center gap-2"><Banknote size={17} className="text-emerald-600" /><strong>{formatLeones(event.price)}</strong>{!event.legacy && event.price > 0 && <span className="text-slate-500">per ticket</span>}</p>
            <p className="flex items-center gap-2"><Users size={17} className="text-slate-500" />{event.goingCount} going{!event.legacy && <> · <Ticket size={15} className="text-slate-500" />{soldOut ? 'Sold out' : `${remaining} of ${event.totalTickets} tickets left`}</>}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {!event.legacy && (
              <button type="button" onClick={() => user && uid ? setBuyOpen(true) : setNotice('Sign in to get tickets.')} disabled={past || soldOut} className="min-h-12 flex-1 rounded-xl bg-[#1877F2] px-4 text-base font-extrabold text-white hover:bg-[#166FE5] disabled:cursor-not-allowed disabled:bg-slate-300 sm:flex-none">
                {past ? 'Event ended' : soldOut ? 'Sold out' : event.price > 0 ? 'Buy Ticket' : 'Get Free Ticket'}
              </button>
            )}
            <button type="button" onClick={() => void toggleGoing()} disabled={goingBusy || past} aria-pressed={isGoing} className={`flex min-h-12 items-center gap-2 rounded-xl px-4 text-sm font-bold disabled:opacity-60 ${isGoing ? 'bg-[#E7F0FD] text-[#1877F2]' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
              <Star size={17} className={isGoing ? 'fill-[#1877F2]' : ''} />{isGoing ? 'Going' : 'Interested / Going'}
            </button>
            <button type="button" onClick={() => void shareEvent(event).then(message => message && setNotice(message))} className="flex min-h-12 items-center gap-2 rounded-xl bg-slate-100 px-4 text-sm font-bold text-slate-700 hover:bg-slate-200"><Share2 size={17} />Share</button>
            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center gap-2 rounded-xl bg-emerald-50 px-4 text-sm font-bold text-emerald-700 hover:bg-emerald-100"><MessageCircle size={17} />WhatsApp</a>}
          </div>
          {notice && <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{notice}</p>}

          <div className="border-t border-slate-100 pt-4">
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">About this event</h2>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{event.description || 'No description provided.'}</p>
            {event.whatsapp && !wa && <p className="mt-2 text-sm text-slate-700">Contact: {event.whatsapp}</p>}
          </div>
        </div>
      </article>

      {canManage && (
        <section aria-label="Event dashboard" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-extrabold text-slate-900">{isCreator ? 'Your event dashboard' : 'Admin: event dashboard'}</h2>
            <button type="button" onClick={() => navigateTo(`/events/${event.id}/checkin`)} className="flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white"><QrCode size={17} />Scan QR to Check-in</button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-[#F2F4F7] p-3"><p className="text-xs text-slate-500">Tickets sold</p><p className="text-xl font-black text-slate-900">{event.ticketsSold}<span className="text-sm font-semibold text-slate-400"> / {event.totalTickets}</span></p></div>
            <div className="rounded-xl bg-[#F2F4F7] p-3"><p className="text-xs text-slate-500">Revenue (confirmed)</p><p className="text-xl font-black text-emerald-700">{formatLeones(stats.revenue) === 'Free' ? 'Le 0' : formatLeones(stats.revenue)}</p></div>
            <div className="rounded-xl bg-[#F2F4F7] p-3"><p className="text-xs text-slate-500">Awaiting confirmation</p><p className="text-xl font-black text-amber-700">{stats.pendingRevenue > 0 ? formatLeones(stats.pendingRevenue) : 'Le 0'}</p></div>
            <div className="rounded-xl bg-[#F2F4F7] p-3"><p className="text-xs text-slate-500">Checked in</p><p className="text-xl font-black text-[#1877F2]">{stats.checkedIn}</p></div>
          </div>
          {ticketsError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{ticketsError}</p>}
          <h3 className="pt-1 text-sm font-extrabold text-slate-900">Buyers ({tickets.length})</h3>
          {tickets.length === 0 ? <p className="rounded-xl bg-[#F2F4F7] p-4 text-center text-sm text-slate-500">No tickets yet.</p> : (
            <ul className="divide-y divide-slate-100">
              {tickets.map(ticket => (
                <li key={ticket.ticketId} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-900">{ticket.buyerName || 'Buyer'} <span className="font-normal text-slate-500">× {ticket.qty}</span></p>
                    <p className="text-xs text-slate-500"><span className="font-mono">{ticket.ticketId}</span> · {formatLeones(ticket.totalPrice)}{ticket.transactionId && <> · Txn <span className="font-mono">{ticket.transactionId}</span></>}</p>
                    {ticket.proofUrl && <a href={ticket.proofUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-[#1877F2] underline">View payment proof</a>}
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${statusBadge(ticket.status)}`}>{ticket.status}</span>
                  {ticket.status === 'Pending' && <button type="button" onClick={() => void confirm(ticket)} disabled={confirmingId === ticket.ticketId} className="flex min-h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-sm font-bold text-white disabled:opacity-60"><CheckCircle2 size={16} />{confirmingId === ticket.ticketId ? 'Confirming…' : 'Confirm'}</button>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {buyOpen && user && uid && <BuyTicketModal event={event} buyer={{ id: uid, name: user.name || 'EChat member' }} onClose={() => setBuyOpen(false)} />}
    </div>
  );
};
