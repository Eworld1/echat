import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Keyboard, XCircle } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { useAuth } from '../../context/AuthContext';
import { auth } from '../../services/firebase';
import { checkInTicket, listenEvent, parseTicketQr, type CheckInResult, type EchatEvent } from '../../services/eventTickets';
import { formatEventDate, navigateTo } from '../../utils/eventsNav';
import { isEventsAdmin } from './EventDetailPage';

const SCANNER_ID = 'echat-ticket-scanner';

export const EventCheckinPage: React.FC<{ eventId: string }> = ({ eventId }) => {
  const { user } = useAuth();
  const uid = auth.currentUser?.uid || '';
  const [event, setEvent] = useState<EchatEvent | null | undefined>(undefined);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [cameraError, setCameraError] = useState('');
  const [manualId, setManualId] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const lastScanRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });

  useEffect(() => listenEvent(eventId, setEvent, () => setEvent(null)), [eventId]);
  const allowed = Boolean(event && uid && (event.creatorId === uid || isEventsAdmin(user)));

  const handleCode = async (text: string) => {
    const now = Date.now();
    // Ignore the same code read again within 3 seconds (the camera sees it many times per second).
    if (busyRef.current || (lastScanRef.current.text === text && now - lastScanRef.current.at < 3000)) return;
    lastScanRef.current = { text, at: now };
    const parsed = parseTicketQr(text);
    if (!parsed) { setResult({ ok: false, reason: 'Not an EChat ticket QR code.' }); return; }
    busyRef.current = true;
    setBusy(true);
    try {
      setResult(await checkInTicket(parsed, eventId, uid));
      if ('vibrate' in navigator) navigator.vibrate?.(120);
    } catch (error) {
      setResult({ ok: false, reason: error instanceof Error ? error.message : 'Check-in failed.' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const handleCodeRef = useRef(handleCode);
  handleCodeRef.current = handleCode;

  useEffect(() => {
    if (!allowed) return;
    const scanner = new Html5Qrcode(SCANNER_ID, { verbose: false });
    let started = false;
    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: (width, height) => { const size = Math.floor(Math.min(width, height) * 0.7); return { width: size, height: size }; } },
      text => { void handleCodeRef.current(text); },
      () => { /* no QR in this frame */ }
    ).then(() => { started = true; setCameraError(''); })
      .catch(error => setCameraError(error instanceof Error ? error.message : 'Camera unavailable. Allow camera access or enter the ticket ID below.'));
    return () => {
      if (started) void scanner.stop().then(() => scanner.clear()).catch(() => {});
    };
  }, [allowed]);

  if (event === undefined) return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!event || !allowed) return (
    <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-lg font-extrabold text-slate-900">{event ? 'Only the event creator can check people in' : 'Event not found'}</h1>
      <button type="button" onClick={() => navigateTo(event ? `/events/${eventId}` : '/events')} className="mt-4 rounded-xl bg-[#1877F2] px-4 py-2.5 text-sm font-bold text-white">Back</button>
    </div>
  );

  return (
    <div className="mx-auto max-w-xl space-y-4 pb-16">
      <button type="button" onClick={() => navigateTo(`/events/${eventId}`)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm"><ArrowLeft size={16} />Back to event</button>
      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Check-in</h1>
          <p className="text-sm text-slate-500">{event.title} · {formatEventDate(event.dateTime)}</p>
        </div>
        <div id={SCANNER_ID} className="overflow-hidden rounded-xl bg-black [&_video]:w-full" style={{ minHeight: 260 }} />
        {cameraError && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{cameraError}</p>}
        {busy && <p role="status" className="text-center text-sm text-slate-500">Checking ticket…</p>}
        {result && (
          <div role="status" className={`flex items-start gap-3 rounded-xl p-4 ${result.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900'}`}>
            {result.ok ? <CheckCircle2 className="shrink-0 text-emerald-600" size={28} /> : <XCircle className="shrink-0 text-rose-600" size={28} />}
            <div>
              <p className="text-base font-extrabold">{result.ok ? `Checked in · Admit ${result.ticket.qty}` : 'Not admitted'}</p>
              {'reason' in result && <p className="text-sm">{result.reason}</p>}
              {result.ticket && <p className="mt-1 text-sm">{result.ticket.buyerName} · <span className="font-mono">{result.ticket.ticketId}</span> · {result.ticket.qty} ticket{result.ticket.qty === 1 ? '' : 's'}</p>}
            </div>
          </div>
        )}
        <form onSubmit={e => { e.preventDefault(); lastScanRef.current = { text: '', at: 0 }; void handleCode(manualId.trim().toUpperCase()); }} className="flex gap-2">
          <label htmlFor="manual-ticket" className="sr-only">Ticket ID</label>
          <input id="manual-ticket" value={manualId} onChange={e => setManualId(e.target.value)} placeholder="Or type Ticket ID (ECH-XXXXXX)" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-3 font-mono text-sm uppercase" />
          <button type="submit" disabled={!manualId.trim() || busy} className="flex min-h-11 items-center gap-1.5 rounded-xl bg-[#1877F2] px-4 text-sm font-bold text-white disabled:opacity-50"><Keyboard size={16} />Check</button>
        </form>
      </section>
    </div>
  );
};
