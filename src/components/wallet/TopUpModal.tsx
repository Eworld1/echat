import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, Copy, ImagePlus, Loader2, X } from 'lucide-react';
import { api } from '../../services/api';
import {
  formatLe,
  MAX_TOPUP,
  MIN_TOPUP,
  PAYMENT_NUMBER,
  submitTopUp,
  TOPUP_PRESETS,
  topUpAmountError,
  walletErrorMessage
} from '../../services/wallet';

const PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PROOF_INPUT_BYTES = 15 * 1024 * 1024;
/** The existing upload endpoint accepts at most 2 MB, so larger screenshots are shrunk first. */
const UPLOAD_LIMIT_BYTES = 2 * 1024 * 1024;

async function shrinkScreenshot(file: File): Promise<File> {
  if (file.size <= 1.5 * 1024 * 1024) return file;
  const bitmapUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Could not read this image. Try a JPG or PNG screenshot.'));
      element.src = bitmapUrl;
    });
    for (const [maxSide, quality] of [[1800, 0.85], [1400, 0.8], [1100, 0.75]] as const) {
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= UPLOAD_LIMIT_BYTES) return new File([blob], 'payment-proof.jpg', { type: 'image/jpeg' });
    }
    throw new Error('Screenshot is too large. Crop it and try again.');
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

interface TopUpModalProps {
  user: { id: string; name: string };
  onClose: () => void;
}

export const TopUpModal: React.FC<TopUpModalProps> = ({ user, onClose }) => {
  const [step, setStep] = useState<'amount' | 'pay' | 'done'>('amount');
  const [preset, setPreset] = useState<number | 'custom'>(100_000);
  const [custom, setCustom] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const amount = preset === 'custom' ? Number(custom.replace(/[,\s]/g, '')) : preset;
  const amountError = preset === 'custom' && custom.trim() === '' ? 'Enter an amount.' : topUpAmountError(amount);

  useEffect(() => {
    if (!proofFile) { setProofPreview(''); return; }
    const url = URL.createObjectURL(proofFile);
    setProofPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [proofFile]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const pickProof = (file: File | undefined) => {
    setError('');
    if (!file) return;
    if (!PROOF_TYPES.includes(file.type)) { setError('Proof must be a JPG, PNG or WEBP screenshot.'); return; }
    if (file.size > MAX_PROOF_INPUT_BYTES) { setError('Screenshot is too large (max 15 MB).'); return; }
    setProofFile(file);
  };

  const copyNumber = async () => {
    if (!PAYMENT_NUMBER) return;
    try { await navigator.clipboard.writeText(PAYMENT_NUMBER); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (transactionId.trim().length < 4) { setError('Enter the Transaction ID from your Orange Money / Africell Money SMS.'); return; }
    if (!proofFile) { setError('Upload a screenshot of your payment as proof.'); return; }
    setBusy(true);
    try {
      const proofUrl = await api.uploadFile(await shrinkScreenshot(proofFile));
      await submitTopUp(user, { amount, transactionId, proofUrl });
      setStep('done');
    } catch (err) {
      setError(walletErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Top up wallet">
      <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          {step === 'pay' && !busy && (
            <button type="button" onClick={() => { setStep('amount'); setError(''); }} aria-label="Back to amount" className="grid h-9 w-9 place-items-center rounded-full hover:bg-slate-100"><ChevronLeft size={20} /></button>
          )}
          <h2 className="flex-1 text-base font-extrabold text-slate-900">{step === 'done' ? 'Top-up submitted' : 'Top-up Wallet'}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full hover:bg-slate-100 disabled:opacity-40"><X size={20} /></button>
        </header>

        <div className="overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {step === 'amount' && (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-slate-700">Choose amount</p>
              <div className="grid grid-cols-2 gap-2">
                {TOPUP_PRESETS.map(value => (
                  <button key={value} type="button" onClick={() => setPreset(value)} aria-pressed={preset === value}
                    className={`min-h-12 rounded-xl border text-sm font-bold transition ${preset === value ? 'border-[#1877F2] bg-[#E7F0FD] text-[#1877F2]' : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'}`}>
                    {formatLe(value)}
                  </button>
                ))}
                <button type="button" onClick={() => setPreset('custom')} aria-pressed={preset === 'custom'}
                  className={`col-span-2 min-h-12 rounded-xl border text-sm font-bold transition ${preset === 'custom' ? 'border-[#1877F2] bg-[#E7F0FD] text-[#1877F2]' : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'}`}>
                  Custom amount
                </button>
              </div>
              {preset === 'custom' && (
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">Amount (Le)</span>
                  <input autoFocus inputMode="numeric" value={custom} onChange={event => setCustom(event.target.value.replace(/[^\d,]/g, ''))}
                    placeholder={`${MIN_TOPUP.toLocaleString('en-US')} – ${MAX_TOPUP.toLocaleString('en-US')}`}
                    className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-[#1877F2] focus:ring-2 focus:ring-[#1877F2]/20" />
                  {custom.trim() !== '' && amountError && <span className="mt-1 block text-xs text-rose-600">{amountError}</span>}
                </label>
              )}
              <button type="button" disabled={Boolean(amountError)} onClick={() => setStep('pay')}
                className="min-h-12 w-full rounded-xl bg-[#1877F2] text-sm font-bold text-white disabled:opacity-50">
                Continue{amountError ? '' : ` with ${formatLe(amount)}`}
              </button>
            </div>
          )}

          {step === 'pay' && (
            <form onSubmit={submit} className="space-y-4">
              <div className="rounded-2xl bg-orange-50 p-4 text-sm text-slate-800">
                <p className="font-bold">Send to Orange Money:</p>
                <div className="mt-1 flex items-center gap-2">
                  <strong className="font-mono text-base">{PAYMENT_NUMBER || 'Contact EChat for number'}</strong>
                  {PAYMENT_NUMBER && (
                    <button type="button" onClick={() => void copyNumber()} className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-white px-2 text-xs font-bold text-[#1877F2]">
                      <Copy size={13} />{copied ? 'Copied' : 'Copy'}
                    </button>
                  )}
                </div>
                <ol className="mt-3 list-decimal space-y-1 pl-5 text-[13px]">
                  <li>Send money via Orange Money / Africell Money to number above</li>
                  <li>Copy Transaction ID</li>
                  <li>Upload screenshot proof</li>
                </ol>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">Amount</span>
                <input value={formatLe(amount)} readOnly aria-readonly="true" className="min-h-12 w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-3 text-base font-bold text-slate-700" />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">Transaction ID *</span>
                <input required value={transactionId} onChange={event => setTransactionId(event.target.value)} maxLength={100} autoComplete="off"
                  placeholder="e.g. MP241123.1532.A12345"
                  className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-[#1877F2] focus:ring-2 focus:ring-[#1877F2]/20" />
              </label>

              <div>
                <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">Upload Proof Screenshot *</span>
                {proofPreview && <img src={proofPreview} alt="Payment proof preview" className="mb-2 max-h-56 w-full rounded-xl border border-slate-200 object-contain" />}
                <button type="button" onClick={() => fileInput.current?.click()}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50">
                  <ImagePlus size={18} />{proofFile ? 'Change screenshot' : 'Upload Proof Screenshot'}
                </button>
                <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => { pickProof(event.target.files?.[0]); event.target.value = ''; }} />
              </div>

              {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

              <button type="submit" disabled={busy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1877F2] text-sm font-bold text-white disabled:opacity-60">
                {busy && <Loader2 size={18} className="animate-spin" />}{busy ? 'Submitting…' : 'Submit Top-up'}
              </button>
              <p className="text-center text-xs text-slate-500">Your balance updates after EChat confirms the payment.</p>
            </form>
          )}

          {step === 'done' && (
            <div className="space-y-4 py-4 text-center">
              <CheckCircle2 size={52} className="mx-auto text-emerald-500" />
              <p className="text-lg font-extrabold text-slate-900">Top-up submitted, waiting for approval</p>
              <p className="text-sm text-slate-600">{formatLe(amount)} is shown as Pending until an admin checks your payment.</p>
              <button type="button" onClick={onClose} className="min-h-12 w-full rounded-xl bg-[#1877F2] text-sm font-bold text-white">Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
