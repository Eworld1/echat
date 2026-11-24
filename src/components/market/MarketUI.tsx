import React, { useEffect, useRef, useState } from 'react';
import { Bookmark, ChevronLeft, ChevronRight, Heart, MapPin, Package, Plus, ShoppingBag, Store, Tag, X } from 'lucide-react';
import { assetUrl } from '../../services/apiBase';
import { formatPrice, timeAgo, type Listing } from '../../services/market';
import { UserAvatar } from '../UserAvatar';

/** Listing photo that never shows a broken image (falls back to a neutral placeholder). */
export const ListingImage: React.FC<{ src?: string; alt: string; className?: string; eager?: boolean }> = ({ src, alt, className = '', eager }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <div className={`grid place-items-center bg-slate-100 text-slate-300 ${className}`} aria-label={alt}><ShoppingBag size={34} /></div>;
  return <img src={assetUrl(src)} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} className={`bg-slate-100 object-cover ${className}`} />;
};

export const ListingCard: React.FC<{ item: Listing; saved?: boolean; onOpen: () => void; onToggleSave?: () => void; footer?: React.ReactNode }> = ({ item, saved, onOpen, onToggleSave, footer }) => (
  <article className="group relative min-w-0 overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06),0_2px_10px_rgba(15,23,42,0.05)] ring-1 ring-slate-200/70 transition hover:shadow-md">
    <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={`${item.title}, ${formatPrice(item.price)}`}>
      <div className="relative aspect-square overflow-hidden">
        <ListingImage src={item.photos?.[0]} alt={item.title} className="h-full w-full transition duration-300 group-hover:scale-[1.03]" />
        {item.status === 'sold' && <span className="absolute left-2 top-2 rounded-md bg-slate-900/85 px-2 py-0.5 text-[11px] font-extrabold tracking-wide text-white">SOLD</span>}
        {(item.photos?.length || 0) > 1 && <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold text-white">1/{item.photos.length}</span>}
      </div>
      <div className="space-y-0.5 p-2.5">
        <p className={`text-[15px] font-extrabold leading-tight ${item.price <= 0 ? 'text-emerald-600' : 'text-slate-900'}`}>{formatPrice(item.price)}</p>
        <p className="line-clamp-2 min-h-[2.5em] text-[13px] leading-snug text-slate-700">{item.title}</p>
        <p className="flex items-center gap-1 truncate text-[11px] text-slate-500"><MapPin size={11} className="shrink-0" /><span className="truncate">{item.location || 'Sierra Leone'}</span><span aria-hidden="true">·</span><span className="shrink-0">{timeAgo(item.createdAt)}</span></p>
        <p className="flex items-center gap-1.5 pt-1.5 text-[11px] font-semibold text-slate-600">
          <UserAvatar src={item.sellerAvatar} name={item.sellerName || 'Seller'} size={18} />
          <span className="truncate">{item.sellerName || 'EChat seller'}</span>
        </p>
      </div>
    </button>
    {onToggleSave && (
      <button type="button" onClick={onToggleSave} aria-pressed={saved} aria-label={saved ? 'Remove from Saved' : 'Save'}
        className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-slate-700 shadow-sm backdrop-blur transition hover:scale-105">
        <Heart size={17} className={saved ? 'fill-rose-500 text-rose-500' : ''} />
      </button>
    )}
    {footer && <div className="border-t border-slate-100 p-2">{footer}</div>}
  </article>
);

export const CardSkeleton: React.FC = () => (
  <div className="animate-pulse overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/70" aria-hidden="true">
    <div className="aspect-square bg-slate-200" />
    <div className="space-y-2 p-2.5"><div className="h-4 w-20 rounded bg-slate-200" /><div className="h-3 w-full rounded bg-slate-100" /><div className="h-3 w-2/3 rounded bg-slate-100" /></div>
  </div>
);

export const EmptyState: React.FC<{ title: string; text: string; action?: React.ReactNode; icon?: React.ReactNode }> = ({ title, text, action, icon }) => (
  <div className="col-span-full rounded-2xl bg-white px-6 py-10 text-center shadow-sm ring-1 ring-slate-200/70">
    <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-[#E7F0FD] text-[#1877F2]">{icon || <Store size={30} />}</div>
    <p className="text-lg font-extrabold text-slate-900">{title}</p>
    <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{text}</p>
    {action && <div className="mt-5">{action}</div>}
  </div>
);

export const ConfirmDialog: React.FC<{ title: string; text: string; confirmLabel: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void }> = ({ title, text, confirmLabel, danger, busy, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-[95] grid place-items-center bg-black/55 p-4" role="alertdialog" aria-modal="true" aria-label={title}>
    <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-center shadow-2xl">
      <h2 className="text-lg font-extrabold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{text}</p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-xl border border-slate-300 text-sm font-bold text-slate-700">Cancel</button>
        <button type="button" disabled={busy} onClick={onConfirm} className={`min-h-11 rounded-xl text-sm font-bold text-white disabled:opacity-60 ${danger ? 'bg-rose-600' : 'bg-[#1877F2]'}`}>{busy ? 'Please wait…' : confirmLabel}</button>
      </div>
    </div>
  </div>
);

export type MarketSection = 'browse' | 'sell' | 'mine' | 'saved' | 'orders';

/** Facebook-style Marketplace top navigation. */
export const MarketNav: React.FC<{ active: MarketSection; onNavigate: (route: string) => void; savedCount?: number }> = ({ active, onNavigate, savedCount }) => {
  const items: { id: MarketSection; label: string; icon: React.ReactNode; route: string }[] = [
    { id: 'browse', label: 'Browse', icon: <Store size={16} />, route: '/marketplace' },
    { id: 'sell', label: 'Sell', icon: <Plus size={16} />, route: '/marketplace/sell' },
    { id: 'mine', label: 'My Listings', icon: <Tag size={16} />, route: '/marketplace/mine' },
    { id: 'saved', label: `Saved${savedCount ? ` (${savedCount})` : ''}`, icon: <Bookmark size={16} />, route: '/marketplace/saved' },
    { id: 'orders', label: 'Orders', icon: <Package size={16} />, route: '/orders' }
  ];
  return (
    <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" aria-label="Marketplace">
      {items.map(item => (
        <button key={item.id} type="button" onClick={() => onNavigate(item.route)} aria-current={active === item.id ? 'page' : undefined}
          className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-bold transition ${active === item.id ? 'bg-[#1877F2] text-white' : item.id === 'sell' ? 'bg-[#E7F0FD] text-[#1877F2]' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
          {item.icon}{item.label}
        </button>
      ))}
    </nav>
  );
};

/** Swipeable photo gallery (scroll-snap) with dots, arrows on desktop, and tap for full screen. */
export const PhotoGallery: React.FC<{ photos: string[]; title: string }> = ({ photos, title }) => {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState<number | null>(null);
  const list = photos.length ? photos : [''];
  const goTo = (next: number) => {
    const element = track.current;
    if (!element) return;
    const target = Math.max(0, Math.min(list.length - 1, next));
    element.scrollTo({ left: target * element.clientWidth, behavior: 'smooth' });
  };
  useEffect(() => {
    if (fullscreen === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(null);
      if (event.key === 'ArrowRight') setFullscreen(value => (value === null ? value : Math.min(list.length - 1, value + 1)));
      if (event.key === 'ArrowLeft') setFullscreen(value => (value === null ? value : Math.max(0, value - 1)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, list.length]);

  return (
    <div className="relative bg-slate-900">
      <div ref={track} onScroll={event => { const element = event.currentTarget; setIndex(Math.round(element.scrollLeft / Math.max(1, element.clientWidth))); }}
        className="flex aspect-square snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] sm:aspect-[4/3]">
        {list.map((photo, photoIndex) => (
          <button key={`${photo}-${photoIndex}`} type="button" onClick={() => photo && setFullscreen(photoIndex)} className="relative h-full w-full shrink-0 snap-center" aria-label={`Open photo ${photoIndex + 1} of ${list.length}`}>
            {photo && <img src={assetUrl(photo)} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-xl" />}
            <ListingImage src={photo} alt={`${title} — photo ${photoIndex + 1}`} eager={photoIndex === 0} className="relative h-full w-full !object-contain !bg-transparent" />
          </button>
        ))}
      </div>
      {list.length > 1 && (
        <>
          <button type="button" onClick={() => goTo(index - 1)} disabled={index === 0} aria-label="Previous photo" className="absolute left-2 top-1/2 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-slate-800 shadow disabled:opacity-0 sm:grid"><ChevronLeft size={22} /></button>
          <button type="button" onClick={() => goTo(index + 1)} disabled={index === list.length - 1} aria-label="Next photo" className="absolute right-2 top-1/2 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-slate-800 shadow disabled:opacity-0 sm:grid"><ChevronRight size={22} /></button>
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5" aria-hidden="true">
            {list.map((_, dot) => <span key={dot} className={`h-1.5 rounded-full transition-all ${dot === index ? 'w-5 bg-white' : 'w-1.5 bg-white/55'}`} />)}
          </div>
          <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-bold text-white">{index + 1}/{list.length}</span>
        </>
      )}
      {fullscreen !== null && (
        <div className="fixed inset-0 z-[96] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="Photo viewer">
          <div className="flex items-center justify-between p-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
            <span className="text-sm font-bold">{fullscreen + 1} / {list.length}</span>
            <button type="button" onClick={() => setFullscreen(null)} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full bg-white/15"><X size={22} /></button>
          </div>
          <div className="relative flex-1">
            <img src={assetUrl(list[fullscreen])} alt={`${title} — photo ${fullscreen + 1}`} className="absolute inset-0 h-full w-full object-contain" />
            {fullscreen > 0 && <button type="button" onClick={() => setFullscreen(fullscreen - 1)} aria-label="Previous photo" className="absolute left-2 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/20 text-white"><ChevronLeft size={26} /></button>}
            {fullscreen < list.length - 1 && <button type="button" onClick={() => setFullscreen(fullscreen + 1)} aria-label="Next photo" className="absolute right-2 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/20 text-white"><ChevronRight size={26} /></button>}
          </div>
        </div>
      )}
    </div>
  );
};
