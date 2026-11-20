import React, { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle, CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react';
import { auth } from '../../services/firebase';

type AIStatus = { openAiConnected: boolean; fallbackMode: boolean };

export const EchatAISettings: React.FC = () => {
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) { setError('Please sign in again to check eChat AI status.'); return; }
    setLoading(true); setError('');
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/v2/ai/status', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 403 ? 'This status is available to the super-admin only.' : 'Could not check eChat AI status. Try again.');
      setStatus(body as AIStatus);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not check eChat AI status. Try again.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  return <section className="max-w-3xl space-y-4 animate-in fade-in">
    <header className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-amber-100 text-amber-800"><Bot size={22}/></span><div><h2 className="text-lg font-extrabold text-slate-900">eChat AI Settings</h2><p className="text-sm text-slate-500">Provider status for the AI assistant. Secret credentials are never shown here.</p></div></div>
        <button onClick={() => void refresh()} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-100 px-4 text-sm font-bold text-slate-700 disabled:opacity-60"><RefreshCw size={15} className={loading ? 'animate-spin' : ''}/>Refresh status</button>
      </div>
    </header>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">OpenAI Connected</p><p className="mt-2 flex items-center gap-2 text-lg font-extrabold text-slate-900">{loading&&!status?<LoaderCircle size={18} className="animate-spin"/>:status?.openAiConnected?<CheckCircle size={18} className="text-emerald-600"/>:<CircleAlert size={18} className="text-amber-600"/>}{loading&&!status?'Checking…':status?status.openAiConnected?'YES':'NO':'Not checked'}</p></div>
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Fallback Mode</p><p className="mt-2 flex items-center gap-2 text-lg font-extrabold text-emerald-700"><CheckCircle size={18}/>ON</p><p className="mt-1 text-xs text-slate-500">eChat AI can keep replying when the provider is unavailable.</p></div>
    </div>
  </section>;
};
