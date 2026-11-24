import React, { useState } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { ArrowLeft, KeyRound, Loader2, Mail, MailCheck, Smartphone, X } from 'lucide-react';
import { auth } from '../services/firebase';
import { AUTH_GREEN, AUTH_LIGHT, authGoldButton, authIconClass, authInputClass, useCountdown } from './VerifyCode';

interface ForgotPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Kept for callers (the reset itself happens on Firebase's page from the email link). */
  onSuccess?: () => void;
  /** Phone accounts have no password: send them to "Continue with phone" with the number filled in. */
  onUsePhone?: (phoneNumber: string) => void;
}

type Step = 'request' | 'sent' | 'phone';
const looksLikePhone = (value: string) => /^\+?[\d\s()-]{7,}$/.test(value.trim()) && !value.includes('@');
const GENERIC_SENT = 'If this account exists, we sent a password reset link to your email. Check Inbox + Spam.';

/**
 * Forgot password with Firebase Auth: sendPasswordResetEmail for ANY email, always the same answer
 * (never reveals whether an account exists). The new password is set on Firebase's page from the link.
 */
export const ForgotPasswordModal: React.FC<ForgotPasswordModalProps> = ({ isOpen, onClose, onUsePhone }) => {
  const [step, setStep] = useState<Step>('request');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [left, restart] = useCountdown(0);

  if (!isOpen) return null;

  const close = () => { setStep('request'); setError(''); setInfo(''); onClose(); };

  /** Sends the Firebase reset email. Unknown emails are treated exactly like known ones. */
  const sendLink = async (target: string): Promise<boolean> => {
    try {
      await sendPasswordResetEmail(auth, target, { url: `${window.location.origin}/home`, handleCodeInApp: false });
    } catch (err) {
      const code = String((err as { code?: string })?.code || '');
      if (code === 'auth/user-not-found' || code === 'auth/missing-email') return true; // same answer as success
      if (code === 'auth/invalid-email') { setError('That email address doesn\'t look right.'); return false; }
      if (code === 'auth/too-many-requests') { setError('Too many requests. Please wait a few minutes and try again.'); return false; }
      if (code === 'auth/network-request-failed') { setError('No internet connection. Check your network and try again.'); return false; }
      if (code === 'auth/unauthorized-continue-uri' || code === 'auth/invalid-continue-uri') {
        // Domain not yet allowed in Firebase: still send the email, just without the "Continue" button.
        try { await sendPasswordResetEmail(auth, target); return true; } catch { /* fall through */ }
      }
      setError('Could not send the email right now. Please try again.');
      return false;
    }
    return true;
  };

  const request = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const value = identifier.trim();
    if (looksLikePhone(value)) { setError(''); setStep('phone'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) { setError('Enter your registered email address.'); return; }
    setBusy(true); setError(''); setInfo('');
    const sent = await sendLink(value.toLowerCase());
    setBusy(false);
    if (sent) { setEmail(value.toLowerCase()); restart(60); setStep('sent'); }
  };

  const resend = async () => {
    setBusy(true); setError(''); setInfo('');
    if (await sendLink(email)) { restart(60); setInfo('We sent the link again.'); }
    setBusy(false);
  };

  let content: React.ReactNode;
  if (step === 'request') {
    content = (
      <form onSubmit={request} className="space-y-4" noValidate>
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-[#fdf6e3] text-[#a87b22] ring-2 ring-[#e9cf8a]"><KeyRound size={26} /></span>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-[#111111]">Reset Password</h1>
          <p className="text-[14px] leading-snug text-[#4b5563]">Enter your registered email and we'll send you a password reset link</p>
        </div>
        <div className="relative">
          <input type="text" inputMode="email" value={identifier} onChange={event => { setIdentifier(event.target.value); setError(''); }} placeholder="Email or phone number" autoComplete="username" autoCapitalize="off" spellCheck={false} required className={authInputClass} style={AUTH_LIGHT} />
          {looksLikePhone(identifier) ? <Smartphone size={18} strokeWidth={1.8} className={authIconClass} /> : <Mail size={19} strokeWidth={1.8} className={authIconClass} />}
        </div>
        {error && <p role="alert" className="text-center text-[13px] font-semibold text-[#dc2626]">{error}</p>}
        <button type="submit" disabled={busy} className={authGoldButton}>{busy ? <><Loader2 size={19} className="animate-spin" />Sending…</> : 'Send Reset Link'}</button>
      </form>
    );
  } else if (step === 'sent') {
    content = (
      <div className="space-y-4 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#fdf6e3] text-[#a87b22] ring-2 ring-[#e9cf8a]"><MailCheck size={26} /></span>
        <h1 className="text-[26px] font-extrabold leading-tight text-[#111111]">Check your email</h1>
        <p className="text-[14px] leading-snug text-[#4b5563]">{GENERIC_SENT}<br /><b className="break-all text-[#111827]">{email}</b></p>
        <ol className="space-y-1.5 rounded-2xl bg-[#fdf6e3] p-3 text-left text-[13px] leading-snug text-[#4b5563]">
          <li><b className="text-[#8a6d1f]">1.</b> Open the email from eChat (check <b>Inbox</b> and <b>Spam</b>).</li>
          <li><b className="text-[#8a6d1f]">2.</b> Click the link and choose a new password.</li>
          <li><b className="text-[#8a6d1f]">3.</b> Come back and log in with your new password.</li>
        </ol>
        {error && <p role="alert" className="text-[13px] font-semibold text-[#dc2626]">{error}</p>}
        {info && !error && <p role="status" className="text-[13px] font-semibold text-[#15803d]">{info}</p>}
        <button type="button" onClick={close} className={authGoldButton}>Back to Log In</button>
        <div className="text-[13px] text-[#4b5563]">
          {left > 0
            ? <span>Resend link in <b className="tabular-nums text-[#111827]">00:{String(left).padStart(2, '0')}</b></span>
            : <button type="button" onClick={() => void resend()} disabled={busy} className={`font-bold ${AUTH_GREEN} hover:underline disabled:opacity-60`}>{busy ? 'Sending…' : 'Resend link'}</button>}
        </div>
        <button type="button" onClick={() => { setStep('request'); setError(''); setInfo(''); }} className="mx-auto flex items-center gap-1 text-[13px] font-semibold text-[#6b7280] hover:text-[#1f4d1f]"><ArrowLeft size={15} />Use a different email</button>
      </div>
    );
  } else {
    content = (
      <div className="space-y-4 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#fdf6e3] text-[#a87b22] ring-2 ring-[#e9cf8a]"><Smartphone size={26} /></span>
        <h1 className="text-[26px] font-extrabold leading-tight text-[#111111]">Use your phone</h1>
        <p className="text-[14px] leading-snug text-[#4b5563]">Accounts made with a phone number don't use a password. Log in with a code sent by SMS instead.</p>
        {onUsePhone && <button type="button" onClick={() => { onUsePhone(identifier.trim()); close(); }} className={authGoldButton}>Send SMS Code</button>}
        <button type="button" onClick={() => setStep('request')} className={`text-[13px] font-semibold ${AUTH_GREEN} hover:underline`}>Use my email instead</button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-[#000000]/55 p-4 backdrop-blur-[3px]" style={AUTH_LIGHT} role="dialog" aria-modal="true" aria-label="Reset Password">
      <div className="relative my-auto w-full max-w-[400px] rounded-[26px] border border-[#e2c06e] bg-[#ffffff] px-6 pb-6 pt-8 shadow-[0_0_0_1px_rgba(255,226,150,0.35),0_0_28px_6px_rgba(240,196,92,0.45)] sm:px-8">
        <button type="button" onClick={close} aria-label="Close" className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full text-[#6b7280] hover:bg-[#f3f4f6]"><X size={20} /></button>
        {content}
      </div>
    </div>
  );
};
