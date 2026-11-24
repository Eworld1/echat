import React, { useEffect, useState } from 'react';
import { ArrowLeft, BadgeCheck, CheckCircle2, Flag, Heart, Loader2, MapPin, MessageCircle, Pencil, Phone, RotateCcw, Share2, ShieldCheck, Tag, Trash2, UserRound } from 'lucide-react';
import { api } from '../../services/api';
import type { User } from '../../types';
import { getMarketSellerProfile, getV2Listing, type MarketSellerProfile } from '../../services/v2Market';
import {
  REPORT_REASONS, categoryOf, deleteListing, formatPrice, listingLink, marketErrorMessage, reportListing, setListingSold, timeAgo, type Listing
} from '../../services/market';
import { ConfirmDialog, PhotoGallery } from '../../components/market/MarketUI';
import { UserAvatar } from '../../components/UserAvatar';

interface Props {
  id: string;
  /** Live copy from the Marketplace listener (instant updates); fetched directly if not loaded yet. */
  live?: Listing | null;
  me: User | null;
  saved: boolean;
  onToggleSave: (listing: Listing) => void;
  onBack: () => void;
  onNavigate: (route: string) => void;
  onChat: (listing: Listing, seller: User) => void;
  onViewProfile?: (userId: string) => void;
}

export const ListingDetail: React.FC<Props> = ({ id, live, me, saved, onToggleSave, onBack, onNavigate, onChat, onViewProfile }) => {
  const [fetched, setFetched] = useState<Listing | null | undefined>(undefined);
  const [seller, setSeller] = useState<User | null>(null);
  const [sellerProfile, setSellerProfile] = useState<MarketSellerProfile | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reporting, setReporting] = useState(false);
  const listing = live ?? fetched ?? null;

  useEffect(() => {
    if (live) return;
    let active = true;
    void getV2Listing(id).then(item => { if (active) setFetched(item as Listing | null); }).catch(() => { if (active) setFetched(null); });
    return () => { active = false; };
  }, [id, live]);

  const sellerId = listing?.sellerId || '';
  useEffect(() => {
    if (!sellerId) return;
    let active = true;
    void api.getUserProfile(sellerId).then(result => { if (active) setSeller(result.user); }).catch(() => {});
    void getMarketSellerProfile(sellerId).then(profile => { if (active) setSellerProfile(profile); }).catch(() => {});
    return () => { active = false; };
  }, [sellerId]);

  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 3000); return () => window.clearTimeout(timer); }, [notice]);

  if (!listing) {
    if (fetched === undefined && !live) return <div className="mx-auto max-w-5xl animate-pulse space-y-3"><div className="aspect-square rounded-2xl bg-slate-200 sm:aspect-[4/3]" /><div className="h-6 w-40 rounded bg-slate-200" /><div className="h-4 w-64 rounded bg-slate-100" /></div>;
    return (
      <div className="mx-auto max-w-xl rounded-2xl bg-white p-8 text-center shadow-sm">
        <p className="text-lg font-extrabold text-slate-900">This listing is no longer available</p>
        <p className="mt-1 text-sm text-slate-600">It may have been deleted by the seller.</p>
        <button type="button" onClick={onBack} className="mt-4 min-h-11 rounded-xl bg-[#1877F2] px-5 text-sm font-bold text-white">Back to Marketplace</button>
      </div>
    );
  }

  const isOwner = me?.id === listing.sellerId;
  const sold = listing.status === 'sold';
  const sellerName = sellerProfile?.shopName || seller?.name || listing.sellerName || 'Seller';
  const joined = seller?.createdAt ? new Date(seller.createdAt).toLocaleDateString([], { month: 'long', year: 'numeric' }) : '';

  const chat = async () => {
    if (!me) { setNotice('Sign in to chat with the seller.'); return; }
    try {
      const partner = seller || (await api.getUserProfile(listing.sellerId)).user;
      onChat(listing, partner);
    } catch { setError('Could not open the chat. Try again.'); }
  };
  const share = async () => {
    const url = listingLink(listing.id);
    try {
      if (navigator.share) await navigator.share({ title: listing.title, text: `${listing.title} — ${formatPrice(listing.price)} on EChat Marketplace`, url });
      else { await navigator.clipboard.writeText(url); setNotice('Link copied'); }
    } catch (err) { if ((err as DOMException)?.name !== 'AbortError') setNotice(url); }
  };
  const toggleSold = async () => {
    setBusy(true);
    try { await setListingSold(listing.id, !sold); setNotice(sold ? 'Listing is available again' : 'Marked as sold'); if (!live) setFetched({ ...listing, status: sold ? 'active' : 'sold' }); }
    catch (err) { setError(marketErrorMessage(err)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await deleteListing(listing.id); onNavigate('/marketplace/mine'); }
    catch (err) { setError(marketErrorMessage(err)); setBusy(false); setConfirmDelete(false); }
  };
  const report = async (reason: string) => {
    if (!me) return;
    setReporting(false);
    try { await reportListing(listing.id, me.id, reason); setNotice('Thanks — our team will review this listing.'); }
    catch (err) { setError(marketErrorMessage(err)); }
  };

  return (
    <div className="mx-auto max-w-5xl pb-[calc(96px+env(safe-area-inset-bottom))] lg:pb-8">
      <button type="button" onClick={onBack} className="mb-2 flex min-h-10 items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-900"><ArrowLeft size={18} />Marketplace</button>
      {notice && <div role="status" className="fixed left-1/2 top-[max(1rem,env(safe-area-inset-top))] z-[95] -translate-x-1/2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-xl">{notice}</div>}
      {error && <p role="alert" className="mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
          <PhotoGallery photos={listing.photos || []} title={listing.title} />
        </div>

        <div className="space-y-3">
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
            {sold && <span className="mb-2 inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-0.5 text-xs font-extrabold text-white"><CheckCircle2 size={13} />SOLD</span>}
            <h1 className="text-xl font-extrabold leading-tight text-slate-900">{listing.title}</h1>
            <p className={`mt-1 text-2xl font-black ${listing.price <= 0 ? 'text-emerald-600' : 'text-slate-900'}`}>{formatPrice(listing.price)}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-slate-500"><MapPin size={14} />{listing.location || 'Sierra Leone'}<span aria-hidden="true">·</span>Listed {timeAgo(listing.createdAt)}</p>

            {!isOwner && (
              <div className="mt-4 grid grid-cols-[1fr_auto_auto] gap-2">
                <button type="button" onClick={() => void chat()} disabled={sold} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#1877F2] text-sm font-extrabold text-white hover:bg-[#166FE5] disabled:opacity-50"><MessageCircle size={18} />Chat Seller</button>
                <button type="button" onClick={() => onToggleSave(listing)} aria-pressed={saved} aria-label={saved ? 'Remove from Saved' : 'Save'} className={`grid h-12 w-12 place-items-center rounded-xl ${saved ? 'bg-rose-50 text-rose-600' : 'bg-[#F0F2F5] text-slate-800'}`}><Heart size={20} className={saved ? 'fill-rose-500' : ''} /></button>
                <button type="button" onClick={() => void share()} aria-label="Share" className="grid h-12 w-12 place-items-center rounded-xl bg-[#F0F2F5] text-slate-800"><Share2 size={20} /></button>
              </div>
            )}
            {isOwner && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => onNavigate(`/marketplace/edit/${encodeURIComponent(listing.id)}`)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#F0F2F5] text-sm font-bold text-slate-900"><Pencil size={16} />Edit</button>
                <button type="button" onClick={() => void toggleSold()} disabled={busy} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold ${sold ? 'bg-[#E7F0FD] text-[#1877F2]' : 'bg-emerald-50 text-emerald-700'}`}>{busy ? <Loader2 size={16} className="animate-spin" /> : sold ? <RotateCcw size={16} /> : <CheckCircle2 size={16} />}{sold ? 'Mark available' : 'Mark as Sold'}</button>
                <button type="button" onClick={() => void share()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#F0F2F5] text-sm font-bold text-slate-900"><Share2 size={16} />Share</button>
                <button type="button" onClick={() => setConfirmDelete(true)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-50 text-sm font-bold text-rose-700"><Trash2 size={16} />Delete</button>
              </div>
            )}
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
            <h2 className="text-base font-extrabold text-slate-900">Details</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
              <dt className="text-slate-500">Condition</dt><dd className="font-semibold text-slate-900">{listing.condition || '—'}</dd>
              <dt className="text-slate-500">Category</dt><dd className="font-semibold text-slate-900">{categoryOf(listing)}</dd>
              <dt className="text-slate-500">Location</dt><dd className="font-semibold text-slate-900">{listing.location || '—'}</dd>
            </dl>
            {listing.description && <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-800">{listing.description}</p>}
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
            <h2 className="mb-3 text-base font-extrabold text-slate-900">Seller information</h2>
            <div className="flex items-center gap-3">
              <UserAvatar src={seller?.avatar || listing.sellerAvatar} name={sellerName} size={52} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 truncate font-extrabold text-slate-900">{sellerName}{(listing.sellerVerified || seller?.isVerified) && <BadgeCheck size={16} className="shrink-0 text-[#1877F2]" />}</p>
                {joined && <p className="text-xs text-slate-500">Joined EChat in {joined}</p>}
                {sellerProfile?.location && <p className="text-xs text-slate-500">{sellerProfile.location}</p>}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => onViewProfile ? onViewProfile(listing.sellerId) : onNavigate(`/marketplace/seller/${listing.sellerId}`)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#F0F2F5] text-sm font-bold text-slate-900"><UserRound size={16} />View Profile</button>
              <button type="button" onClick={() => onNavigate(`/marketplace/seller/${listing.sellerId}`)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#F0F2F5] text-sm font-bold text-slate-900"><Tag size={16} />Seller's items</button>
              {!isOwner && sellerProfile?.showContactInfo && sellerProfile.whatsappNumber && <a href={`https://wa.me/${sellerProfile.whatsappNumber.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi, I'm interested in your ${listing.title} on EChat`)}`} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center justify-center rounded-xl bg-[#25D366] text-sm font-bold text-white">WhatsApp</a>}
              {!isOwner && sellerProfile?.showContactInfo && sellerProfile.phoneNumber && <a href={`tel:${sellerProfile.phoneNumber}`} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 text-sm font-bold text-slate-800"><Phone size={16} />Call</a>}
            </div>
          </section>

          <section className="flex gap-3 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
            <ShieldCheck size={22} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="text-sm text-amber-900">
              <p className="font-extrabold">Stay safe</p>
              <p>Meet in public, check item before paying. Never send money before you see the item.</p>
            </div>
          </section>

          {!isOwner && me && (
            <div className="relative">
              <button type="button" onClick={() => setReporting(value => !value)} className="flex min-h-10 items-center gap-2 text-sm font-semibold text-slate-500 hover:text-rose-600"><Flag size={15} />Report this listing</button>
              {reporting && (
                <div className="mt-1 space-y-1 rounded-2xl bg-white p-2 shadow-lg ring-1 ring-slate-200" role="menu">
                  {REPORT_REASONS.map(reason => <button key={reason} type="button" role="menuitem" onClick={() => void report(reason)} className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50">{reason}</button>)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {confirmDelete && <ConfirmDialog title="Delete listing?" text="Are you sure you want to delete this listing? This cannot be undone." confirmLabel="Delete" danger busy={busy} onConfirm={() => void remove()} onCancel={() => setConfirmDelete(false)} />}
    </div>
  );
};
