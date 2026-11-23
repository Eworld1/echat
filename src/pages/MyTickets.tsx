import React, { useEffect, useState } from 'react';
import { CalendarDays, MapPin, Ticket, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { auth } from '../services/firebase';
import { formatLeones, isPastEvent, listenMyTickets, type EventTicket } from '../services/eventTickets';
import { TicketQr } from '../components/events/TicketQr';
import { formatEventDate, navigateTo } from '../utils/eventsNav';

const statusClass: Record<EventTicket['status'], string> = {
  Pending: 'bg-amber-100 text-amber-800',
  Confirmed: 'bg-emerald-100 text-emerald-700',
  'Checked-in': 'bg-[#E7F0FD] text-[#1877F2]'
};

export const MyTickets: React.FC = () => {
  const { user } = useAuth();
  const uid = auth.currentUser?.uid || '';
  const [tickets, setTickets] = useState<EventTicket[] | null>(null);
  const [error, setError] = useState('');
  const [enlarged, setEnlarged] = useState<EventTicket | null>(null);

  useEffect(() => {
    if (!uid) { setTickets([]); return; }
    return listenMyTickets(uid, items => { setTickets(items); setError(''); }, err => { setError(err.message); setTickets([]); });
  }, [uid]);

  if (!user) return <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600 shadow-sm">Sign in to see your tickets.</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h1 className="flex items-center gap-2 text-xl font-extrabold text-slate-900"><Ticket className="text-[#1877F2]" />My Tickets</h1>
        <button type="button" onClick={() => navigateTo('/events')} className="min-h-10 rounded-xl bg-[#1877F2] px-4 text-sm font-bold text-white">Find events</button>
      </header>
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {tickets === null ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading tickets…</div>
        : tickets.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <Ticket size={40} className="mx-auto mb-2 text-slate-300" />
            <p className="font-bold text-slate-800">No tickets yet</p>
            <p className="text-sm text-slate-500">Tickets you buy or get for free appear here with their QR code.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {tickets.map(ticket => (
              <li key={ticket.ticketId} className={`flex gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${isPastEvent({ dateTime: ticket.eventDate }) ? 'opacity-70' : ''}`}>
                <button type="button" onClick={() => setEnlarged(ticket)} aria-label={`Show QR code for ${ticket.ticketId} full size`} className="shrink-0">
                  <TicketQr ticket={ticket} size={104} className="border border-slate-200 p-1" />
                </button>
                <div className="min-w-0 flex-1 space-y-1">
                  <button type="button" onClick={() => navigateTo(`/events/${ticket.eventId}`)} className="block text-left font-extrabold text-slate-900 hover:underline">{ticket.eventTitle}</button>
                  <p className="flex items-center gap-1.5 text-sm text-slate-600"><CalendarDays size={14} />{formatEventDate(ticket.eventDate)}</p>
                  {ticket.eventLocation && <p className="flex items-center gap-1.5 text-sm text-slate-600"><MapPin size={14} /><span className="truncate">{ticket.eventLocation}</span></p>}
                  <p className="font-mono text-sm font-bold tracking-wider text-slate-900">{ticket.ticketId}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className={`rounded-full px-2.5 py-1 font-extrabold ${statusClass[ticket.status]}`}>{ticket.status}</span>
                    <span>{ticket.qty} ticket{ticket.qty === 1 ? '' : 's'} · {formatLeones(ticket.totalPrice)}</span>
                  </div>
                  {ticket.status === 'Pending' && <p className="text-xs text-amber-700">Waiting for the organizer to confirm your payment.</p>}
                </div>
              </li>
            ))}
          </ul>
        )}

      {enlarged && (
        <div role="dialog" aria-modal="true" aria-label="Ticket QR code" className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4" onClick={() => setEnlarged(null)}>
          <div className="w-full max-w-xs rounded-2xl bg-white p-5 text-center" onClick={e => e.stopPropagation()}>
            <div className="mb-2 flex justify-end"><button type="button" onClick={() => setEnlarged(null)} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full hover:bg-slate-100"><X size={18} /></button></div>
            <TicketQr ticket={enlarged} size={240} className="mx-auto" />
            <p className="mt-3 font-mono text-lg font-black tracking-wider">{enlarged.ticketId}</p>
            <p className="text-sm text-slate-600">{enlarged.eventTitle} · Admit {enlarged.qty}</p>
            <span className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-extrabold ${statusClass[enlarged.status]}`}>{enlarged.status}</span>
          </div>
        </div>
      )}
    </div>
  );
};
