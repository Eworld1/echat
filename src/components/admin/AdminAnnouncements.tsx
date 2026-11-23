import React, { useEffect, useState } from 'react';
import { Megaphone, Send } from 'lucide-react';
import { api } from '../../services/api';
import type { AuditEntry } from '../../types/admin';

const MAX = 500;

export const AdminAnnouncements: React.FC = () => {
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [history, setHistory] = useState<AuditEntry[]>([]);

  const loadHistory = () => api.getAdminAudit(400).then(l => setHistory(l.filter(e => e.action === 'announcement.send').slice(0, 10))).catch(() => {});
  useEffect(() => { void loadHistory(); }, []);

  const send = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api.sendAnnouncement(message.trim());
      setNotice({ ok: true, text: `Sent to ${r.sent} people.` });
      setMessage('');
      setConfirming(false);
      void loadHistory();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : 'Could not send the announcement' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <div className="lg:col-span-3 bg-white border border-slate-200 rounded-2xl p-5">
        <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2"><Megaphone size={18} className="text-purple-600" /> Send an announcement</h3>
        <p className="text-xs text-slate-500 mt-1 mb-4">Everyone receives it in their notifications immediately (people who are online see a pop-up). Use it for maintenance, new features or important news.</p>
        <textarea
          value={message}
          onChange={e => { setMessage(e.target.value.slice(0, MAX)); setConfirming(false); }}
          rows={5}
          placeholder="Write your announcement..."
          className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
        />
        <div className="flex items-center justify-between mt-2">
          <span className={`text-[11px] ${message.length > MAX - 50 ? 'text-amber-600' : 'text-slate-400'}`}>{message.length}/{MAX}</span>
          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              disabled={message.trim().length < 3}
              className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-bold inline-flex items-center gap-2"
            ><Send size={14} /> Review & send</button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-700">Send to everyone?</span>
              <button onClick={() => setConfirming(false)} className="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold">Edit</button>
              <button onClick={send} disabled={busy} className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-bold">{busy ? 'Sending...' : 'Yes, send'}</button>
            </div>
          )}
        </div>
        {notice && <p className={`mt-3 text-xs font-bold ${notice.ok ? 'text-emerald-600' : 'text-red-600'}`}>{notice.text}</p>}
      </div>

      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-5">
        <h3 className="text-sm font-extrabold text-slate-900 mb-3">Recent announcements</h3>
        {history.length === 0 && <p className="text-xs text-slate-400">None sent yet.</p>}
        <ul className="space-y-3">
          {history.map(h => (
            <li key={h.id} className="text-xs border-b border-slate-100 pb-2.5 last:border-0">
              <p className="text-slate-800 font-semibold break-words">{(h.details || '').replace(/^\d+ people: /, '')}</p>
              <p className="text-slate-400 mt-0.5">{new Date(h.createdAt).toLocaleString()} · {(h.details || '').match(/^(\d+) people/)?.[1] ?? '?'} people</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
