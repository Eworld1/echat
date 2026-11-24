import React, { useState } from 'react';
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Lock, Mail, Smartphone, X } from 'lucide-react';
import { api } from '../services/api';
import { AUTH_GREEN, AUTH_LIGHT, VerifyCodeStep, authGoldButton, authIconClass, authInputClass } from './VerifyCode';

interface ForgotPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** Phone accounts have no password: send them to "Continue with phone" with the number filled in. */
  onUsePhone?: (phoneNumber: string) => void;
}

type Step = 'request' | 'code' | 'phone' | 'done';
const looksLikePhone = (value: string) => /^\+?[\d\s()-]{7,}$/.test(value.trim()) && !value.includes('@');

/**
 * Forgot password: email → 6-digit code (emailed by the server) + new password.
 * The answer is the same whether or not the email is registered.
 */
export const ForgotPasswordModal: React.FC<ForgotPasswordModalProps> = ({ isOpen, onClose, onSuccess, onUsePhone }) => {
  const [step, setStep] = useState<Step>('request');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(60);

  if (!isOpen) return null;

  const close = () => {
    setStep('request'); setError(''); setNewPassword(''); setConfirmPassword('');
    onClose();
  };

  const requestCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const value = identifier.trim();
    if (looksLikePhone(value)) { setError(''); setStep('phone'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) { setError('Enter your registered email address.'); return; }
    setBusy(true); setError('');
    try {
      const res = await api.verifyRequest('reset/send', { email: value.toLowerCase() });
      setCooldown(res.resendAfterSeconds || 60);
      setEmail(value.toLowerCase());
      setStep('code');
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'resend-too-soon') { setEmail(value.toLowerCase()); setCooldown((err as { retryAfter?: number }).retryAfter || 60); setStep('code'); }
      else setError(err instanceof Error ? err.message : 'Could not send a code. Please try again.');
    } finally { setBusy(false); }
  };

  const verifyAndReset = async (code: string) => {
    if (newPassword.length < 6) throw new Error('Your new password must be at least 6 characters.');
    if (newPassword !== confirmPassword) throw new Error('The two passwords don\'t match.');
    await api.verifyRequest('reset/confirm', { email, code, newPassword });
    setStep('done');
  };

  const passwordInput = (value: string, setValue: (value: string) => void, placeholder: string, id: string) => (
    <div className="relative">
      <input id={id} type={showPassword ? 'text' : 'password'} value={value} onChange={event => setValue(event.target.value)} placeholder={placeholder} autoComplete="new-password" minLength={6} required className={`${authInputClass} pr-12`} style={AUTH_LIGHT} />
      <Lock size={18} strokeWidth={1.8} className={authIconClass} />
      <button type="button" onClick={() => setShowPassword(shown => !shown)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-1.5 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-lg text-[#374151] hover:bg-[#e5e7eb]">
        {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
      </button>
    </div>
  );

  let content: React.ReactNode;
  if (step === 'request') {
    content = (
      <form onSubmit={requestCode} className="space-y-4" noValidate>
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-[#fdf6e3] text-[#a87b22] ring-2 ring-[#e9cf8a]"><KeyRound size={26} /></span>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-[#111111]">Reset Password</h1>
          <p className="text-[14px] leading-snug text-[#4b5563]">Enter your registered email and we'll send you a verification code</p>
        </div>
        <div className="relative">
          <input type="text" inputMode="email" value={identifier} onChange={event => { setIdentifier(event.target.value); setError(''); }} placeholder="Email or phone number" autoComplete="username" autoCapitalize="off" spellCheck={false} required className={authInputClass} style={AUTH_LIGHT} />
          {looksLikePhone(identifier) ? <Smartphone size={18} strokeWidth={1.8} className={authIconClass} /> : <Mail size={19} strokeWidth={1.8} className={authIconClass} />}
        </div>
        {error && <p role="alert" className="text-center text-[13px] font-semibold text-[#dc2626]">{error}</p>}
        <button type="submit" disabled={busy} className={authGoldButton}>{busy ? <><Loader2 size={19} className="animate-spin" />Sending…</> : 'Send Verification Code'}</button>
        <p className="text-center text-[12px] leading-snug text-[#6b7280]">If this account exists, we'll send a 6-digit code. It expires in 10 minutes.</p>
      </form>
    );
  } else if (step === 'code') {
    content = (
      <VerifyCodeStep
        title="Reset Password"
        target={email}
        channel="email"
        initialCooldown={cooldown}
        submitLabel="Reset Password"
        autoSubmit={false}
        note="If this account exists, we sent a code. It expires in 10 minutes. Check your spam folder too."
        onVerify={verifyAndReset}
        onResend={async () => (await api.verifyRequest('reset/send', { email })).resendAfterSeconds}
        onBack={() => setStep('request')}
        backLabel="Use a different email"
      >
        <div className="space-y-3 pt-1">
          <p className="text-left text-[13px] font-bold text-[#374151]">Enter New Password</p>
          {passwordInput(newPassword, setNewPassword, 'New password (6+ characters)', 'reset-new')}
          {passwordInput(confirmPassword, setConfirmPassword, 'Confirm New Password', 'reset-confirm')}
          {confirmPassword && newPassword !== confirmPassword && <p className="text-left text-[12px] font-semibold text-[#dc2626]">Passwords don't match yet.</p>}
        </div>
      </VerifyCodeStep>
    );
  } else if (step === 'phone') {
    content = (
      <div className="space-y-4 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#fdf6e3] text-[#a87b22] ring-2 ring-[#e9cf8a]"><Smartphone size={26} /></span>
        <h1 className="text-[26px] font-extrabold leading-tight text-[#111111]">Use your phone</h1>
        <p className="text-[14px] leading-snug text-[#4b5563]">Accounts made with a phone number don't use a password. Log in with a 6-digit SMS code instead.</p>
        {onUsePhone && <button type="button" onClick={() => { onUsePhone(identifier.trim()); close(); }} className={authGoldButton}>Send SMS Code</button>}
        <button type="button" onClick={() => setStep('request')} className={`text-[13px] font-semibold ${AUTH_GREEN} hover:underline`}>Use my email instead</button>
      </div>
    );
  } else {
    content = (
      <div className="space-y-4 text-center">
        <CheckCircle2 size={56} className="mx-auto text-[#15803d]" />
        <h1 className="text-[26px] font-extrabold leading-tight text-[#111111]">Password changed</h1>
        <p className="text-[14px] leading-snug text-[#4b5563]">You can now log in with your new password. For your safety, other devices were signed out.</p>
        <button type="button" onClick={() => { close(); onSuccess(); }} className={authGoldButton}>Back to Log In</button>
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
