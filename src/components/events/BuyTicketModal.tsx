import React, { useEffect, useState } from 'react';
import { CheckCircle2, ImagePlus, Ticket, X } from 'lucide-react';
import { api } from '../../services/api';
import { compressImage } from '../../utils/image';
import { buyTickets, formatLeones, MAX_TICKETS_PER_ORDER, ticketsRemaining, type EchatEvent, type EventTicket } from '../../services/eventTickets';
import { TicketQr } from './TicketQr';
import { navigateTo, formatEventDate } from '../../utils/eventsNav';

const PAYMENT_NUMBER = String(import.meta.env.VITE_ECHAT_PAYMENT_NUMBER || '').trim();

interface BuyTicketModalProps {
  event: EchatEvent;
  buyer: { id: string; name: string };
  onClose: () => void;
}

export const BuyTicketModal: React.FC<BuyTicketModalProps> = ({ event, buyer, onClose }) => {
  const remaining = ticketsRemaining(event);
  const maxQty = Math.max(1, Math.min(MAX_TICKETS_PER_ORDER, remaining));
  const isFree = event.price <= 0;
  const [qty, setQty] = useState(1);
  const [transactionId, setTransactionId] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ticket, setTicket] = useState<EventTicket | null>(null);

  useEffect(() => { if (qty > maxQty) setQty(maxQty); }, [maxQty, qty]);
  useEffect(() => {
    if (!proofFile) { setProofPreview(''); return; }
    const url = URL.createObjectURL(proofFile);
    setProofPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [proofFile]);

  const pickProof = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    if (!picked.type.startsWith('image/')) { setError('Proof must be a screenshot image (JPG, PNG or WEBP).'); return; }
    setError('');
    const compressed = await compressImage(picked, 1400, 0.8);
    if (compressed.size > 2 * 1024 * 1024) { setError('Screenshot is too large. Please choose one under 2 MB.'); return; }
    setProofFile(compressed);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (qty < 1 || qty > maxQty) { setError(`Choose between 1 and ${maxQty} tickets.`); return; }
    if (!isFree) {
      if (transactionId.trim().length < 4) { setError('Enter the transaction ID from your Orange Money / Africell Money SMS.'); return; }
      if (!proofFile) { setError('Upload a screenshot of your payment as proof.'); return; }
    }
    setBusy(true);
    try {
      const proofUrl = !isFree && proofFile ? await api.uploadFile(proofFile) : '';
      setTicket(await buyTickets(event.id, buyer, { qty, transactionId, proofUrl }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not get your ticket.';
      setError(/permission|insufficient/i.test(message) ? 'Could not save your ticket. Please sign in again and retry.' : message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`Tickets for ${event.title}`}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-slate-900"><Ticket size={20} className="text-[#1877F2]" />{ticket ? 'Your ticket' : isFree ? 'Get Free Ticket' : 'Buy Ticket'}</h2>
            <p className="truncate text-sm text-slate-500">{event.title} · {formatEventDate(event.dateTime)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-slate-100"><X size={20} /></button>
        </div>

        {ticket ? (
          <div className="space-y-3 text-center">
            <CheckCircle2 size={40} className="mx-auto text-emerald-500" />
            <p className="font-bold text-slate-900">{ticket.status === 'Confirmed' ? 'You’re in! Ticket confirmed.' : 'Ticket reserved. Waiting for payment confirmation.'}</p>
            <TicketQr ticket={ticket} size={180} className="mx-auto border border-slate-200 p-2" />
            <p className="font-mono text-lg font-black tracking-wider text-slate-900">{ticket.ticketId}</p>
            <p className="text-sm text-slate-600">{ticket.qty} × {formatLeones(ticket.unitPrice)} = <strong>{formatLeones(ticket.totalPrice)}</strong></p>
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-extrabold ${ticket.status === 'Confirmed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>{ticket.status}</span>
            <button type="button" onClick={() => { onClose(); navigateTo('/my-tickets'); }} className="min-h-12 w-full rounded-xl bg-[#1877F2] font-bold text-white">View My Tickets</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="ticket-qty" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">Quantity</label>
              <div className="flex items-center gap-2">
                {Array.from({ length: maxQty }, (_, index) => index + 1).map(value => (
                  <button key={value} type="button" onClick={() => setQty(value)} aria-pressed={qty === value} className={`h-11 w-11 rounded-xl text-sm font-extrabold ${qty === value ? 'bg-[#1877F2] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{value}</button>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-500">{remaining} ticket{remaining === 1 ? '' : 's'} left · max {MAX_TICKETS_PER_ORDER} per order</p>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-[#F2F4F7] px-4 py-3">
              <span className="text-sm text-slate-600">{qty} × {formatLeones(event.price)}</span>
              <span className="text-lg font-black text-slate-900">{isFree ? 'Free' : formatLeones(event.price * qty)}</span>
            </div>

            {!isFree && (
              <>
                <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
                  <p className="font-bold">Pay via Orange Money / Africell Money to EChat</p>
                  <p className="mt-1">Send <strong>{formatLeones(event.price * qty)}</strong> to: <strong className="font-mono">{PAYMENT_NUMBER || 'Contact EChat for number'}</strong></p>
                  <p className="mt-1 text-xs">Then enter the transaction ID from your SMS and upload a screenshot. Your ticket stays <strong>Pending</strong> until the organizer confirms payment.</p>
                </div>
                <div>
                  <label htmlFor="ticket-txn" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">Enter Transaction ID *</label>
                  <input id="ticket-txn" value={transactionId} onChange={e => setTransactionId(e.target.value)} maxLength={100} placeholder="e.g. PP240312.1534.A12345" className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm focus:border-[#1877F2] focus:outline-none" />
                </div>
                <div>
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">Payment proof *</span>
                  {proofPreview && <img src={proofPreview} alt="Payment proof preview" className="mb-2 max-h-48 w-full rounded-xl border border-slate-200 object-contain" />}
                  <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
                    <ImagePlus size={18} />{proofFile ? 'Change screenshot' : 'Upload Proof Screenshot'}
                    <input type="file" accept="image/*" className="hidden" onChange={e => void pickProof(e)} />
                  </label>
                </div>
              </>
            )}

            {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
            <button type="submit" disabled={busy || remaining <= 0} className="min-h-12 w-full rounded-xl bg-[#1877F2] font-extrabold text-white disabled:opacity-60">
              {busy ? 'Please wait…' : isFree ? `Get ${qty} Free Ticket${qty > 1 ? 's' : ''}` : 'Submit Payment'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
