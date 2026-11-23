import {
  collection,
  doc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  where,
  writeBatch,
  type Unsubscribe
} from 'firebase/firestore';
import { db } from './firebase';

/**
 * EChat Wallet — Step 1: balance, manual Orange Money / Africell Money top-ups, admin approval.
 *
 * Money safety lives in firestore.rules (wallets / walletTransactions):
 * - a user can never change `balance`;
 * - a user can only raise `pendingBalance` by exactly the amount of a NEW Pending top-up
 *   written in the same atomic batch;
 * - only an admin can move a Pending top-up to Approved / Rejected, and that same batch must move
 *   exactly that amount from pendingBalance into balance (Approved) or drop it (Rejected).
 *   A top-up can be reviewed only once.
 */

export type WalletTxStatus = 'Pending' | 'Approved' | 'Rejected';

export interface Wallet {
  userId: string;
  balance: number;
  pendingBalance: number;
  updatedAt: number;
}

export interface WalletTransaction {
  id: string;
  userId: string;
  userName: string;
  type: 'Top-up';
  amount: number;
  status: WalletTxStatus;
  transactionId: string;
  proofUrl: string;
  createdAt: number;
  reviewedAt?: number;
  reviewedBy?: string;
  reason?: string;
}

export const TOPUP_PRESETS = [50_000, 100_000, 200_000, 500_000] as const;
export const MIN_TOPUP = 1_000;
export const MAX_TOPUP = 100_000_000;
export const MAX_REASON_LENGTH = 300;

/** Vite only exposes VITE_* variables; NEXT_PUBLIC_* is not read by this app. */
export const PAYMENT_NUMBER = String(import.meta.env.VITE_ECHAT_PAYMENT_NUMBER || '').trim();

/** "Le 100,000" */
export const formatLe = (amount: number) => `Le ${Math.round(amount).toLocaleString('en-US')}`;
/** "Le 100,000.00" (balance display) */
export const formatLeBalance = (amount: number) =>
  `Le ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const formatTxDate = (ms: number) =>
  ms ? new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

/** Checks a whole-Leone top-up amount. Returns an error message, or '' when valid. */
export function topUpAmountError(amount: number): string {
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) return 'Enter a whole amount in Leones.';
  if (amount < MIN_TOPUP) return `Minimum top-up is ${formatLe(MIN_TOPUP)}.`;
  if (amount > MAX_TOPUP) return `Maximum top-up is ${formatLe(MAX_TOPUP)}.`;
  return '';
}

const walletRef = (userId: string) => doc(db, 'wallets', userId);

function toWallet(userId: string, data: Record<string, unknown> | undefined): Wallet {
  return {
    userId,
    balance: Number(data?.balance || 0),
    pendingBalance: Math.max(0, Number(data?.pendingBalance || 0)),
    updatedAt: Number(data?.updatedAt || 0)
  };
}

function toTx(id: string, data: Record<string, unknown>): WalletTransaction {
  const status = String(data.status || 'Pending');
  return {
    id,
    userId: String(data.userId || ''),
    userName: String(data.userName || ''),
    type: 'Top-up',
    amount: Number(data.amount || 0),
    status: status === 'Approved' || status === 'Rejected' ? status : 'Pending',
    transactionId: String(data.transactionId || ''),
    proofUrl: String(data.proofUrl || ''),
    createdAt: Number(data.createdAt || 0),
    reviewedAt: data.reviewedAt ? Number(data.reviewedAt) : undefined,
    reviewedBy: data.reviewedBy ? String(data.reviewedBy) : undefined,
    reason: data.reason ? String(data.reason) : undefined
  };
}

/** Creates the user's wallet at Le 0 the first time (never overwrites an existing one). */
export async function ensureWallet(userId: string): Promise<void> {
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(walletRef(userId));
    if (snapshot.exists()) return;
    transaction.set(walletRef(userId), { userId, balance: 0, pendingBalance: 0, lastTxId: '', updatedAt: Date.now() });
  });
}

/** Live wallet for the signed-in user. Creates it on first visit. */
export function listenWallet(userId: string, onWallet: (wallet: Wallet) => void, onError: (error: Error) => void): Unsubscribe {
  let creating = false;
  return onSnapshot(walletRef(userId), snapshot => {
    if (!snapshot.exists()) {
      onWallet(toWallet(userId, undefined));
      if (!creating) {
        creating = true;
        ensureWallet(userId).catch(onError);
      }
      return;
    }
    onWallet(toWallet(userId, snapshot.data()));
  }, onError);
}

/** The user's own transactions, newest first. */
export function listenMyWalletTransactions(userId: string, onItems: (items: WalletTransaction[]) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'walletTransactions'), where('userId', '==', userId)), snapshot => {
    onItems(snapshot.docs.map(item => toTx(item.id, item.data())).sort((a, b) => b.createdAt - a.createdAt));
  }, onError);
}

export interface TopUpInput {
  amount: number;
  transactionId: string;
  proofUrl: string;
}

/**
 * Submits a Pending top-up. The balance does NOT change; only pendingBalance goes up,
 * in the same atomic batch as the transaction document.
 */
export async function submitTopUp(user: { id: string; name: string }, input: TopUpInput): Promise<WalletTransaction> {
  const amount = Math.round(input.amount);
  const amountError = topUpAmountError(amount);
  if (amountError) throw new Error(amountError);
  const transactionId = input.transactionId.trim().slice(0, 100);
  if (transactionId.length < 4) throw new Error('Enter the Transaction ID from your Orange Money / Africell Money SMS.');
  if (!input.proofUrl) throw new Error('Upload a screenshot of your payment as proof.');

  await ensureWallet(user.id);
  const txRef = doc(collection(db, 'walletTransactions'));
  const tx: WalletTransaction = {
    id: txRef.id,
    userId: user.id,
    userName: (user.name || 'EChat user').slice(0, 120),
    type: 'Top-up',
    amount,
    status: 'Pending',
    transactionId,
    proofUrl: input.proofUrl,
    createdAt: Date.now()
  };
  const batch = writeBatch(db);
  batch.set(txRef, tx);
  batch.update(walletRef(user.id), { pendingBalance: increment(amount), lastTxId: txRef.id, updatedAt: Date.now() });
  await batch.commit();
  return tx;
}

// ---------------- Admin ----------------

/** Pending top-ups (admin only — the rules deny this query to everyone else). */
export function listenPendingTopUps(onItems: (items: WalletTransaction[]) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'walletTransactions'), where('status', '==', 'Pending')), snapshot => {
    onItems(snapshot.docs.map(item => toTx(item.id, item.data())).sort((a, b) => a.createdAt - b.createdAt));
  }, onError);
}

/** Latest transactions of every status (admin only), used for history and duplicate-ID warnings. */
export function listenRecentTopUps(onItems: (items: WalletTransaction[]) => void, onError: (error: Error) => void, max = 200): Unsubscribe {
  return onSnapshot(query(collection(db, 'walletTransactions'), orderBy('createdAt', 'desc'), limit(max)), snapshot => {
    onItems(snapshot.docs.map(item => toTx(item.id, item.data())));
  }, onError);
}

/**
 * Approve: balance += amount, pendingBalance -= amount, status Approved.
 * Reject: pendingBalance -= amount, balance unchanged, status Rejected (+ optional reason).
 * Both writes are one atomic batch; the rules refuse a second review of the same top-up.
 */
export async function reviewTopUp(tx: WalletTransaction, decision: 'Approved' | 'Rejected', adminId: string, reason = ''): Promise<void> {
  if (tx.status !== 'Pending') throw new Error('This top-up was already reviewed.');
  const batch = writeBatch(db);
  const update: Record<string, unknown> = { status: decision, reviewedAt: Date.now(), reviewedBy: adminId };
  const cleanReason = reason.trim().slice(0, MAX_REASON_LENGTH);
  if (decision === 'Rejected' && cleanReason) update.reason = cleanReason;
  batch.update(doc(db, 'walletTransactions', tx.id), update);
  batch.update(walletRef(tx.userId), {
    ...(decision === 'Approved' ? { balance: increment(tx.amount) } : {}),
    pendingBalance: increment(-tx.amount),
    lastTxId: tx.id,
    updatedAt: Date.now()
  });
  await batch.commit();
}

/** Readable message for Firestore permission errors. */
export function walletErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code || '';
  if (code === 'permission-denied') return 'Permission denied. Make sure you are signed in (and that the latest Firestore rules are deployed).';
  if (code === 'unavailable') return 'You appear to be offline. Check your connection and try again.';
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
