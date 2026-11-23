import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ticketQrPayload, type EventTicket } from '../../services/eventTickets';

/** QR image (ticket ID + event ID) shown to the gate for check-in. */
export const TicketQr: React.FC<{ ticket: Pick<EventTicket, 'ticketId' | 'eventId'>; size?: number; className?: string }> = ({ ticket, size = 160, className = '' }) => {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(ticketQrPayload(ticket), { width: size * 2, margin: 1, errorCorrectionLevel: 'M' })
      .then(url => { if (active) setSrc(url); })
      .catch(() => { if (active) setSrc(''); });
    return () => { active = false; };
  }, [ticket.ticketId, ticket.eventId, size]);
  return src
    ? <img src={src} width={size} height={size} alt={`QR code for ticket ${ticket.ticketId}`} className={`rounded-lg bg-white ${className}`} />
    : <div style={{ width: size, height: size }} className={`grid place-items-center rounded-lg bg-slate-100 text-xs text-slate-400 ${className}`}>QR…</div>;
};
