import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Loader2, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  formatLe,
  formatTxDate,
  listenPendingTopUps,
  listenRecentTopUps,
  MAX_REASON_LENGTH,
  reviewTopUp,
  walletErrorMessage,
  type WalletTransaction
} from '../services/wallet';
import { navigateWallet, txStatusClass, useFirebaseUid } from './Wallet';

/** Proof links come from users: only allow http(s) and same-site /uploads URLs (never javascript: etc). */
const safeProofUrl = (value: string) => (/^(https?:\/\/|\/uploads\/)/i.test(value) ? value : '');

const normalizeRef = (value: string) => value.trim().toUpperCase();

const PendingCard: React.FC<{ tx: WalletTransaction; adminId: string; duplicates: WalletTransaction[] }> = ({ tx, adminId, duplicates }) => {
  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const proofUrl = safeProofUrl(tx.proofUrl);

  const run = async (decision: 'Approved' | 'Rejected') => {
    setBusy(true);
    setError('');
    try {
      await reviewTopUp(tx, decision, adminId, reason);
    } catch (err) {
      setError(walletErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex gap-3">
        {proofUrl ? (
          <a href={proofUrl} target="_blank" rel="noopener noreferrer" className="block h-20 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100" aria-label={`Open payment proof from ${tx.userName}`}>
            <img src={proofUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
          </a>
        ) : <div className="grid h-20 w-16 shrink-0 place-items-center rounded-lg bg-slate-100 text-[10px] text-slate-500">No proof</div>}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold text-slate-900">{tx.userName || 'Unknown user'}</p>
          <p className="text-xl font-extrabold text-[#1877F2]">{formatLe(tx.amount)}</p>
          <p className="break-all text-xs text-slate-600">Transaction ID: <span className="font-mono font-bold text-slate-800">{tx.transactionId}</span></p>
          <p className="text-xs text-slate-500">{formatTxDate(tx.createdAt)}</p>
          {proofUrl && <a href={proofUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-[#1877F2]">View proof<ExternalLink size={12} /></a>}
        </div>
      </div>

      {duplicates.length > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-900">
          <AlertTriangle size={15} className="mt-px shrink-0" />
          This Transaction ID was also used in {duplicates.length} other top-up{duplicates.length === 1 ? '' : 's'} ({duplicates.map(item => `${item.userName || 'user'} · ${item.status}`).join(', ')}). Check before approving.
        </p>
      )}

      {error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p>}

      {mode === 'idle' && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setMode('approve')} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-sm font-bold text-white"><Check size={17} />Approve</button>
          <button type="button" onClick={() => setMode('reject')} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-rose-300 text-sm font-bold text-rose-700"><X size={17} />Reject</button>
        </div>
      )}

      {mode === 'approve' && (
        <div className="mt-3 rounded-xl bg-emerald-50 p-3">
          <p className="text-sm text-emerald-900">Add <strong>{formatLe(tx.amount)}</strong> to {tx.userName || 'this user'}'s wallet? Only approve if the money arrived.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => void run('Approved')} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-sm font-bold text-white disabled:opacity-60">{busy && <Loader2 size={16} className="animate-spin" />}Confirm Approve</button>
            <button type="button" disabled={busy} onClick={() => setMode('idle')} className="min-h-11 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700">Cancel</button>
          </div>
        </div>
      )}

      {mode === 'reject' && (
        <div className="mt-3 rounded-xl bg-rose-50 p-3">
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-rose-900">Reason (optional, shown to the user)</span>
            <input value={reason} onChange={event => setReason(event.target.value)} maxLength={MAX_REASON_LENGTH} placeholder="e.g. Payment not received"
              className="min-h-11 w-full rounded-xl border border-rose-200 bg-white px-3 text-sm outline-none focus:border-rose-400" />
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => void run('Rejected')} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-rose-600 text-sm font-bold text-white disabled:opacity-60">{busy && <Loader2 size={16} className="animate-spin" />}Confirm Reject</button>
            <button type="button" disabled={busy} onClick={() => setMode('idle')} className="min-h-11 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700">Cancel</button>
          </div>
        </div>
      )}
    </li>
  );
};

export const AdminWallet: React.FC = () => {
  const { user } = useAuth();
  const uid = useFirebaseUid();
  const [pending, setPending] = useState<WalletTransaction[] | null>(null);
  const [recent, setRecent] = useState<WalletTransaction[]>([]);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!uid) return;
    setDenied(false);
    setPending(null);
    const onError = (err: Error & { code?: string }) => {
      if (err.code === 'permission-denied') setDenied(true);
      else setError(walletErrorMessage(err));
    };
    const stopPending = listenPendingTopUps(items => { setPending(items); setError(''); }, onError);
    const stopRecent = listenRecentTopUps(setRecent, () => { /* history is optional; pending list reports errors */ });
    return () => { stopPending(); stopRecent(); };
  }, [uid]);

  const duplicatesFor = useMemo(() => {
    const byRef = new Map<string, WalletTransaction[]>();
    for (const tx of [...recent, ...(pending || [])]) {
      const key = normalizeRef(tx.transactionId);
      const list = byRef.get(key) || [];
      if (!list.some(item => item.id === tx.id)) list.push(tx);
      byRef.set(key, list);
    }
    return (tx: WalletTransaction) => (byRef.get(normalizeRef(tx.transactionId)) || []).filter(item => item.id !== tx.id);
  }, [recent, pending]);

  if (!user || !uid || denied) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <ShieldAlert size={44} className="mx-auto mb-2 text-rose-500" />
        <h1 className="text-xl font-extrabold text-slate-900">Access Denied</h1>
        <p className="mt-1 text-sm text-slate-600">Only EChat admins can review wallet top-ups.</p>
        <button type="button" onClick={() => navigateWallet('/wallet')} className="mt-4 min-h-11 rounded-xl bg-[#1877F2] px-5 text-sm font-bold text-white">Go to my Wallet</button>
      </div>
    );
  }

  const reviewed = recent.filter(tx => tx.status !== 'Pending').slice(0, 20);
  const pendingTotal = (pending || []).reduce((sum, tx) => sum + tx.amount, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-16">
      <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h1 className="flex items-center gap-2 text-xl font-extrabold text-slate-900"><ShieldCheck className="text-[#1877F2]" />Admin · Wallet Top-ups</h1>
        {pending && <p className="mt-1 text-sm text-slate-600">{pending.length} pending · {formatLe(pendingTotal)} waiting for approval</p>}
      </header>

      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      {pending === null ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Checking access…</div>
      ) : pending.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">No pending top-ups. 🎉</div>
      ) : (
        <ul className="space-y-3">
          {pending.map(tx => <PendingCard key={tx.id} tx={tx} adminId={uid} duplicates={duplicatesFor(tx)} />)}
        </ul>
      )}

      {reviewed.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-base font-extrabold text-slate-900">Recently reviewed</h2>
          <ul className="divide-y divide-slate-100">
            {reviewed.map(tx => (
              <li key={tx.id} className="flex items-center gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900">{tx.userName || 'Unknown user'} · {formatLe(tx.amount)}</p>
                  <p className="truncate text-xs text-slate-500">{formatTxDate(tx.reviewedAt || tx.createdAt)} · <span className="font-mono">{tx.transactionId}</span>{tx.reason ? ` · ${tx.reason}` : ''}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${txStatusClass[tx.status]}`}>{tx.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
