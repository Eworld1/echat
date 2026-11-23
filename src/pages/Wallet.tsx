import React, { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { Briefcase, Clock, History, Plus, Send, ShieldCheck, Ticket, Wallet as WalletIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { auth } from '../services/firebase';
import {
  formatLe,
  formatLeBalance,
  formatTxDate,
  listenMyWalletTransactions,
  listenWallet,
  walletErrorMessage,
  type Wallet as WalletData,
  type WalletTransaction,
  type WalletTxStatus
} from '../services/wallet';
import { TopUpModal } from '../components/wallet/TopUpModal';

export const txStatusClass: Record<WalletTxStatus, string> = {
  Pending: 'bg-amber-100 text-amber-800',
  Approved: 'bg-emerald-100 text-emerald-700',
  Rejected: 'bg-rose-100 text-rose-700'
};

/** In-app navigation between /wallet and /admin/wallet (App.tsx listens for "echat:navigate"). */
export function navigateWallet(path: '/wallet' | '/admin/wallet'): void {
  if (window.location.pathname === path) return;
  window.history.pushState({ echatApp: true, tab: path === '/wallet' ? 'wallet' : 'adminWallet' }, '', path);
  window.dispatchEvent(new Event('echat:navigate'));
  window.scrollTo({ top: 0 });
}

/** Firebase Auth uid (the id the security rules check), updated when sign-in resolves. */
export function useFirebaseUid(): string {
  const [uid, setUid] = useState(auth.currentUser?.uid || '');
  useEffect(() => onAuthStateChanged(auth, current => setUid(current?.uid || '')), []);
  return uid;
}

const TxRows: React.FC<{ items: WalletTransaction[] }> = ({ items }) => (
  <div className="overflow-hidden rounded-xl border border-slate-100">
    <div className="grid grid-cols-[1.3fr_0.8fr_1fr_0.9fr] gap-2 bg-slate-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
      <span>Date</span><span>Type</span><span className="text-right">Amount</span><span className="text-right">Status</span>
    </div>
    <ul className="divide-y divide-slate-100">
      {items.map(tx => (
        <li key={tx.id} className="grid grid-cols-[1.3fr_0.8fr_1fr_0.9fr] items-center gap-2 px-3 py-2.5 text-xs text-slate-800 sm:text-sm">
          <span className="text-slate-600">{formatTxDate(tx.createdAt)}</span>
          <span className="font-semibold">{tx.type}</span>
          <span className="text-right font-bold">{formatLe(tx.amount)}</span>
          <span className="text-right">
            <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${txStatusClass[tx.status]}`}>{tx.status}</span>
          </span>
          {tx.status === 'Rejected' && tx.reason && <span className="col-span-4 text-[11px] text-rose-700">Reason: {tx.reason}</span>}
        </li>
      ))}
    </ul>
  </div>
);

export const Wallet: React.FC = () => {
  const { user } = useAuth();
  const uid = useFirebaseUid();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[] | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'overview' | 'history'>('overview');
  const [topUpOpen, setTopUpOpen] = useState(false);
  const roleAdmin = Boolean(user && ['admin', 'super_admin', 'developer'].includes(user.role));

  useEffect(() => {
    if (!uid) return;
    setWallet(null);
    const onError = (err: Error) => setError(walletErrorMessage(err));
    const stopWallet = listenWallet(uid, next => { setWallet(next); setError(''); }, onError);
    const stopTx = listenMyWalletTransactions(uid, setTransactions, err => { onError(err); setTransactions([]); });
    return () => { stopWallet(); stopTx(); };
  }, [uid]);

  if (!user) return <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600 shadow-sm">Sign in to see your wallet.</div>;

  const pending = wallet?.pendingBalance || 0;
  const recent = (transactions || []).slice(0, 5);
  const comingSoon = [
    { label: 'Send to Friend', icon: <Send size={20} /> },
    { label: 'Pay for Job Boost', icon: <Briefcase size={20} /> },
    { label: 'Buy Event Ticket', icon: <Ticket size={20} /> }
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-16">
      {/* Balance card */}
      <section className="rounded-2xl bg-[#1877F2] p-5 text-white shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-white/90"><WalletIcon size={18} />Wallet Balance</p>
          {roleAdmin && (
            <button type="button" onClick={() => navigateWallet('/admin/wallet')} className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-white/15 px-2.5 text-xs font-bold hover:bg-white/25">
              <ShieldCheck size={14} />Admin
            </button>
          )}
        </div>
        <p className="mt-2 break-words text-4xl font-extrabold tracking-tight sm:text-5xl" aria-live="polite">
          {wallet ? formatLeBalance(wallet.balance) : <span className="opacity-60">Le …</span>}
        </p>
        {pending > 0 && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm font-semibold"><Clock size={14} />Pending: {formatLe(pending)}</p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setTopUpOpen(true)} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white text-sm font-bold text-[#1877F2]">
            <Plus size={18} />Top-up
          </button>
          <button type="button" onClick={() => setTab(tab === 'history' ? 'overview' : 'history')} aria-pressed={tab === 'history'}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-xl text-sm font-bold ${tab === 'history' ? 'bg-white/30 text-white' : 'bg-white/15 text-white'}`}>
            <History size={18} />History
          </button>
        </div>
      </section>

      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      {tab === 'overview' ? (
        <>
          {/* Quick actions (display only in Step 1) */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-base font-extrabold text-slate-900">Quick Actions</h2>
            <div className="grid grid-cols-3 gap-2">
              {comingSoon.map(item => (
                <button key={item.label} type="button" disabled aria-disabled="true"
                  className="flex min-h-24 cursor-not-allowed flex-col items-center justify-center gap-1.5 rounded-xl bg-slate-100 p-2 text-center text-xs font-semibold text-slate-400">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-200 text-slate-400">{item.icon}</span>
                  <span className="leading-tight">{item.label}</span>
                  <span className="rounded-full bg-slate-300 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">Coming Soon</span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-extrabold text-slate-900">Recent Transactions</h2>
              {(transactions?.length || 0) > 5 && <button type="button" onClick={() => setTab('history')} className="text-sm font-bold text-[#1877F2]">See all</button>}
            </div>
            {transactions === null ? <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
              : recent.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No transactions yet. Tap Top-up to add money.</p>
                : <TxRows items={recent} />}
          </section>
        </>
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-extrabold text-slate-900">Transaction History</h2>
            <button type="button" onClick={() => setTab('overview')} className="text-sm font-bold text-[#1877F2]">Back</button>
          </div>
          {transactions === null ? <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
            : transactions.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No transactions yet.</p>
              : <TxRows items={transactions} />}
        </section>
      )}

      {topUpOpen && uid && <TopUpModal user={{ id: uid, name: user.name }} onClose={() => setTopUpOpen(false)} />}
    </div>
  );
};
