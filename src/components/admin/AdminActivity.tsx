import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../../services/api';
import type { AuditEntry } from '../../types/admin';

const LABELS: Record<string, { text: string; color: string }> = {
  'user.block': { text: 'Blocked a user', color: 'bg-red-100 text-red-700' },
  'user.unblock': { text: 'Unblocked a user', color: 'bg-emerald-100 text-emerald-700' },
  'user.verify': { text: 'Verified a user', color: 'bg-blue-100 text-blue-700' },
  'user.unverify': { text: 'Removed verification', color: 'bg-slate-200 text-slate-700' },
  'user.delete': { text: 'Deleted an account', color: 'bg-red-100 text-red-700' },
  'post.delete': { text: 'Deleted a post', color: 'bg-red-100 text-red-700' },
  'report.dismiss': { text: 'Dismissed a report', color: 'bg-amber-100 text-amber-700' },
  'announcement.send': { text: 'Sent an announcement', color: 'bg-purple-100 text-purple-700' },
  'admin.claim': { text: 'Activated admin access', color: 'bg-purple-100 text-purple-700' }
};

const PAGE = 15;

export const AdminActivity: React.FC = () => {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setLogs(await api.getAdminAudit(500)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load the activity log'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const id = setInterval(load, 20000); return () => clearInterval(id); }, [load]);

  const shown = useMemo(() => (filter === 'all' ? logs : logs.filter(l => l.action.startsWith(filter))), [logs, filter]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const rows = shown.slice(page * PAGE, page * PAGE + PAGE);
  useEffect(() => { setPage(0); }, [filter]);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base font-extrabold text-slate-900">Admin activity log</h3>
          <p className="text-xs text-slate-500">Every administrative action, with who did it and when.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={filter} onChange={e => setFilter(e.target.value)} className="text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2">
            <option value="all">All actions</option>
            <option value="user.">Users</option>
            <option value="post.">Posts</option>
            <option value="report.">Reports</option>
            <option value="announcement.">Announcements</option>
          </select>
          <button onClick={load} className="p-2 rounded-lg bg-slate-50 border border-slate-200 hover:bg-slate-100" aria-label="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      {error && <p className="text-xs font-bold text-red-600 mb-3">{error}</p>}
      {!error && shown.length === 0 && <p className="py-8 text-center text-sm text-slate-400">No activity recorded yet.</p>}

      <ul className="divide-y divide-slate-100">
        {rows.map(l => {
          const label = LABELS[l.action] ?? { text: l.action, color: 'bg-slate-100 text-slate-700' };
          return (
            <li key={l.id} className="py-3 flex items-start gap-3 text-xs">
              <span className={`px-2 py-1 rounded-lg font-extrabold whitespace-nowrap ${label.color}`}>{label.text}</span>
              <div className="flex-1 min-w-0">
                <p className="text-slate-800"><strong>{l.actorName}</strong>{l.targetName ? <> → <strong>{l.targetName}</strong></> : null}</p>
                {l.details && <p className="text-slate-500 break-words">{l.details}</p>}
              </div>
              <span className="text-slate-400 whitespace-nowrap">{new Date(l.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </li>
          );
        })}
      </ul>

      {pages > 1 && (
        <div className="flex items-center justify-between mt-4 text-xs">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 rounded-lg bg-slate-100 font-bold disabled:opacity-40">Previous</button>
          <span className="text-slate-500">Page {page + 1} of {pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded-lg bg-slate-100 font-bold disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
};
