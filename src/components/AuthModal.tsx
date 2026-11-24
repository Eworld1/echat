import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Calendar, Camera, Compass, Eye, EyeOff, Heart, Loader2, Lock, Mail, MessageCircle, Moon, Radio, ShoppingBag, Sun, User as UserIcon, Video, X } from 'lucide-react';
import { useAuth, type SocialProvider } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { initialsAvatar } from '../utils/avatar';
import { BrandFooter } from './BrandFooter';
import { GlowLogo } from './BrandLogo';
import { ForgotPasswordModal } from './ForgotPasswordModal';
import { TermsModal } from './TermsModal';

interface AuthModalProps {
  isOpen: boolean;
  onClose?: () => void;
  /** "Continue as Guest to explore" (read-only preview of EChat). */
  onContinueAsGuest?: () => void;
  /** Open straight on "Create Account" (e.g. from the guest preview). */
  initialMode?: 'login' | 'register';
}

type Mode = 'login' | 'register';

const adultCutoff = () => new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split('T')[0];
const ageFrom = (dob: string) => {
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return 0;
  const today = new Date();
  const age = today.getFullYear() - birth.getFullYear();
  const beforeBirthday = today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
  return beforeBirthday ? age - 1 : age;
};

const inputClass = 'peer h-[52px] w-full rounded-2xl border border-violet-200/70 bg-white/80 pl-11 pr-4 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:ring-4 focus:ring-violet-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:bg-white/10';
const iconClass = 'pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition peer-focus:text-violet-500';
const primaryButton = 'ec-gradient relative flex min-h-[52px] w-full items-center justify-center gap-2 overflow-hidden rounded-2xl px-5 text-base font-bold text-white shadow-lg shadow-violet-600/30 transition hover:brightness-110 hover:shadow-violet-600/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-400/40 active:scale-[0.99] disabled:cursor-wait disabled:opacity-70';

const GoogleIcon = () => (
  <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
);
const FacebookIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true"><path fill="#1877F2" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z" /><path fill="#fff" d="m16.67 15.56.53-3.49h-3.33V9.82c0-.96.47-1.89 1.96-1.89h1.51V4.96s-1.37-.24-2.68-.24c-2.74 0-4.53 1.67-4.53 4.69v2.66H7.08v3.49h3.05V24a12.2 12.2 0 0 0 3.74 0v-8.44h2.8z" /></svg>
);

/** Left panel: animated brand gradient + a little "live stream" preview. */
const BrandPanel: React.FC = () => {
  const [viewers, setViewers] = useState(1284);
  useEffect(() => {
    const timer = window.setInterval(() => setViewers(count => count + Math.floor(Math.random() * 9) - 2), 1600);
    return () => window.clearInterval(timer);
  }, []);
  const comments = [
    { name: 'Aminata', text: 'Greetings from Freetown 🇸🇱', color: 'from-pink-400 to-rose-500' },
    { name: 'Mohamed', text: 'This stream is fire 🔥🔥', color: 'from-sky-400 to-blue-600' },
  ];
  return (
    <section aria-label="EChat" className="ec-gradient-animated relative hidden min-h-dvh overflow-hidden text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
      {/* glowing orbs */}
      <span aria-hidden="true" className="ec-float-slow absolute -left-24 top-10 h-80 w-80 rounded-full bg-fuchsia-500/40 blur-3xl" />
      <span aria-hidden="true" className="ec-float absolute -right-16 top-1/3 h-72 w-72 rounded-full bg-cyan-400/30 blur-3xl" />
      <span aria-hidden="true" className="ec-float-delay absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-indigo-500/40 blur-3xl" />
      <span aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.12)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent)]" />

      <div className="relative flex items-center gap-4">
        <GlowLogo size={64} />
        <div>
          <p className="text-3xl font-black tracking-tight">EChat</p>
          <p className="text-sm font-semibold text-white/75">Sierra Leone's social home</p>
        </div>
      </div>

      <div className="relative">
        <h1 className="max-w-xl text-5xl font-black leading-[1.05] tracking-tight xl:text-6xl">
          Chat. Stream.<br /><span className="bg-gradient-to-r from-pink-200 via-white to-cyan-200 bg-clip-text text-transparent">Connect.</span>
        </h1>
        <p className="mt-4 max-w-md text-lg text-white/80">Messages, HD calls, live streams, Reels and a marketplace - all in one place.</p>

        {/* Live preview */}
        <div className="ec-float mt-10 w-full max-w-[420px] overflow-hidden rounded-[28px] border border-white/20 bg-black/30 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-violet-900 via-indigo-900 to-fuchsia-900">
            <span aria-hidden="true" className="absolute left-1/2 top-[30%] h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-pink-500 to-violet-600 opacity-60 blur-2xl" />
            <div className="absolute left-1/2 top-[30%] grid h-20 w-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-gradient-to-br from-pink-400 via-fuchsia-500 to-indigo-500 text-4xl font-black shadow-xl ring-4 ring-white/20">K</div>
            <div className="absolute left-3 top-3 flex items-center gap-2">
              <span className="ec-pulse-ring flex items-center gap-1 rounded-md bg-rose-600 px-2 py-0.5 text-[11px] font-black tracking-wider">● LIVE</span>
              <span className="rounded-md bg-black/45 px-2 py-0.5 text-[11px] font-bold">👁 {viewers.toLocaleString()}</span>
            </div>
            <div className="absolute bottom-3 left-3 right-14 space-y-1.5">
              {comments.map((comment, index) => (
                <div key={comment.name} className="ec-fade-up flex items-center gap-2 rounded-full bg-black/40 py-1 pl-1 pr-3 text-[12px] backdrop-blur" style={{ animationDelay: `${index * 0.6 + 0.3}s` }}>
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gradient-to-br ${comment.color} text-[10px] font-black`}>{comment.name[0]}</span>
                  <b className="font-bold">{comment.name}</b><span className="truncate text-white/85">{comment.text}</span>
                </div>
              ))}
            </div>
            <div aria-hidden="true" className="absolute bottom-3 right-3 flex flex-col items-center gap-1 text-lg">
              <span className="ec-float-delay">💜</span><span className="ec-float">❤️</span><span className="ec-float-slow">🔥</span>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-pink-500 to-violet-600 text-sm font-black">K</span>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">Kadiatu is live</p><p className="truncate text-xs text-white/65">Friday night music session 🎶</p></div>
            <Heart size={18} className="text-pink-300" fill="currentColor" />
          </div>
        </div>
      </div>

      <div className="relative flex flex-wrap gap-2 text-sm font-semibold">
        {[{ icon: <MessageCircle size={15} />, label: 'Private chats' }, { icon: <Video size={15} />, label: 'HD video calls' }, { icon: <Radio size={15} />, label: 'Go live' }, { icon: <ShoppingBag size={15} />, label: 'Marketplace' }].map(item => (
          <span key={item.label} className="flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 backdrop-blur">{item.icon}{item.label}</span>
        ))}
      </div>
    </section>
  );
};

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onContinueAsGuest, initialMode = 'login' }) => {
  const { login, register, loginWithProvider, pendingSocialSignup, completeSocialSignup, cancelSocialSignup } = useAuth();
  const { resolvedTheme, setTheme } = usePreferences();
  const [mode, setMode] = useState<Mode>(initialMode);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
  const [forgotOpen, setForgotOpen] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  useEffect(() => { if (!error) return; const timer = window.setTimeout(() => setError(''), 7000); return () => window.clearTimeout(timer); }, [error, errorKey]);
  useEffect(() => () => { if (avatarPreview) URL.revokeObjectURL(avatarPreview); }, [avatarPreview]);
  // Finishing a Google/Facebook sign-up: prefill the name.
  useEffect(() => { if (pendingSocialSignup) { setName(current => current || pendingSocialSignup.name); setAgreeTerms(false); } }, [pendingSocialSignup]);

  if (!isOpen) return null;

  const fail = (message: string) => { setError(message); setErrorKey(key => key + 1); };
  const switchMode = (next: Mode) => { setMode(next); setError(''); setShowPassword(false); };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy('email'); setError('');
    try { await login(email, password, remember); onClose?.(); } catch (err) { fail(err instanceof Error ? err.message : 'Login failed. Please check your details.'); } finally { setBusy(''); }
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
      await register({ name: name.trim(), email, password, dob, avatarFile: avatarFile ?? undefined, bio: 'Excited to be on Echat! 👋', location: 'Global', termsAccepted: true });
      onClose?.();
    } catch (err) { fail(err instanceof Error ? err.message : 'Could not create your account.'); } finally { setBusy(''); }
  };

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

  const termsCheckbox = (
    <label className="flex cursor-pointer select-none items-start gap-3 rounded-2xl border border-violet-200/60 bg-violet-50/60 p-3 text-[13px] leading-snug text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
      <input type="checkbox" checked={agreeTerms} onChange={event => setAgreeTerms(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-violet-600" />
      <span>I'm 18 or older and agree to the <button type="button" onClick={() => setTermsOpen(true)} className="font-bold text-violet-700 hover:underline dark:text-violet-300">EChat Terms & Conditions</button> and Community Guidelines.</span>
    </label>
  );

  const passwordField = (autoComplete: string, placeholder: string) => (
    <div className="relative">
      <input id={`echat-${autoComplete}`} type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} placeholder={placeholder} autoComplete={autoComplete} required minLength={autoComplete === 'new-password' ? 6 : undefined} className={`${inputClass} pr-12`} />
      <Lock size={18} className={iconClass} />
      <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} className="absolute right-1.5 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-xl text-slate-400 transition hover:bg-violet-50 hover:text-violet-600 dark:hover:bg-white/10">
        {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
      </button>
    </div>
  );

  const dobField = (
    <div className="relative">
      <input type="date" value={dob} max={adultCutoff()} onChange={event => setDob(event.target.value)} required aria-label="Date of birth" className={inputClass} />
      <Calendar size={18} className={iconClass} />
      <span className="mt-1 block px-1 text-[11px] text-slate-500 dark:text-slate-400">Date of birth · you must be 18+</span>
    </div>
  );

  const socialButtons = (
    <div className="grid grid-cols-2 gap-3">
      {(['google', 'facebook'] as const).map(provider => (
        <button key={provider} type="button" onClick={() => void handleSocial(provider)} disabled={Boolean(busy)}
          className="flex min-h-[50px] items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white/90 text-sm font-bold text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:border-violet-400/50">
          {busy === provider ? <Loader2 size={18} className="animate-spin" /> : provider === 'google' ? <GoogleIcon /> : <FacebookIcon />}
          {provider === 'google' ? 'Google' : 'Facebook'}
        </button>
      ))}
    </div>
  );

  const divider = (label: string) => (
    <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-slate-400"><span className="h-px flex-1 bg-slate-200 dark:bg-white/10" />{label}<span className="h-px flex-1 bg-slate-200 dark:bg-white/10" /></div>
  );

  let card: React.ReactNode;
  if (pendingSocialSignup) {
    card = (
      <form key="social" onSubmit={handleCompleteSocial} className="ec-slide-in-right space-y-4">
        <div className="flex items-center gap-3">
          <img src={pendingSocialSignup.photoURL || initialsAvatar(name || '?')} alt="" className="h-14 w-14 rounded-full object-cover ring-4 ring-violet-200 dark:ring-violet-500/30" />
          <div className="min-w-0"><h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Almost there!</h2><p className="truncate text-sm text-slate-500 dark:text-slate-400">{pendingSocialSignup.email || 'Finish creating your EChat account'}</p></div>
        </div>
        <div className="relative"><input value={name} onChange={event => setName(event.target.value)} placeholder="Your name" autoComplete="name" required maxLength={80} className={inputClass} /><UserIcon size={18} className={iconClass} /></div>
        {dobField}
        {termsCheckbox}
        <button type="submit" disabled={Boolean(busy)} className={primaryButton}>{busy ? <><Loader2 size={19} className="animate-spin" />Creating your account…</> : <>Finish & enter EChat<ArrowRight size={18} /></>}</button>
        <button type="button" onClick={() => void cancelSocialSignup()} className="w-full text-center text-sm font-semibold text-slate-500 hover:text-violet-600 dark:text-slate-400">Cancel and use another account</button>
      </form>
    );
  } else if (mode === 'login') {
    card = (
      <form key="login" onSubmit={handleLogin} className="ec-fade-up space-y-4" noValidate={false}>
        <div className="mb-1">
          <h2 className="text-[28px] font-black tracking-tight text-slate-900 dark:text-white">Welcome back 👋</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Log in to keep chatting, streaming and connecting.</p>
        </div>
        <div className="relative"><input id="echat-login-email" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Email address" autoComplete="email" required className={inputClass} /><Mail size={18} className={iconClass} /></div>
        {passwordField('current-password', 'Password')}
        <div className="flex items-center justify-between gap-2 text-sm">
          <label className="flex cursor-pointer select-none items-center gap-2 font-medium text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} className="h-4 w-4 accent-violet-600" />Remember me
          </label>
          <button type="button" onClick={() => setForgotOpen(true)} className="font-bold text-violet-700 hover:underline dark:text-violet-300">Forgot Password?</button>
        </div>
        <button type="submit" disabled={Boolean(busy)} className={primaryButton}>
          {busy === 'email' ? <><Loader2 size={19} className="animate-spin" />Logging in…</> : <>Log in<ArrowRight size={18} /></>}
        </button>
        {divider('or continue with')}
        {socialButtons}
        <p className="pt-1 text-center text-sm text-slate-600 dark:text-slate-400">New to EChat? <button type="button" onClick={() => switchMode('register')} className="font-extrabold text-violet-700 hover:underline dark:text-violet-300">Create Account</button></p>
      </form>
    );
  } else {
    card = (
      <form key="register" onSubmit={handleRegister} className="ec-slide-in-right space-y-3.5">
        <div className="mb-1">
          <h2 className="text-[28px] font-black tracking-tight text-slate-900 dark:text-white">Create your account ✨</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">It's free and takes less than a minute.</p>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => avatarInputRef.current?.click()} className="group relative h-16 w-16 shrink-0 rounded-full" aria-label="Choose a profile picture">
            <img src={avatarPreview || initialsAvatar(name || '?')} alt="" className="h-16 w-16 rounded-full object-cover ring-4 ring-violet-100 dark:ring-violet-500/25" />
            <span className="ec-gradient absolute -bottom-0.5 -right-0.5 grid h-7 w-7 place-items-center rounded-full text-white ring-2 ring-white dark:ring-[#140f2b]"><Camera size={14} /></span>
          </button>
          <div className="relative min-w-0 flex-1"><input value={name} onChange={event => setName(event.target.value)} placeholder="Full name" autoComplete="name" required maxLength={80} className={inputClass} /><UserIcon size={18} className={iconClass} /></div>
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={event => { pickAvatar(event.target.files?.[0]); event.target.value = ''; }} />
        </div>
        <div className="relative"><input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Email address" autoComplete="email" required className={inputClass} /><Mail size={18} className={iconClass} /></div>
        {passwordField('new-password', 'Create a password (6+ characters)')}
        {dobField}
        {termsCheckbox}
        <button type="submit" disabled={Boolean(busy)} className={primaryButton}>
          {busy === 'email' ? <><Loader2 size={19} className="animate-spin" />Creating account…</> : <>Create Account<ArrowRight size={18} /></>}
        </button>
        {divider('or sign up with')}
        {socialButtons}
        <p className="text-center text-sm text-slate-600 dark:text-slate-400">Already on EChat? <button type="button" onClick={() => switchMode('login')} className="font-extrabold text-violet-700 hover:underline dark:text-violet-300">Log in</button></p>
      </form>
    );
  }

  const dark = resolvedTheme === 'dark';
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#f7f5ff] dark:bg-[#0b0820]">
      <div className="grid min-h-dvh lg:grid-cols-[1.08fr_1fr]">
        <BrandPanel />

        <main className="relative flex min-h-dvh flex-col overflow-hidden">
          {/* soft colour wash behind the card */}
          <span aria-hidden="true" className="ec-float-slow pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-violet-400/25 blur-3xl dark:bg-violet-600/25" />
          <span aria-hidden="true" className="ec-float pointer-events-none absolute -bottom-24 -left-16 h-80 w-80 rounded-full bg-pink-400/20 blur-3xl dark:bg-fuchsia-600/20" />
          <span aria-hidden="true" className="pointer-events-none absolute left-1/3 top-1/2 h-64 w-64 rounded-full bg-sky-400/15 blur-3xl" />

          <div className="relative flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+14px)] sm:px-8">
            <div className="flex items-center gap-2.5 lg:invisible">
              <GlowLogo size={40} />
              <span className="ec-gradient-text text-2xl font-black tracking-tight">EChat</span>
            </div>
            <button type="button" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}
              className="ec-glass grid h-11 w-11 place-items-center rounded-full text-slate-700 shadow-sm transition hover:scale-105 dark:text-amber-200">
              {dark ? <Sun size={19} /> : <Moon size={19} />}
            </button>
          </div>

          <div className="relative flex flex-1 flex-col items-center justify-center px-4 py-6 sm:px-8">
            {/* Phone: brand hero above the form */}
            <div className="mb-6 text-center lg:hidden">
              <p className="text-[34px] font-black leading-tight tracking-tight text-slate-900 dark:text-white">Chat. Stream. <span className="ec-gradient-text">Connect.</span></p>
              <div className="mt-3 flex flex-wrap justify-center gap-1.5 text-xs font-semibold text-violet-800 dark:text-violet-200">
                {['💬 Chats', '📹 Calls', '🔴 Live', '🛍️ Marketplace'].map(chip => <span key={chip} className="rounded-full bg-violet-100/80 px-2.5 py-1 dark:bg-white/10">{chip}</span>)}
              </div>
            </div>

            <div key={errorKey} className={`ec-glass w-full max-w-[440px] rounded-[28px] p-6 shadow-2xl shadow-violet-900/10 sm:p-8 ${error ? 'ec-shake' : ''}`}>
              {card}
            </div>

            {onContinueAsGuest && !pendingSocialSignup && (
              <button type="button" onClick={onContinueAsGuest} className="group mt-5 flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-bold text-slate-600 transition hover:bg-white/70 hover:text-violet-700 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white">
                <Compass size={17} className="transition group-hover:rotate-45" />Continue as Guest to explore
              </button>
            )}
          </div>

          <BrandFooter className="relative pb-[calc(20px+env(safe-area-inset-bottom))]" />
        </main>
      </div>

      {/* Error toast */}
      {error && (
        <div role="alert" aria-live="assertive" className="ec-fade-up fixed left-1/2 top-[calc(env(safe-area-inset-top)+16px)] z-[70] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-start gap-3 rounded-2xl bg-gradient-to-r from-rose-600 to-red-500 px-4 py-3 text-sm font-semibold text-white shadow-2xl shadow-rose-600/40">
          <AlertCircle size={20} className="mt-0.5 shrink-0" />
          <span className="flex-1 leading-snug">{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Dismiss" className="-mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-full hover:bg-white/20"><X size={16} /></button>
        </div>
      )}

      <ForgotPasswordModal isOpen={forgotOpen} onClose={() => setForgotOpen(false)} onSuccess={() => { setForgotOpen(false); switchMode('login'); }} />
      <TermsModal isOpen={termsOpen} onClose={() => setTermsOpen(false)} onAccept={() => setAgreeTerms(true)} showAcceptButton />
    </div>
  );
};
