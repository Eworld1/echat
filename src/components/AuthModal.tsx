import { initialsAvatar } from '../utils/avatar';
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ForgotPasswordModal } from './ForgotPasswordModal';
import { TermsModal } from './TermsModal';
import { api } from '../services/api';
import type { SiteConfig } from '../types';
import { MessageSquare, Calendar, Video, Sparkles, AlertCircle, Shield, Eye, EyeOff } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { login, register } = useAuth();
  const [tab, setTab] = useState<'login' | 'register'>('login');

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [welcomeConfig, setWelcomeConfig] = useState<SiteConfig>({});
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [agreeTerms, setAgreeTerms] = useState(false);

  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isForgotModalOpen, setIsForgotModalOpen] = useState(false);
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(false);

  useEffect(() => {
    api.getSiteConfig().then(setWelcomeConfig).catch(() => {});
  }, []);

  if (!isOpen) return null;

  const calculateAge = (dobString: string): number => {
    const birthDate = new Date(dobString);
    if (isNaN(birthDate.getTime())) return 0;
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg('');
    try {
      await login(email, password);
      onClose?.();
    } catch (err: any) {
      setErrorMsg(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!dob) {
      setErrorMsg('Date of Birth is required.');
      return;
    }

    const age = calculateAge(dob);
    if (age < 18) {
      setErrorMsg('You must be at least 18 years old to register on Echat.');
      return;
    }

    if (!agreeTerms) {
      setErrorMsg('You must read and agree to the EChat Terms & Conditions to create an account.');
      return;
    }

    setIsLoading(true);
    try {
      await register({
        name,
        email,
        password,
        dob,
        avatarFile: avatarFile ?? undefined,
        bio: bio || 'Excited to be on Echat! 👋',
        location: location || 'Global',
        termsAccepted: true
      });
      onClose?.();
    } catch (err: any) {
      setErrorMsg(err.message || 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-cover bg-center bg-no-repeat"
      style={{
        backgroundImage: `url('${welcomeConfig.welcomeBgImage || '/assets/aistudio/bd3de880-e4c3-43a6-a9a3-f5f3393ff3a6_470c76c2.jpg'}')`
      }}
    >
      {/* Dark tint overlay for readability */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/60 to-black/75 backdrop-blur-[2px]" />

      <div className="relative z-10 w-full max-w-4xl flex flex-col lg:flex-row items-center justify-between gap-8 py-6 my-auto">
        
        {/* Left Brand Column */}
        <div className="w-full lg:w-1/2 space-y-5 text-center lg:text-left text-white drop-shadow-md">
          <div className="flex items-center justify-center lg:justify-start gap-3">
            <img src="/logo-192.png" alt="EchatSl logo" className="h-14 w-14 rounded-2xl object-cover shadow-lg" />
            <h1 className="text-4xl sm:text-5xl font-black text-white tracking-tight">
              {welcomeConfig.welcomeTitle || welcomeConfig.appName || 'EchatSl'}
            </h1>
          </div>

          <p className="text-xl sm:text-2xl font-light text-slate-100 leading-snug max-w-md mx-auto lg:mx-0">
            {welcomeConfig.welcomeSubtitle || 'Connect with friends, share 24-hour stories, and make calls with the people in your life.'}
          </p>

          <div className="space-y-3 pt-2 hidden sm:block max-w-md mx-auto lg:mx-0 text-slate-200 text-sm">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-white/15 backdrop-blur-md text-blue-300 flex items-center justify-center border border-white/20">
                <Video size={16} />
              </div>
              <span className="font-medium">HD Audio and Video Calls built-in</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-white/15 backdrop-blur-md text-amber-300 flex items-center justify-center border border-white/20">
                <Sparkles size={16} />
              </div>
              <span className="font-medium">24-Hour Stories & real-time updates</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-white/15 backdrop-blur-md text-emerald-300 flex items-center justify-center border border-white/20">
                <Calendar size={16} />
              </div>
              <span className="font-medium">18+ community verified with Date of Birth</span>
            </div>
          </div>
        </div>

        {/* Right Auth Card: Glassmorphic Semi-transparent Design */}
        <div className="w-full lg:w-[420px] bg-white/90 backdrop-blur-xl rounded-3xl p-6 sm:p-8 shadow-2xl border border-white/40">
          
          {/* Tabs */}
          <div className="grid grid-cols-2 p-1 bg-slate-200/70 backdrop-blur-md rounded-2xl mb-5">
            <button
              onClick={() => { setTab('login'); setErrorMsg(''); }}
              className={`py-2 text-xs font-bold rounded-xl transition ${
                tab === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Log In
            </button>
            <button
              onClick={() => { setTab('register'); setErrorMsg(''); }}
              className={`py-2 text-xs font-bold rounded-xl transition ${
                tab === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Create Account
            </button>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-50/95 border border-red-200 text-red-700 text-xs font-semibold rounded-xl mb-4 flex items-center gap-2">
              <AlertCircle size={16} className="text-red-500 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {tab === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full p-3.5 bg-white/80 border border-slate-300 rounded-xl text-sm focus:bg-white focus:border-blue-600 focus:outline-hidden transition"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    className="w-full p-3.5 pr-12 bg-white/80 border border-slate-300 rounded-xl text-sm focus:bg-white focus:border-blue-600 focus:outline-hidden transition"
                    required
                  />
                  <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-blue-600 rounded-lg">
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-bold text-base shadow-md transition cursor-pointer"
              >
                {isLoading ? 'Signing in...' : 'Log In'}
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => setIsForgotModalOpen(true)}
                  className="text-xs text-blue-600 hover:underline font-semibold"
                >
                  Forgotten password?
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full p-2.5 bg-white/80 border border-slate-300 rounded-xl text-sm focus:bg-white focus:border-blue-600 focus:outline-hidden"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full p-2.5 bg-white/80 border border-slate-300 rounded-xl text-sm focus:bg-white focus:border-blue-600 focus:outline-hidden"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Create a strong password"
                    autoComplete="new-password"
                    className="w-full p-2.5 pr-11 bg-white/80 border border-slate-300 rounded-xl text-sm focus:bg-white focus:border-blue-600 focus:outline-hidden"
                    required
                  />
                  <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-blue-600 rounded-lg">
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>

              {/* Date of Birth Field (Required, 18+ only) */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1 flex items-center justify-between">
                  <span>Date of Birth <span className="text-red-500">*</span></span>
                  <span className="text-[10px] text-slate-500 font-normal">Must be at least 18 years old</span>
                </label>
                <div className="relative">
                  <input
                    type="date"
                    value={dob}
                    max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split('T')[0]}
                    onChange={e => setDob(e.target.value)}
                    className="w-full p-2.5 bg-white/80 border border-slate-300 rounded-xl text-sm focus:bg-white focus:border-blue-600 focus:outline-hidden"
                    required
                  />
                </div>
              </div>

              {/* Profile picture: chosen directly from the device gallery (no preset photos) */}
              <div className="pt-1">
                <label className="block text-[11px] font-bold text-slate-700 mb-1.5">
                  Profile Picture
                </label>
                <div className="flex items-center gap-3">
                  <img
                    src={avatarPreview || initialsAvatar(name || '?')}
                    alt="Your profile picture"
                    className="w-14 h-14 rounded-full object-cover border border-slate-200 bg-slate-100"
                  />
                  <div className="flex flex-col items-start gap-1">
                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition"
                    >
                      {avatarFile ? 'Change photo' : 'Choose from gallery'}
                    </button>
                    <span className="text-[10px] text-slate-400">Optional. You can add or change it later.</span>
                  </div>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      if (!file.type.startsWith('image/')) {
                        setErrorMsg('Please choose an image file.');
                        return;
                      }
                      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
                      setAvatarFile(file);
                      setAvatarPreview(URL.createObjectURL(file));
                    }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Bio (Optional)
                </label>
                <input
                  type="text"
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  placeholder="Share something about yourself"
                  className="w-full p-2.5 bg-white/80 border border-slate-300 rounded-xl text-sm focus:bg-white focus:border-blue-600 focus:outline-hidden"
                />
              </div>

              {/* Task 4: Terms and Conditions Checkbox */}
              <div className="pt-2 bg-slate-50/80 p-3 rounded-xl border border-slate-200">
                <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={agreeTerms}
                    onChange={e => setAgreeTerms(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    required
                  />
                  <span className="leading-tight">
                    I agree to the{' '}
                    <button
                      type="button"
                      onClick={() => setIsTermsModalOpen(true)}
                      className="text-blue-600 font-bold hover:underline cursor-pointer"
                    >
                      EChat Terms & Conditions
                    </button>
                    , Anti-Impersonation Safeguards, and Community Guidelines.
                  </span>
                </label>
              </div>

              <button
                type="submit"
                disabled={isLoading || !agreeTerms}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl font-bold text-base shadow-md transition cursor-pointer mt-3 flex items-center justify-center gap-2"
              >
                {isLoading ? 'Creating Account...' : 'Sign Up for Echat'}
              </button>
            </form>
          )}

          {/* Footer Link to Terms & Conditions */}
          <div className="mt-4 pt-3 border-t border-slate-200/80 text-center text-[11px] text-slate-500 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setIsTermsModalOpen(true)}
              className="text-slate-600 hover:text-blue-600 hover:underline font-medium cursor-pointer"
            >
              Terms & Conditions
            </button>
            <span>•</span>
            <span className="text-slate-400">18+ Platform Safety</span>
            <span>•</span>
            <span className="text-slate-400">© 2026 EChat</span>
          </div>

        </div>
      </div>

      <ForgotPasswordModal
        isOpen={isForgotModalOpen}
        onClose={() => setIsForgotModalOpen(false)}
        onSuccess={() => {
          setIsForgotModalOpen(false);
          setTab('login');
        }}
      />

      <TermsModal
        isOpen={isTermsModalOpen}
        onClose={() => setIsTermsModalOpen(false)}
        onAccept={() => setAgreeTerms(true)}
        showAcceptButton={true}
      />
    </div>
  );
};

