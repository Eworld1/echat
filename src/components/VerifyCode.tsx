import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, MailCheck, Smartphone } from 'lucide-react';

/** Shared look for the login / sign-up / reset screens (exact hex so the dark theme never repaints them). */
export const AUTH_GREEN = 'text-[#1f4d1f]';
export const AUTH_LIGHT = { colorScheme: 'light' } as const;
export const authInputClass = 'peer h-12 w-full rounded-xl border border-[#d4d7db] bg-[#f1f2f4] pl-11 pr-4 text-[15px] text-[#111827] shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] outline-none transition placeholder:text-[#7b818a]! focus:border-[#c9a24a] focus:bg-[#ffffff] focus:ring-4 focus:ring-[#e9c86a]/30';
export const authIconClass = 'pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#6b7280] transition peer-focus:text-[#a87b22]';
export const authGoldButton = 'relative flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#b8862b] bg-gradient-to-b from-[#f3dc9b] via-[#d9b25a] to-[#b68428] text-[17px] font-extrabold text-[#1f3d1a] shadow-[0_6px_16px_rgba(166,120,30,0.35),inset_0_1px_0_rgba(255,255,255,0.6)] transition hover:brightness-105 active:translate-y-px focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#e9c86a]/50 disabled:cursor-wait disabled:opacity-75';

/** Six boxes, one digit each: auto-advance, backspace goes back, paste / SMS autofill fills all six. */
export const CodeBoxes: React.FC<{ value: string; onChange: (code: string) => void; onComplete?: (code: string) => void; disabled?: boolean; invalid?: boolean }> = ({ value, onChange, onComplete, disabled, invalid }) => {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  useEffect(() => { refs.current[0]?.focus(); }, []);

  const setDigits = (digits: string, focusIndex: number) => {
    const next = digits.replace(/\D/g, '').slice(0, 6);
    onChange(next);
    refs.current[Math.min(focusIndex, 5)]?.focus();
    if (next.length === 6) onComplete?.(next);
  };

  return (
    <div className="flex justify-center gap-2 sm:gap-2.5" role="group" aria-label="SMS code">
      {Array.from({ length: 6 }, (_, index) => (
        <input
          key={index}
          ref={element => { refs.current[index] = element; }}
          value={value[index] || ''}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${index + 1}`}
          maxLength={index === 0 ? 6 : 1}
          style={AUTH_LIGHT}
          onFocus={event => event.target.select()}
          onChange={event => {
            const typed = event.target.value.replace(/\D/g, '');
            if (!typed) return;
            if (typed.length > 1) { setDigits(value.slice(0, index) + typed, index + typed.length); return; } // autofill / paste into a box
            const chars = value.padEnd(6, ' ').split('');
            chars[index] = typed;
            setDigits(chars.join('').replace(/\s+$/, '').replace(/\s/g, ''), index + 1);
          }}
          onKeyDown={event => {
            if (event.key === 'Backspace') {
              event.preventDefault();
              if (value[index]) onChange(value.slice(0, index) + value.slice(index + 1));
              else if (index > 0) { onChange(value.slice(0, index - 1) + value.slice(index)); refs.current[index - 1]?.focus(); }
            } else if (event.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus();
            else if (event.key === 'ArrowRight' && index < 5) refs.current[index + 1]?.focus();
          }}
          onPaste={event => { event.preventDefault(); setDigits(event.clipboardData.getData('text'), 6); }}
          className={`h-14 w-11 rounded-xl border-2 bg-[#ffffff] text-center text-[24px] font-extrabold text-[#111111] outline-none transition sm:w-12 ${invalid ? 'border-[#dc2626]' : value[index] ? 'border-[#c9a24a]' : 'border-[#d4d7db]'} focus:border-[#b68428] focus:ring-4 focus:ring-[#e9c86a]/40 disabled:opacity-60`}
        />
      ))}
    </div>
  );
};

/** Seconds left until "Resend" is allowed. */
export function useCountdown(initialSeconds: number): [number, (seconds: number) => void] {
  const [endsAt, setEndsAt] = useState(() => Date.now() + initialSeconds * 1000);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt <= now) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [endsAt, now]);
  return [Math.max(0, Math.ceil((endsAt - now) / 1000)), seconds => { setNow(Date.now()); setEndsAt(Date.now() + seconds * 1000); }];
}

const mmss = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

/** Mask the middle of an email / phone shown on screen: "yo•••@gmail.com". */
export function maskTarget(target: string): string {
  if (target.includes('@')) {
    const [name, domain] = target.split('@');
    return `${name.slice(0, 2)}${'•'.repeat(Math.max(1, Math.min(6, name.length - 2)))}@${domain}`;
  }
  return target.length > 6 ? `${target.slice(0, 4)} ••• ${target.slice(-3)}` : target;
}

/**
 * Phone only: "Enter the SMS code we sent to …". Email accounts never use codes; they get a
 * Firebase verification link (see CheckEmailStep). onVerify(code) throws a readable error on failure;
 * onResend() returns the new cool-down in seconds.
 */
export const SmsCodeStep: React.FC<{
  title: string;
  phoneNumber: string;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<number>;
  onBack?: () => void;
  backLabel?: string;
  initialCooldown?: number;
}> = ({ title, phoneNumber, onVerify, onResend, onBack, backLabel = 'Back', initialCooldown = 60 }) => {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [left, restart] = useCountdown(initialCooldown);
  const [resending, setResending] = useState(false);

  const resend = async () => {
    setResending(true); setError(''); setInfo('');
    try {
      restart(await onResend());
      setCode('');
      setInfo(`New SMS code sent to ${maskTarget(phoneNumber)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the SMS code.');
    } finally { setResending(false); }
  };

  const submit = async (value = code) => {
    if (busy) return;
    if (value.length !== 6) { setError('Enter the full SMS code.'); return; }
    setBusy(true); setError(''); setInfo('');
    try { await onVerify(value); }
    catch (err) { setError(err instanceof Error ? err.message : 'That code didn\'t work.'); setCode(''); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-4" noValidate>
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-[#fdf6e3] text-[#a87b22] ring-2 ring-[#e9cf8a]"><Smartphone size={26} /></span>
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-[#111111]">{title}</h1>
        <p className="text-[14px] leading-snug text-[#4b5563]">Enter the SMS code we texted to<br /><b className="break-all text-[#111827]">{phoneNumber}</b></p>
      </div>
      <CodeBoxes value={code} onChange={value => { setCode(value); setError(''); }} onComplete={value => void submit(value)} disabled={busy} invalid={Boolean(error)} />
      {error && <p role="alert" className="text-center text-[13px] font-semibold text-[#dc2626]">{error}</p>}
      {info && !error && <p role="status" className="text-center text-[13px] font-semibold text-[#15803d]">{info}</p>}
      <button type="submit" disabled={busy || code.length !== 6} className={`${authGoldButton} disabled:cursor-not-allowed`}>{busy ? <><Loader2 size={19} className="animate-spin" />Checking…</> : 'Verify'}</button>
      <div className="text-center text-[13px] text-[#4b5563]">
        {left > 0
          ? <span>Resend SMS in <b className="tabular-nums text-[#111827]">{mmss(left)}</b></span>
          : <button type="button" onClick={() => void resend()} disabled={resending} className={`font-bold ${AUTH_GREEN} hover:underline disabled:opacity-60`}>{resending ? 'Sending…' : 'Resend SMS'}</button>}
      </div>
      {onBack && <button type="button" onClick={onBack} className="mx-auto flex items-center gap-1 text-[13px] font-semibold text-[#6b7280] hover:text-[#1f4d1f]"><ArrowLeft size={15} />{backLabel}</button>}
    </form>
  );
};

/**
 * "Check your email" step for Firebase verification links. Checks automatically every few seconds
 * (and when the tab comes back into focus), so clicking the link in Gmail is enough.
 */
export const CheckEmailStep: React.FC<{
  email: string;
  title: string;
  message: React.ReactNode;
  onCheck: () => Promise<boolean>;
  onResend: () => Promise<number>;
  onBack: () => void;
  backLabel: string;
  /** Seconds before "Resend Verification Email" is allowed (60 right after a fresh send). */
  initialCooldown?: number;
}> = ({ email, title, message, onCheck, onResend, onBack, backLabel, initialCooldown = 60 }) => {
  const [left, restart] = useCountdown(initialCooldown);
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const busy = useRef(false);

  const check = async (manual: boolean) => {
    if (busy.current) return;
    busy.current = true;
    if (manual) { setChecking(true); setError(''); setInfo(''); }
    try {
      const verified = await onCheck();
      if (!verified && manual) setError('Not verified yet. Open the email from eChat and click the link, then try again.');
    } catch (err) {
      if (manual) setError(err instanceof Error ? err.message : 'Could not check right now.');
    } finally {
      busy.current = false;
      if (manual) setChecking(false);
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) void check(false); }, 5000);
    const onFocus = () => void check(false);
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resend = async () => {
    setResending(true); setError(''); setInfo('');
    try { restart(await onResend()); setInfo(`New verification link sent to ${maskTarget(email)}.`); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not send the email.'); }
    finally { setResending(false); }
  };

  return (
    <div className="space-y-4 text-center">
      <div className="flex flex-col items-center gap-2">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-[#fdf6e3] text-[#a87b22] ring-2 ring-[#e9cf8a]"><MailCheck size={26} /></span>
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-[#111111]">{title}</h1>
        <p className="text-[14px] leading-snug text-[#4b5563]">{message}<br /><b className="break-all text-[#111827]">{email}</b></p>
      </div>
      <ol className="space-y-1.5 rounded-2xl bg-[#fdf6e3] p-3 text-left text-[13px] leading-snug text-[#4b5563]">
        <li><b className="text-[#8a6d1f]">1.</b> Open the email from eChat (check <b>Inbox</b> and <b>Spam</b>).</li>
        <li><b className="text-[#8a6d1f]">2.</b> Click the verification link.</li>
        <li><b className="text-[#8a6d1f]">3.</b> Come back here. eChat opens by itself.</li>
      </ol>
      {error && <p role="alert" className="text-[13px] font-semibold text-[#dc2626]">{error}</p>}
      {info && !error && <p role="status" className="text-[13px] font-semibold text-[#15803d]">{info}</p>}
      <button type="button" onClick={() => void check(true)} disabled={checking} className={authGoldButton}>{checking ? <><Loader2 size={19} className="animate-spin" />Checking…</> : 'I\'ve verified my email'}</button>
      <div className="text-[13px] text-[#4b5563]">
        {left > 0
          ? <span>Resend Verification Email in <b className="tabular-nums text-[#111827]">{mmss(left)}</b></span>
          : <button type="button" onClick={() => void resend()} disabled={resending} className={`font-bold ${AUTH_GREEN} hover:underline disabled:opacity-60`}>{resending ? 'Sending…' : 'Resend Verification Email'}</button>}
      </div>
      <button type="button" onClick={onBack} className="mx-auto flex items-center gap-1 text-[13px] font-semibold text-[#6b7280] hover:text-[#1f4d1f]"><ArrowLeft size={15} />{backLabel}</button>
    </div>
  );
};
