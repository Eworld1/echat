import {
  collection,
  doc,
  getDoc,
  increment,
  limit,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe
} from 'firebase/firestore';
import { db } from './firebase';

/**
 * Events + Tickets on Firestore.
 * Security lives in firestore.rules (events / tickets / eventGoing): counters can only change
 * together with the matching ticket / going document, and only the creator confirms or checks in.
 */

export type TicketStatus = 'Pending' | 'Confirmed' | 'Checked-in';

export interface EchatEvent {
  id: string;
  title: string;
  coverUrl: string;
  /** ISO 8601 (UTC) */
  dateTime: string;
  location: string;
  description: string;
  /** Whole Leones. 0 = Free. */
  price: number;
  totalTickets: number;
  ticketsSold: number;
  goingCount: number;
  whatsapp: string;
  creatorId: string;
  creatorName: string;
  createdAt: number;
  status: 'published';
  /** Events from the older Express Events API (read-only here). */
  legacy?: boolean;
}

export interface EventTicket {
  ticketId: string;
  eventId: string;
  eventTitle: string;
  eventDate: string;
  eventLocation: string;
  creatorId: string;
  buyerId: string;
  buyerName: string;
  qty: number;
  unitPrice: number;
  totalPrice: number;
  transactionId: string;
  proofUrl: string;
  status: TicketStatus;
  createdAt: number;
  confirmedAt?: number;
  checkedInAt?: number;
}

export const MAX_TICKETS_PER_ORDER = 5;

export const formatLeones = (amount: number) => amount <= 0 ? 'Free' : `Le ${Math.round(amount).toLocaleString('en-US')}`;

/** QR payload: ticket ID + event ID. Scanned on the creator's check-in page. */
export const ticketQrPayload = (ticket: Pick<EventTicket, 'ticketId' | 'eventId'>) => `ECHAT-TICKET|${ticket.ticketId}|${ticket.eventId}`;

export function parseTicketQr(text: string): { ticketId: string; eventId: string } | null {
  const value = text.trim();
  const match = /^ECHAT-TICKET\|(ECH-[A-Z0-9]{6})\|([A-Za-z0-9_-]+)$/.exec(value);
  if (match) return { ticketId: match[1], eventId: match[2] };
  // Manual entry fallback: just a ticket ID.
  const id = /^(ECH-[A-Z0-9]{6})$/i.exec(value);
  return id ? { ticketId: id[1].toUpperCase(), eventId: '' } : null;
}

const TICKET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid misreads
export function newTicketId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `ECH-${Array.from(bytes, byte => TICKET_ALPHABET[byte % TICKET_ALPHABET.length]).join('')}`;
}

function toEvent(id: string, data: Record<string, unknown>): EchatEvent {
  return {
    id,
    title: String(data.title || ''),
    coverUrl: String(data.coverUrl || ''),
    dateTime: String(data.dateTime || ''),
    location: String(data.location || ''),
    description: String(data.description || ''),
    price: Number(data.price || 0),
    totalTickets: Number(data.totalTickets || 0),
    ticketsSold: Number(data.ticketsSold || 0),
    goingCount: Math.max(0, Number(data.goingCount || 0)),
    whatsapp: String(data.whatsapp || ''),
    creatorId: String(data.creatorId || ''),
    creatorName: String(data.creatorName || ''),
    createdAt: Number(data.createdAt || 0),
    status: 'published'
  };
}

function toTicket(data: Record<string, unknown>): EventTicket {
  return {
    ticketId: String(data.ticketId || ''),
    eventId: String(data.eventId || ''),
    eventTitle: String(data.eventTitle || ''),
    eventDate: String(data.eventDate || ''),
    eventLocation: String(data.eventLocation || ''),
    creatorId: String(data.creatorId || ''),
    buyerId: String(data.buyerId || ''),
    buyerName: String(data.buyerName || ''),
    qty: Number(data.qty || 0),
    unitPrice: Number(data.unitPrice || 0),
    totalPrice: Number(data.totalPrice || 0),
    transactionId: String(data.transactionId || ''),
    proofUrl: String(data.proofUrl || ''),
    status: (['Pending', 'Confirmed', 'Checked-in'].includes(String(data.status)) ? data.status : 'Pending') as TicketStatus,
    createdAt: Number(data.createdAt || 0),
    confirmedAt: data.confirmedAt ? Number(data.confirmedAt) : undefined,
    checkedInAt: data.checkedInAt ? Number(data.checkedInAt) : undefined
  };
}

export const ticketsRemaining = (event: Pick<EchatEvent, 'totalTickets' | 'ticketsSold'>) => Math.max(0, event.totalTickets - event.ticketsSold);
export const isPastEvent = (event: Pick<EchatEvent, 'dateTime'>, now = Date.now()) => {
  const time = Date.parse(event.dateTime);
  return Number.isFinite(time) && time < now;
};

// ---------------- Events ----------------

export function listenEvents(onEvents: (events: EchatEvent[]) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'events'), limit(100)), snapshot => {
    onEvents(snapshot.docs.map(item => toEvent(item.id, item.data())));
  }, onError);
}

export function listenEvent(eventId: string, onEvent: (event: EchatEvent | null) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(doc(db, 'events', eventId), snapshot => {
    onEvent(snapshot.exists() ? toEvent(snapshot.id, snapshot.data()) : null);
  }, onError);
}

export interface NewEventInput {
  title: string;
  coverUrl: string;
  dateTime: string;
  location: string;
  description: string;
  price: number;
  totalTickets: number;
  whatsapp: string;
}

export async function createEvent(input: NewEventInput, creator: { id: string; name: string }): Promise<string> {
  const ref = doc(collection(db, 'events'));
  await setDoc(ref, {
    title: input.title.trim(),
    coverUrl: input.coverUrl,
    dateTime: input.dateTime,
    location: input.location.trim(),
    description: input.description.trim(),
    price: Math.max(0, Math.round(input.price)),
    totalTickets: Math.round(input.totalTickets),
    ticketsSold: 0,
    goingCount: 0,
    whatsapp: input.whatsapp.trim(),
    creatorId: creator.id,
    creatorName: creator.name.slice(0, 120),
    createdAt: Date.now(),
    status: 'published'
  });
  return ref.id;
}

// ---------------- Going ----------------

const goingRef = (eventId: string, userId: string) => doc(db, 'eventGoing', `${eventId}_${userId}`);

/** IDs of events the user marked Going. */
export function listenMyGoing(userId: string, onIds: (ids: Set<string>) => void): Unsubscribe {
  if (!userId) { onIds(new Set()); return () => {}; }
  return onSnapshot(query(collection(db, 'eventGoing'), where('userId', '==', userId)), snapshot => {
    onIds(new Set(snapshot.docs.map(item => String(item.data().eventId || ''))));
  }, () => onIds(new Set()));
}

/** Toggle Going: the going doc and the event's goingCount change in one atomic batch. */
export async function setGoing(eventId: string, userId: string, going: boolean): Promise<void> {
  const batch = writeBatch(db);
  if (going) batch.set(goingRef(eventId, userId), { eventId, userId, createdAt: Date.now() });
  else batch.delete(goingRef(eventId, userId));
  batch.update(doc(db, 'events', eventId), { goingCount: increment(going ? 1 : -1) });
  await batch.commit();
}

// ---------------- Tickets ----------------

export interface BuyTicketInput {
  qty: number;
  transactionId: string;
  proofUrl: string;
}

/**
 * Creates the ticket and increments ticketsSold in one transaction.
 * The transaction re-reads the event so two buyers can never take the last seats twice.
 */
export async function buyTickets(eventId: string, buyer: { id: string; name: string }, input: BuyTicketInput): Promise<EventTicket> {
  const qty = Math.round(input.qty);
  if (qty < 1 || qty > MAX_TICKETS_PER_ORDER) throw new Error(`Choose between 1 and ${MAX_TICKETS_PER_ORDER} tickets.`);
  const eventRef = doc(db, 'events', eventId);
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(eventRef);
    if (!snapshot.exists()) throw new Error('This event no longer exists.');
    const event = toEvent(snapshot.id, snapshot.data());
    if (isPastEvent(event)) throw new Error('This event has already happened.');
    const remaining = ticketsRemaining(event);
    if (remaining <= 0) throw new Error('Sold out. No tickets left.');
    if (qty > remaining) throw new Error(`Only ${remaining} ticket${remaining === 1 ? '' : 's'} left.`);
    const isFree = event.price <= 0;
    if (!isFree && input.transactionId.trim().length < 4) throw new Error('Enter your Orange Money / Africell Money transaction ID.');

    const ticketId = newTicketId();
    const ticket: EventTicket = {
      ticketId,
      eventId,
      eventTitle: event.title,
      eventDate: event.dateTime,
      eventLocation: event.location,
      creatorId: event.creatorId,
      buyerId: buyer.id,
      buyerName: buyer.name.slice(0, 120),
      qty,
      unitPrice: event.price,
      totalPrice: event.price * qty,
      transactionId: isFree ? '' : input.transactionId.trim().slice(0, 100),
      proofUrl: isFree ? '' : input.proofUrl,
      status: isFree ? 'Confirmed' : 'Pending',
      createdAt: Date.now()
    };
    transaction.set(doc(db, 'tickets', ticketId), ticket);
    transaction.update(eventRef, { ticketsSold: event.ticketsSold + qty, lastTicketId: ticketId });
    return ticket;
  });
}

export function listenMyTickets(userId: string, onTickets: (tickets: EventTicket[]) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'tickets'), where('buyerId', '==', userId)), snapshot => {
    onTickets(snapshot.docs.map(item => toTicket(item.data())).sort((a, b) => b.createdAt - a.createdAt));
  }, onError);
}

/** Tickets for one event. Creators query with their own creatorId so the security rules allow the list. */
export function listenEventTickets(eventId: string, viewer: { id: string; isAdmin: boolean }, onTickets: (tickets: EventTicket[]) => void, onError: (error: Error) => void): Unsubscribe {
  const constraints = viewer.isAdmin ? [where('eventId', '==', eventId)] : [where('eventId', '==', eventId), where('creatorId', '==', viewer.id)];
  return onSnapshot(query(collection(db, 'tickets'), ...constraints), snapshot => {
    onTickets(snapshot.docs.map(item => toTicket(item.data())).sort((a, b) => b.createdAt - a.createdAt));
  }, onError);
}

export async function confirmTicket(ticketId: string): Promise<void> {
  await updateDoc(doc(db, 'tickets', ticketId), { status: 'Confirmed', confirmedAt: Date.now() });
}

export type CheckInResult =
  | { ok: true; ticket: EventTicket }
  | { ok: false; reason: string; ticket?: EventTicket };

/** Validate a scanned ticket for this event and mark it Checked-in. */
export async function checkInTicket(scanned: { ticketId: string; eventId: string }, eventId: string, staffId: string): Promise<CheckInResult> {
  if (scanned.eventId && scanned.eventId !== eventId) return { ok: false, reason: 'This ticket is for a different event.' };
  let snapshot;
  try {
    snapshot = await getDoc(doc(db, 'tickets', scanned.ticketId));
  } catch {
    return { ok: false, reason: `Ticket ${scanned.ticketId} was not found for this event.` };
  }
  if (!snapshot.exists()) return { ok: false, reason: `Ticket ${scanned.ticketId} was not found.` };
  const ticket = toTicket(snapshot.data());
  if (ticket.eventId !== eventId) return { ok: false, reason: 'This ticket is for a different event.', ticket };
  if (ticket.status === 'Checked-in') return { ok: false, reason: `Already checked in${ticket.checkedInAt ? ` at ${new Date(ticket.checkedInAt).toLocaleTimeString()}` : ''}.`, ticket };
  if (ticket.status === 'Pending') return { ok: false, reason: 'Payment not confirmed yet. Confirm the payment first.', ticket };
  await updateDoc(snapshot.ref, { status: 'Checked-in', checkedInAt: Date.now(), checkedInBy: staffId });
  return { ok: true, ticket: { ...ticket, status: 'Checked-in', checkedInAt: Date.now() } };
}

