import React from 'react';
import { CalendarDays, MapPin, Share2, Star, Ticket, Users } from 'lucide-react';
import { ListingImage } from '../ListingPhoto';
import { formatLeones, isPastEvent, ticketsRemaining, type EchatEvent } from '../../services/eventTickets';
import { formatEventDate } from '../../utils/eventsNav';

interface EventCardProps {
  event: EchatEvent;
  isGoing: boolean;
  goingBusy?: boolean;
  onOpen: () => void;
  onBuy: () => void;
  onToggleGoing: () => void;
  onShare: () => void;
}

export const EventCard: React.FC<EventCardProps> = ({ event, isGoing, goingBusy, onOpen, onBuy, onToggleGoing, onShare }) => {
  const past = isPastEvent(event);
  const remaining = ticketsRemaining(event);
  const date = new Date(event.dateTime);
  const validDate = Number.isFinite(date.getTime());
  const soldOut = !event.legacy && remaining <= 0;

  return (
    <article className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition ${past ? 'opacity-60 grayscale-[40%]' : 'hover:shadow-md'}`}>
      <button type="button" onClick={onOpen} className="relative block h-40 w-full bg-slate-100 text-left sm:h-44" aria-label={`Open ${event.title}`}>
        <ListingImage src={event.coverUrl} name={event.title} className="h-full w-full" letterClassName="text-5xl" />
        {validDate && <div className="absolute left-3 top-3 rounded-xl bg-white/95 px-2.5 py-1 text-center shadow-sm">
          <div className="text-[10px] font-black uppercase leading-none text-[#1877F2]">{date.toLocaleString(undefined, { month: 'short' })}</div>
          <div className="text-lg font-black leading-tight text-slate-900">{date.getDate()}</div>
        </div>}
        <span className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-xs font-extrabold shadow-sm ${event.price > 0 ? 'bg-white text-slate-900' : 'bg-emerald-500 text-white'}`}>{formatLeones(event.price)}</span>
        {past && <span className="absolute bottom-3 left-3 rounded-full bg-slate-900/80 px-2.5 py-1 text-xs font-bold text-white">Event ended</span>}
      </button>
      <div className="space-y-2 p-4">
        <button type="button" onClick={onOpen} className="block w-full text-left">
          <h3 className="line-clamp-2 text-base font-extrabold text-slate-900">{event.title}</h3>
        </button>
        <p className="flex items-center gap-1.5 text-sm text-slate-600"><CalendarDays size={15} className="shrink-0 text-[#1877F2]" />{formatEventDate(event.dateTime)}</p>
        <p className="flex items-center gap-1.5 text-sm text-slate-600"><MapPin size={15} className="shrink-0 text-rose-500" /><span className="truncate">{event.location}</span></p>
        <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500">
          <span className="flex items-center gap-1"><Users size={14} />{event.goingCount} going</span>
          {!event.legacy && <span className="flex items-center gap-1"><Ticket size={14} />{soldOut ? 'Sold out' : `${remaining} left`}</span>}
        </div>
        <div className="flex gap-2 pt-1">
          {event.legacy ? (
            <button type="button" onClick={onOpen} className="min-h-11 flex-1 rounded-xl bg-[#1877F2] px-3 text-sm font-bold text-white hover:bg-[#166FE5]">View details</button>
          ) : (
            <button type="button" onClick={onBuy} disabled={past || soldOut} className="min-h-11 flex-1 rounded-xl bg-[#1877F2] px-3 text-sm font-bold text-white hover:bg-[#166FE5] disabled:cursor-not-allowed disabled:bg-slate-300">
              {past ? 'Event ended' : soldOut ? 'Sold out' : event.price > 0 ? 'Buy Ticket' : 'Get Free Ticket'}
            </button>
          )}
          <button type="button" onClick={onToggleGoing} disabled={goingBusy || past} aria-pressed={isGoing} className={`flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-bold transition disabled:opacity-60 ${isGoing ? 'bg-[#E7F0FD] text-[#1877F2]' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
            <Star size={16} className={isGoing ? 'fill-[#1877F2]' : ''} />{isGoing ? 'Going' : 'Interested'}
          </button>
          <button type="button" onClick={onShare} aria-label={`Share ${event.title}`} className="grid min-h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200"><Share2 size={17} /></button>
        </div>
      </div>
    </article>
  );
};
