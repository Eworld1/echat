import React, { useState } from 'react';
import { Check, Copy, ExternalLink, Globe, Mail, MessageCircle, Phone, Ticket } from 'lucide-react';

/**
 * "How to apply" (Jobs) / "How to register" (Events): one smart action button chosen from what the
 * poster entered. Values are stored as readable text in the existing contact field:
 *   https://jobs.example.org   ·   WhatsApp: +232 76 123456   ·   Email: hr@example.org   ·   Phone: +232 76 123456
 * Older free-text values ("erp.mariestopes.org.sl", "+232 76…", "send CV to hr@x.org") are detected automatically.
 */

export type ApplyMethod = 'website' | 'whatsapp' | 'email' | 'phone';
export type ApplyKind = 'job' | 'event';

export const APPLY_METHODS: { value: ApplyMethod; label: string }[] = [
  { value: 'website', label: 'Website Link' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' }
];

const PREFIX: Record<Exclude<ApplyMethod, 'website'>, string> = { whatsapp: 'WhatsApp', email: 'Email', phone: 'Phone' };
const EMAIL_RE = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/i;
const URL_RE = /(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#][^\s<>"']*)?/i;
const PHONE_RE = /\+?\d[\d\s().-]{5,22}\d/;

const digitsOf = (value: string) => value.replace(/\D/g, '');

/** Adds https:// when missing; returns '' for anything that isn't a normal web address. */
export function normalizeWebsite(value: string): string {
  const trimmed = value.trim().replace(/[).,;]+$/, '');
  if (!trimmed || /\s/.test(trimmed)) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? '' : `https://${trimmed}`;
  if (!withScheme) return '';
  try {
    const url = new URL(withScheme);
    if (!/^https?:$/.test(url.protocol) || !/\.[a-z]{2,}$/i.test(url.hostname)) return '';
    return url.href;
  } catch {
    return '';
  }
}

/** International digits for wa.me: drops spaces, +, dashes; a local Sierra Leone number (0XX XXXXXX) gets 232. */
export function whatsappDigits(value: string): string {
  const trimmed = value.trim();
  let digits = digitsOf(trimmed);
  if (trimmed.startsWith('00')) digits = digits.slice(2);
  else if (!trimmed.startsWith('+') && digits.length === 9 && digits.startsWith('0')) digits = `232${digits.slice(1)}`;
  return digits;
}

const validPhone = (value: string) => /^\+?[\d\s().-]+$/.test(value.trim()) && digitsOf(value).length >= 7 && digitsOf(value).length <= 15;

/** Error message for the form, or '' when valid. Empty values are allowed (the field is optional). */
export function validateApply(method: ApplyMethod, value: string): string {
  const v = value.trim();
  if (!v) return '';
  if (method === 'website') return normalizeWebsite(v) ? '' : 'Enter a valid website link, e.g. jobs.unicef.org';
  if (method === 'email') return new RegExp(`^${EMAIL_RE.source}$`, 'i').test(v) ? '' : 'Enter a valid email, e.g. hr@company.org';
  if (!validPhone(v)) return 'Enter a valid phone number, e.g. +232 76 123456';
  if (method === 'whatsapp' && whatsappDigits(v).length < 8) return 'Include the country code, e.g. +232 76 123456';
  return '';
}

/** Form value → stored text. */
export function encodeApply(method: ApplyMethod, value: string): string {
  const v = value.trim();
  if (!v) return '';
  if (method === 'website') return normalizeWebsite(v) || v;
  return `${PREFIX[method]}: ${v}`;
}

export interface ParsedApply { method: ApplyMethod | null; value: string; alsoWhatsapp?: boolean }

/** Stored text → method + value (also understands old free-text contact info). */
export function parseApply(raw: string | undefined, kind: ApplyKind): ParsedApply {
  const text = (raw || '').trim();
  if (!text) return { method: null, value: '' };
  const prefixed = text.match(/^(whatsapp|email|phone|website)\s*:\s*(.+)$/is);
  if (prefixed) {
    const method = prefixed[1].toLowerCase() as ApplyMethod;
    return { method, value: prefixed[2].trim() };
  }
  const wa = text.match(/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?\+?(\d{7,15})/i);
  if (wa) return { method: 'whatsapp', value: `+${wa[1]}` };
  const email = text.match(EMAIL_RE);
  if (email) return { method: 'email', value: email[0].replace(/^mailto:/i, '') };
  const url = text.match(URL_RE);
  if (url && normalizeWebsite(url[0])) return { method: 'website', value: url[0] };
  const phone = text.match(PHONE_RE);
  if (phone && validPhone(phone[0])) {
    // A bare number: events always asked for WhatsApp; for jobs offer a call plus WhatsApp.
    if (kind === 'event' || /whats\s*app/i.test(text)) return { method: 'whatsapp', value: phone[0].trim() };
    return { method: 'phone', value: phone[0].trim(), alsoWhatsapp: true };
  }
  return { method: null, value: text };
}

/** Initial dropdown + input values when editing an existing listing. */
export function splitApply(raw: string | undefined, kind: ApplyKind): { method: ApplyMethod; value: string } {
  const parsed = parseApply(raw, kind);
  return { method: parsed.method || 'website', value: parsed.method ? parsed.value : (raw || '').trim() };
}

function hrefFor(method: ApplyMethod, value: string, kind: ApplyKind, title: string): string {
  const name = title.trim() || (kind === 'job' ? 'this job' : 'this event');
  if (method === 'website') return normalizeWebsite(value);
  if (method === 'whatsapp') {
    const text = kind === 'job'
      ? `Hello, I saw your job "${name}" on eChat and I would like to apply.`
      : `Hello, I saw your event "${name}" on eChat and I would like to register.`;
    return `https://wa.me/${whatsappDigits(value)}?text=${encodeURIComponent(text)}`;
  }
  if (method === 'email') {
    const subject = kind === 'job' ? `Application for ${name} via eChat` : `Registration for ${name} via eChat`;
    const body = kind === 'job' ? `Hello,\n\nI saw your job "${name}" on eChat and I would like to apply.\n\n` : `Hello,\n\nI saw your event "${name}" on eChat and I would like to register.\n\n`;
    return `mailto:${value.trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
  const digits = digitsOf(value);
  return `tel:${value.trim().startsWith('+') ? '+' : ''}${digits}`;
}

const LABELS: Record<ApplyKind, Record<ApplyMethod, string>> = {
  job: { website: 'Apply on Official Website', whatsapp: 'Apply on WhatsApp', email: 'Apply via Email', phone: 'Call to Apply' },
  event: { website: 'Register / Get Tickets', whatsapp: 'Contact Organizer on WhatsApp', email: 'Email Organizer', phone: 'Call Organizer' }
};

const NOTES: Record<ApplyKind, Record<ApplyMethod, string>> = {
  job: {
    website: 'You will be taken to the official website. eChat does not charge to apply.',
    whatsapp: 'Opens a WhatsApp chat with the employer. eChat does not charge to apply.',
    email: 'Opens your email app with the subject filled in. eChat does not charge to apply.',
    phone: 'Calls the employer directly. eChat does not charge to apply.'
  },
  event: {
    website: 'You will be taken to the organizer’s website. eChat does not charge to register there.',
    whatsapp: 'Opens a WhatsApp chat with the organizer.',
    email: 'Opens your email app with the subject filled in.',
    phone: 'Calls the organizer directly.'
  }
};

const ICONS: Record<ApplyMethod, React.ElementType> = { website: Globe, whatsapp: MessageCircle, email: Mail, phone: Phone };

const GOLD_BUTTON = 'bg-[linear-gradient(180deg,#ffe066_0%,#f5c518_55%,#d9a514_100%)] text-[#111111] shadow-[0_6px_18px_rgba(217,165,20,0.35)] hover:brightness-105';
const GREEN_BUTTON = 'bg-[#25D366] text-[#ffffff] shadow-[0_6px_18px_rgba(37,211,102,0.3)] hover:bg-[#1ebe5b]';
const PRIMARY = 'flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl px-4 text-base font-extrabold transition active:scale-[0.99]';
/** Secondary button: white with gold border (Save Job / Share Job). */
export const APPLY_SECONDARY = 'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-[#e2c06e] bg-[#ffffff] px-3 text-sm font-bold text-[#3b2f0b] transition hover:bg-[#fff8e1]';

export const ApplyActionsCard: React.FC<{
  kind: ApplyKind;
  contact: string | undefined;
  title: string;
  /** Extra white/gold buttons under the main one (e.g. Save Job, Share Job). */
  secondary?: React.ReactNode;
  className?: string;
}> = ({ kind, contact, title, secondary, className = '' }) => {
  const [copied, setCopied] = useState(false);
  const parsed = parseApply(contact, kind);
  const heading = kind === 'job' ? 'How to Apply' : 'How to Register';
  const href = parsed.method ? hrefFor(parsed.method, parsed.value, kind, title) : '';
  const method = href ? parsed.method : null;
  const shown = method === 'website' ? href.replace(/^https?:\/\//, '').replace(/\/$/, '') : parsed.value;
  const copyValue = method === 'website' ? href : parsed.value;
  const external = method === 'website' || method === 'whatsapp';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyValue);
    } catch {
      const area = document.createElement('textarea');
      area.value = copyValue;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const Icon = method ? (kind === 'event' && method === 'website' ? Ticket : ICONS[method]) : null;
  const alsoWhatsapp = method === 'phone' && parsed.alsoWhatsapp && whatsappDigits(parsed.value).length >= 8;

  return (
    <section aria-label={heading} style={{ colorScheme: 'light' }} className={`rounded-[20px] border-2 border-[#e2c06e] bg-[#ffffff] p-4 shadow-[0_8px_24px_rgba(217,178,90,0.18)] sm:p-5 ${className}`}>
      <h3 className="mb-3 text-xs font-extrabold uppercase tracking-[0.14em] text-[#8a6d1f]">{heading}</h3>

      {method && Icon ? (
        <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}
          className={`${PRIMARY} ${method === 'whatsapp' ? GREEN_BUTTON : GOLD_BUTTON}`}>
          <Icon size={20} className="shrink-0" />
          <span className="min-w-0 truncate">{LABELS[kind][method]}</span>
          {method === 'website' && <span aria-hidden="true" className="text-lg leading-none">→</span>}
        </a>
      ) : contact?.trim() ? (
        <p className="whitespace-pre-wrap break-words rounded-2xl bg-[#fffbeb] p-3 text-sm text-[#1f2937]">{parsed.value}</p>
      ) : (
        <p className="rounded-2xl bg-[#f8fafc] p-3 text-sm text-[#64748b]">{kind === 'job' ? 'No application details provided.' : 'No registration details provided.'}</p>
      )}

      {alsoWhatsapp && (
        <a href={hrefFor('whatsapp', parsed.value, kind, title)} target="_blank" rel="noopener noreferrer" className={`${PRIMARY} mt-2 min-h-11 text-sm ${GREEN_BUTTON}`}>
          <MessageCircle size={18} />{LABELS[kind].whatsapp}
        </a>
      )}

      {secondary && <div className="mt-2 flex gap-2">{secondary}</div>}

      {method && <p className="mt-3 text-xs leading-relaxed text-[#6b7280]">{NOTES[kind][method]}</p>}

      {contact?.trim() && (
        <div className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-[#6b7280]">
          {method ? (
            <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined} className="flex min-w-0 items-center gap-1 underline decoration-[#d1d5db] underline-offset-2 hover:text-[#374151]">
              {external && <ExternalLink size={12} className="shrink-0" />}
              <span className="truncate">{shown}</span>
            </a>
          ) : <span className="min-w-0 flex-1">Copy the details above to apply.</span>}
          <button type="button" onClick={() => void copy()} aria-label={method === 'website' ? 'Copy link' : 'Copy'} title={method === 'website' ? 'Copy link' : 'Copy'}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#111827]">
            {copied ? <Check size={14} className="text-[#16a34a]" /> : <Copy size={14} />}
          </button>
          {copied && <span role="status" className="shrink-0 font-semibold text-[#16a34a]">Copied</span>}
        </div>
      )}
    </section>
  );
};

/** Create / edit form: "Apply Method" dropdown + one input, validated per method. */
export const ApplyMethodField: React.FC<{
  kind: ApplyKind;
  idPrefix: string;
  method: ApplyMethod;
  value: string;
  onMethod: (method: ApplyMethod) => void;
  onValue: (value: string) => void;
  error?: string;
  labelClassName?: string;
  inputClassName?: string;
}> = ({ kind, idPrefix, method, value, onMethod, onValue, error, labelClassName = 'mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600', inputClassName = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm' }) => {
  const placeholders: Record<ApplyMethod, string> = {
    website: kind === 'job' ? 'e.g. jobs.unicef.org/apply' : 'e.g. tickets.myevent.com',
    whatsapp: '+232 76 123456',
    email: kind === 'job' ? 'e.g. hr@company.org' : 'e.g. info@myevent.com',
    phone: '+232 76 123456'
  };
  return (
    <div>
      <label htmlFor={`${idPrefix}-method`} className={labelClassName}>{kind === 'job' ? 'How to Apply' : 'How to Register / Contact'}</label>
      <div className="flex gap-2">
        <select id={`${idPrefix}-method`} aria-label={kind === 'job' ? 'Apply method' : 'Registration method'} value={method} onChange={e => onMethod(e.target.value as ApplyMethod)}
          className={`${inputClassName} w-[42%]! shrink-0`}>
          {APPLY_METHODS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <input id={`${idPrefix}-value`} aria-label={APPLY_METHODS.find(option => option.value === method)?.label} value={value} onChange={e => onValue(e.target.value)}
          type={method === 'email' ? 'email' : method === 'website' ? 'url' : 'tel'} inputMode={method === 'email' ? 'email' : method === 'website' ? 'url' : 'tel'}
          autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={method === 'website' ? 280 : 60}
          placeholder={placeholders[method]} aria-invalid={Boolean(error)} className={`${inputClassName} min-w-0 flex-1 ${error ? 'border-rose-400!' : ''}`} />
      </div>
      {error ? <p role="alert" className="mt-1 text-xs text-rose-600">{error}</p>
        : <p className="mt-1 text-[11px] text-slate-500">{method === 'website' ? 'https:// is added automatically.' : method === 'whatsapp' ? 'Include the country code so the WhatsApp button works.' : method === 'email' ? 'People tap a button to email you.' : 'People tap a button to call you.'}</p>}
    </div>
  );
};
