import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Calendar, Camera, Eye, EyeOff, Loader2, Lock, Mail, Smartphone, User as UserIcon, X } from 'lucide-react';
import { useAuth, type SocialProvider } from '../context/AuthContext';
import { initialsAvatar } from '../utils/avatar';
import { ForgotPasswordModal } from './ForgotPasswordModal';
import { TermsModal } from './TermsModal';
import { AUTH_GREEN, AUTH_LIGHT, CheckEmailStep, SmsCodeStep, authGoldButton, authIconClass, authInputClass } from './VerifyCode';

/**
 * EChat sign-in: blurred office photo behind a centred white card with a thin gold border and warm gold glow.
 * The same card holds "Sign up" and the one-time Google sign-up step. Colours are exact hex values so the
 * app's dark theme never repaints this screen.
 */

interface AuthModalProps {
  isOpen: boolean;
  onClose?: () => void;
  /** Kept for callers; the guest preview is no longer offered on this screen. */
  onContinueAsGuest?: () => void;
  /** Open straight on "Sign up" (e.g. from the guest preview). */
  initialMode?: 'login' | 'register';
}

type Mode = 'login' | 'register' | 'phone';

const adultCutoff = () => new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split('T')[0];
const ageFrom = (dob: string) => {
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return 0;
  const today = new Date();
  const age = today.getFullYear() - birth.getFullYear();
  const beforeBirthday = today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
  return beforeBirthday ? age - 1 : age;
};

const GREEN = AUTH_GREEN;
const LIGHT_INPUT = AUTH_LIGHT;
const inputClass = authInputClass;
const iconClass = authIconClass;
const goldButton = authGoldButton;
const RECAPTCHA_ID = 'echat-recaptcha';

const GoogleIcon = () => (
  <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
);

/** "eChat": gold "e" inside a small chat bubble + bold black "Chat". */
export const EChatWordmark: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span className={`inline-flex items-end gap-0.5 ${className}`} aria-label="eChat" role="img">
    <svg viewBox="0 0 44 44" className="h-11 w-11" aria-hidden="true">
      <defs>
        <linearGradient id="echat-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6e2a4" />
          <stop offset="0.45" stopColor="#d6aa4c" />
          <stop offset="1" stopColor="#a7741f" />
        </linearGradient>
      </defs>
      {/* bubble with a tail at the bottom-left */}
      <path d="M10 4h24a8 8 0 0 1 8 8v14a8 8 0 0 1-8 8H18l-8 7v-7.4A8 8 0 0 1 2 26V12a8 8 0 0 1 8-8z" fill="none" stroke="url(#echat-gold)" strokeWidth="2.6" strokeLinejoin="round" />
      <text x="22" y="29" textAnchor="middle" fontFamily="Inter, ui-sans-serif, system-ui, sans-serif" fontSize="27" fontWeight="800" fill="url(#echat-gold)">e</text>
    </svg>
    <span className="pb-[3px] text-[38px] font-extrabold leading-none tracking-tight text-[#111111]">Chat</span>
  </span>
);

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, initialMode = 'login' }) => {
  const { login, startEmailSignup, loginWithProvider, pendingSocialSignup, completeSocialSignup, cancelSocialSignup, pendingVerification, confirmSmsCode, checkEmailVerified, resendVerificationEmail, resendSmsCode, cancelVerification, startPhoneSignIn, clearRecaptcha } = useAuth();
  const [phone, setPhone] = useState('+232 ');
  const [phoneFrom, setPhoneFrom] = useState<'login' | 'register'>('login');
  const [mode, setMode] = useState<Mode>(initialMode);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // "Remember me": unchecked = signed out when the browser closes (see applyRememberMe in AuthContext).
  const [remember, setRemember] = useState(() => { try { return localStorage.getItem('echat_session_only') !== '1'; } catch { return true; } });
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [agreeTerms, setAgreeTerms] = useState(false);

  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [busy, setBusy] = useState<'' | 'email' | SocialProvider>('');
  const [resetDone, setResetDone] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  useEffect(() => { if (!error) return; const timer = window.setTimeout(() => setError(''), 7000); return () => window.clearTimeout(timer); }, [error, errorKey]);
  useEffect(() => () => { if (avatarPreview) URL.revokeObjectURL(avatarPreview); }, [avatarPreview]);
  // Finishing a Google sign-up: prefill the name.
  // The invisible reCAPTCHA belongs to this screen: remove it when the screen goes away.
  useEffect(() => { if (!isOpen) clearRecaptcha(); return () => clearRecaptcha(); }, [isOpen, clearRecaptcha]);
  useEffect(() => { if (pendingSocialSignup) { setName(current => current || pendingSocialSignup.name); setAgreeTerms(false); } }, [pendingSocialSignup]);

  if (!isOpen) return null;

  const fail = (message: string) => { setError(message); setErrorKey(key => key + 1); };
  const switchMode = (next: Mode) => { setMode(next); setError(''); setShowPassword(false); };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy('email'); setError('');
    try { await login(email, password, remember); setResetDone(false); } catch (err) { fail(err instanceof Error ? err.message : 'Login failed. Please check your details.'); } finally { setBusy(''); }
  };

  const checkAdult = () => {
    if (!dob) return 'Please enter your date of birth.';
    if (ageFrom(dob) < 18) return 'You must be at least 18 years old to join EChat.';
    if (!agreeTerms) return 'Please read and agree to the EChat Terms & Conditions.';
    return '';
  };

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const problem = checkAdult() || (password.length < 6 ? 'Password should be at least 6 characters.' : '');
    if (problem) { fail(problem); return; }
    setBusy('email'); setError('');
    try {
      // Creates the Firebase account and emails a verification link; the app stays locked until it is clicked.
      await startEmailSignup({ name: name.trim(), email, password, dob, avatarFile: avatarFile ?? undefined, remember });
    } catch (err) { fail(err instanceof Error ? err.message : 'Could not create your account.'); } finally { setBusy(''); }
  };

  const handlePhone = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy('phone'); setError('');
    try { await startPhoneSignIn(phone, RECAPTCHA_ID, remember); }
    catch (err) { fail(err instanceof Error ? err.message : 'Could not send the SMS code.'); }
    finally { setBusy(''); }
  };

  const openPhone = (from: 'login' | 'register', number?: string) => { setPhoneFrom(from); if (number) setPhone(number); switchMode('phone'); };

  const handleSocial = async (provider: SocialProvider) => {
    if (busy) return;
    setBusy(provider); setError('');
    try { await loginWithProvider(provider, remember); } catch (err) { fail(err instanceof Error ? err.message : 'Sign-in failed. Please try again.'); } finally { setBusy(''); }
  };

  const handleCompleteSocial = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const problem = (!name.trim() ? 'Please enter your name.' : '') || checkAdult();
    if (problem) { fail(problem); return; }
    setBusy('email'); setError('');
    try { await completeSocialSignup({ name, dob }); onClose?.(); } catch (err) { fail(err instanceof Error ? err.message : 'Could not finish sign-up.'); } finally { setBusy(''); }
  };

  const pickAvatar = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { fail('Please choose an image file.'); return; }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  /* ---------- shared pieces ---------- */

  const emailField = (
    <div className="relative">
      <input id={`echat-${mode}-email`} type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Email address" autoComplete="email" required className={inputClass} style={LIGHT_INPUT} />
      <Mail size={19} strokeWidth={1.8} className={iconClass} />
    </div>
  );

  const passwordField = (autoComplete: string, placeholder: string) => (
    <div className="relative">
      <input id={`echat-${autoComplete}`} type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} placeholder={placeholder} autoComplete={autoComplete} required minLength={autoComplete === 'new-password' ? 6 : undefined} className={`${inputClass} pr-12`} style={LIGHT_INPUT} />
      <Lock size={18} strokeWidth={1.8} className={iconClass} />
      <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} className="absolute right-1.5 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-lg text-[#374151] transition hover:bg-[#e5e7eb]">
        {showPassword ? <EyeOff size={20} strokeWidth={1.8} /> : <Eye size={20} strokeWidth={1.8} />}
      </button>
    </div>
  );

  const nameField = (placeholder: string) => (
    <div className="relative min-w-0 flex-1">
      <input value={name} onChange={event => setName(event.target.value)} placeholder={placeholder} autoComplete="name" required maxLength={80} className={inputClass} style={LIGHT_INPUT} />
      <UserIcon size={18} strokeWidth={1.8} className={iconClass} />
    </div>
  );

  const dobField = (
    <div className="relative">
      <input type="date" value={dob} max={adultCutoff()} onChange={event => setDob(event.target.value)} required aria-label="Date of birth" className={inputClass} style={LIGHT_INPUT} />
      <Calendar size={18} strokeWidth={1.8} className={iconClass} />
      <span className="mt-1 block px-1 text-left text-[11px] text-[#6b7280]">Date of birth · you must be 18+</span>
    </div>
  );

  const termsCheckbox = (
    <label className="flex cursor-pointer select-none items-start gap-2.5 text-left text-[13px] leading-snug text-[#374151]">
      <input type="checkbox" checked={agreeTerms} onChange={event => setAgreeTerms(event.target.checked)} style={LIGHT_INPUT} className="mt-0.5 h-4 w-4 shrink-0 accent-[#b68428]" />
      <span>I'm 18 or older and agree to the <button type="button" onClick={() => setTermsOpen(true)} className={`font-bold ${GREEN} hover:underline`}>EChat Terms &amp; Conditions</button>.</span>
    </label>
  );

  const divider = (label: string) => (
    <div className="flex items-center gap-3 text-[13px] text-[#4b5563]"><span className="h-px flex-1 bg-[#d9dbe0]" />{label}<span className="h-px flex-1 bg-[#d9dbe0]" /></div>
  );

  const googleButton = (
    <button type="button" onClick={() => void handleSocial('google')} disabled={Boolean(busy)}
      className="flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-[#b9bdc3] bg-[#eef0f2] text-[17px] font-bold text-[#111111] shadow-[0_2px_4px_rgba(0,0,0,0.08)] transition hover:bg-[#e6e8eb] active:translate-y-px disabled:opacity-60">
      {busy === 'google' ? <Loader2 size={20} className="animate-spin" /> : <GoogleIcon />}
      Continue with Google
    </button>
  );

  const spinner = (label: string) => <><Loader2 size={19} className="animate-spin" />{label}</>;

  /* ---------- card content ---------- */

  const phoneButton = (label: string, from: 'login' | 'register') => (
    <button type="button" onClick={() => openPhone(from)} disabled={Boolean(busy)}
      className="flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-[#b9bdc3] bg-[#ffffff] text-[16px] font-bold text-[#111111] shadow-[0_2px_4px_rgba(0,0,0,0.06)] transition hover:bg-[#f6f7f8] active:translate-y-px disabled:opacity-60">
      <Smartphone size={19} className="text-[#a87b22]" />{label}
    </button>
  );

  let content: React.ReactNode;
  if (pendingVerification && !pendingSocialSignup) {
    const pending = pendingVerification;
    content = pending.kind === 'email' ? (
      <CheckEmailStep
        key={`email-${pending.email}`}
        email={pending.email}
        title={pending.justSignedUp ? 'Check your email' : 'Please verify your email first'}
        message={pending.justSignedUp ? 'We sent you a verification link. Click it to verify your account:' : 'Your email isn\'t verified yet. Click the link we emailed to:'}
        initialCooldown={pending.justSignedUp ? 60 : 0}
        onCheck={checkEmailVerified}
        onResend={resendVerificationEmail}
        onBack={() => { void cancelVerification(); setPassword(''); switchMode('login'); }}
        backLabel={pending.justSignedUp ? 'Back to Log In' : 'Log out'}
      />
    ) : (
      <SmsCodeStep
        key={`phone-${pending.phoneNumber}`}
        title="Verify your phone"
        phoneNumber={pending.phoneNumber}
        initialCooldown={60}
        onVerify={confirmSmsCode}
        onResend={resendSmsCode}
        onBack={() => void cancelVerification()}
        backLabel="Change number"
      />
    );
  } else if (mode === 'phone' && !pendingSocialSignup) {
    content = (
      <form key="phone" onSubmit={handlePhone} className="space-y-4" noValidate>
        <div className="pb-1 text-center">
          <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-[#111111]">{phoneFrom === 'register' ? 'Sign up with phone' : 'Log in with phone'}</h1>
          <p className="mt-1 text-[14px] text-[#4b5563]">We'll text you a code to verify your number</p>
        </div>
        <div className="relative">
          <input type="tel" inputMode="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="+232 76 123456" autoComplete="tel" required className={inputClass} style={LIGHT_INPUT} />
          <Smartphone size={18} strokeWidth={1.8} className={iconClass} />
          <span className="mt-1 block px-1 text-left text-[11px] text-[#6b7280]">Include your country code, e.g. +232 for Sierra Leone</span>
        </div>
        <button type="submit" disabled={Boolean(busy)} className={goldButton}>{busy === 'phone' ? spinner('Sending code…') : 'Send Verification Code'}</button>
        <div className="pt-1">{divider('or')}</div>
        {googleButton}
        <button type="button" onClick={() => switchMode(phoneFrom)} className={`w-full text-center text-[14px] font-bold ${GREEN} hover:underline`}>{phoneFrom === 'register' ? 'Sign up with email instead' : 'Log in with email instead'}</button>
      </form>
    );
  } else if (pendingSocialSignup) {
    content = (
      <form key="social" onSubmit={handleCompleteSocial} className="space-y-3.5">
        <div className="flex flex-col items-center gap-2">
          <img src={pendingSocialSignup.photoURL || initialsAvatar(name || '?')} alt="" className="h-16 w-16 rounded-full object-cover ring-2 ring-[#e3c272]" />
          <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-[#111111]">Almost there</h1>
          <p className="max-w-full truncate text-[14px] text-[#4b5563]">{pendingSocialSignup.email || (pendingSocialSignup.provider === 'phone' ? 'Phone verified ✓ Finish creating your account' : 'Finish creating your EChat account')}</p>
        </div>
        {nameField('Your name')}
        {dobField}
        {termsCheckbox}
        <button type="submit" disabled={Boolean(busy)} className={goldButton}>{busy ? spinner('Creating your account…') : 'Continue'}</button>
        <button type="button" onClick={() => void cancelSocialSignup()} className="w-full text-center text-[13px] font-semibold text-[#6b7280] hover:text-[#1f4d1f]">Cancel and use another account</button>
      </form>
    );
  } else if (mode === 'login') {
    content = (
      <form key="login" onSubmit={handleLogin} className="space-y-4">
        <div className="pb-1 text-center">
          <h1 className="text-[34px] font-extrabold leading-tight tracking-tight text-[#111111]">Welcome back</h1>
          <p className="mt-1 text-[14px] text-[#4b5563]">Sign in to continue to your conversations</p>
        </div>
        {resetDone && <p role="status" className="rounded-xl bg-[#ecfdf3] px-3 py-2 text-center text-[13px] font-semibold text-[#15803d]">Password changed. Log in with your new password.</p>}
        {emailField}
        {passwordField('current-password', 'Password')}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] font-medium text-[#111827]">
            <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} style={LIGHT_INPUT} className="h-4 w-4 rounded-sm accent-[#1f4d1f]" />
            Remember me
          </label>
          <button type="button" onClick={() => setForgotOpen(true)} className={`text-[13px] font-semibold ${GREEN} hover:underline`}>Forgot password?</button>
        </div>
        <button type="submit" disabled={Boolean(busy)} className={goldButton}>{busy === 'email' ? spinner('Signing in…') : 'Continue'}</button>
        <div className="pt-2">{divider('or continue with')}</div>
        {googleButton}
        {phoneButton('Continue with phone', 'login')}
        <div className="pt-3 text-center">
          <p className="text-[12px] text-[#4b5563]">Don't have an account?</p>
          <button type="button" onClick={() => switchMode('register')} className={`mt-0.5 text-[15px] font-extrabold ${GREEN} hover:underline`}>Sign up</button>
        </div>
      </form>
    );
  } else {
    content = (
      <form key="register" onSubmit={handleRegister} className="space-y-3.5">
        <div className="pb-1 text-center">
          <h1 className="text-[34px] font-extrabold leading-tight tracking-tight text-[#111111]">Create account</h1>
          <p className="mt-1 text-[14px] text-[#4b5563]">Join EChat to start your conversations</p>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => avatarInputRef.current?.click()} className="relative h-12 w-12 shrink-0 rounded-full" aria-label="Choose a profile picture">
            <img src={avatarPreview || initialsAvatar(name || '?')} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-[#e3c272]" />
            <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-gradient-to-b from-[#f3dc9b] to-[#b68428] text-[#1f3d1a] ring-2 ring-[#ffffff]"><Camera size={12} /></span>
          </button>
          {nameField('Full name')}
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={event => { pickAvatar(event.target.files?.[0]); event.target.value = ''; }} />
        </div>
        {emailField}
        {passwordField('new-password', 'Create a password (6+ characters)')}
        {dobField}
        {termsCheckbox}
        <button type="submit" disabled={Boolean(busy)} className={goldButton}>{busy === 'email' ? spinner('Creating account…') : 'Continue'}</button>
        <p className="text-center text-[12px] text-[#6b7280]">We'll email you a verification link to confirm it's really you.</p>
        <div className="pt-1">{divider('or sign up with')}</div>
        {phoneButton('Sign up with phone number', 'register')}
        {googleButton}
        <div className="pt-2 text-center">
          <p className="text-[12px] text-[#4b5563]">Already have an account?</p>
          <button type="button" onClick={() => switchMode('login')} className={`mt-0.5 text-[15px] font-extrabold ${GREEN} hover:underline`}>Sign in</button>
        </div>
      </form>
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#0b0d0c]" style={{ colorScheme: 'light' }}>
      {/* blurred, darkened office photo */}
      <div aria-hidden="true" className="fixed inset-0 scale-105 bg-cover bg-center blur-[2px] brightness-[1.35]" style={{ backgroundImage: "url('/images/login-bg.jpg')" }} />
      <div aria-hidden="true" className="fixed inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.10)_0%,rgba(0,0,0,0.30)_70%,rgba(0,0,0,0.45)_100%)]" />

      <main className="relative flex min-h-dvh items-center justify-center px-4 py-[calc(env(safe-area-inset-top)+24px)] sm:py-10">
        <div key={errorKey}
          className={`w-full max-w-[400px] rounded-[26px] border border-[#e2c06e] bg-[#ffffff] px-6 pb-5 pt-7 shadow-[0_0_0_1px_rgba(255,226,150,0.35),0_0_28px_6px_rgba(240,196,92,0.55),0_0_70px_14px_rgba(214,160,60,0.30)] sm:px-8 ${error ? 'ec-shake' : ''}`}>
          <div className="mb-4 flex justify-center"><EChatWordmark /></div>
          {content}
          <p className="mt-5 text-center text-[11px] text-[#9ca3af]">From Eworld (LEK GOD)</p>
        </div>
      </main>

      {/* Error toast */}
      {error && (
        <div role="alert" aria-live="assertive" className="ec-fade-up fixed left-1/2 top-[calc(env(safe-area-inset-top)+16px)] z-[70] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-start gap-3 rounded-2xl bg-[#dc2626] px-4 py-3 text-sm font-semibold text-[#ffffff] shadow-2xl">
          <AlertCircle size={20} className="mt-0.5 shrink-0" />
          <span className="flex-1 leading-snug">{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Dismiss" className="-mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-full hover:bg-[#ffffff]/20"><X size={16} /></button>
        </div>
      )}

      <ForgotPasswordModal isOpen={forgotOpen} onClose={() => setForgotOpen(false)} onSuccess={() => { setForgotOpen(false); setPassword(''); setResetDone(true); switchMode('login'); }} onUsePhone={number => openPhone('login', number)} />
      {/* Invisible reCAPTCHA used by Firebase phone sign-in. */}
      <div id={RECAPTCHA_ID} />
      <TermsModal isOpen={termsOpen} onClose={() => setTermsOpen(false)} onAccept={() => setAgreeTerms(true)} showAcceptButton />
    </div>
  );
};
