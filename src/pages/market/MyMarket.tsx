import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Heart, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { getV2Listing } from '../../services/v2Market';
import { deleteListing, marketErrorMessage, setListingSold, type Listing } from '../../services/market';
import { CardSkeleton, ConfirmDialog, EmptyState, ListingCard, MarketNav } from '../../components/market/MarketUI';

interface MineProps { listings: Listing[]; loading: boolean; uid: string; favorites: Set<string>; onNavigate: (route: string) => void }

export const MyListings: React.FC<MineProps> = ({ listings, loading, uid, favorites, onNavigate }) => {
  const [tab, setTab] = useState<'active' | 'sold'>('active');
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [toDelete, setToDelete] = useState<Listing | null>(null);
  const mine = useMemo(() => listings.filter(item => item.sellerId === uid).sort((a, b) => b.createdAt - a.createdAt), [listings, uid]);
  const shown = mine.filter(item => (tab === 'sold' ? item.status === 'sold' : item.status !== 'sold'));
  const counts = { active: mine.filter(item => item.status !== 'sold').length, sold: mine.filter(item => item.status === 'sold').length };

  const run = async (id: string, task: () => Promise<void>) => {
    setBusyId(id); setError('');
    try { await task(); } catch (err) { setError(marketErrorMessage(err)); } finally { setBusyId(''); }
  };

  return (
    <div className="mx-auto max-w-[1200px] space-y-3 pb-[calc(96px+env(safe-area-inset-bottom))] lg:pb-8">
      <header className="space-y-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70 sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-black tracking-tight text-slate-900">My Listings</h1>
          <button type="button" onClick={() => onNavigate('/marketplace/sell')} className="flex min-h-10 items-center gap-1.5 rounded-full bg-[#1877F2] px-4 text-sm font-bold text-white"><Plus size={17} />Sell</button>
        </div>
        <MarketNav active="mine" onNavigate={onNavigate} savedCount={favorites.size} />
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#F0F2F5] p-1" role="tablist">
          {(['active', 'sold'] as const).map(id => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`min-h-10 rounded-lg text-sm font-bold ${tab === id ? 'bg-white text-[#1877F2] shadow-sm' : 'text-slate-600'}`}>
              {id === 'active' ? 'Active' : 'Sold'} ({counts[id]})
            </button>
          ))}
        </div>
      </header>
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
        {loading ? Array.from({ length: 4 }, (_, index) => <CardSkeleton key={index} />)
          : shown.length === 0 ? (
            tab === 'active'
              ? <EmptyState title="No listings yet - Be the first to sell" text="Your items for sale will appear here." action={<button type="button" onClick={() => onNavigate('/marketplace/sell')} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#1877F2] px-5 text-sm font-bold text-white"><Plus size={17} />Sell something</button>} />
              : <EmptyState title="Nothing sold yet" text="When you mark an item as sold it moves here." icon={<CheckCircle2 size={30} />} />
          ) : shown.map(item => (
            <ListingCard key={item.id} item={item} onOpen={() => onNavigate(`/marketplace/listing/${encodeURIComponent(item.id)}`)}
              footer={
                <div className="grid grid-cols-3 gap-1">
                  <button type="button" onClick={() => onNavigate(`/marketplace/edit/${encodeURIComponent(item.id)}`)} aria-label={`Edit ${item.title}`} className="flex min-h-9 items-center justify-center gap-1 rounded-lg bg-[#F0F2F5] text-xs font-bold text-slate-800"><Pencil size={13} />Edit</button>
                  <button type="button" disabled={busyId === item.id} onClick={() => void run(item.id, () => setListingSold(item.id, item.status !== 'sold'))} aria-label={item.status === 'sold' ? `Mark ${item.title} available` : `Mark ${item.title} sold`}
                    className={`flex min-h-9 items-center justify-center gap-1 rounded-lg text-xs font-bold ${item.status === 'sold' ? 'bg-[#E7F0FD] text-[#1877F2]' : 'bg-emerald-50 text-emerald-700'}`}>
                    {item.status === 'sold' ? <><RotateCcw size={13} />Relist</> : <><CheckCircle2 size={13} />Sold</>}
                  </button>
                  <button type="button" onClick={() => setToDelete(item)} aria-label={`Delete ${item.title}`} className="flex min-h-9 items-center justify-center gap-1 rounded-lg bg-rose-50 text-xs font-bold text-rose-700"><Trash2 size={13} />Delete</button>
                </div>
              } />
          ))}
      </div>
      {toDelete && <ConfirmDialog title="Delete listing?" text={`Delete “${toDelete.title}”? This cannot be undone.`} confirmLabel="Delete" danger busy={busyId === toDelete.id}
        onCancel={() => setToDelete(null)} onConfirm={() => void run(toDelete.id, async () => { await deleteListing(toDelete.id); setToDelete(null); })} />}
    </div>
  );
};

interface SavedProps { listings: Listing[]; loading: boolean; favorites: Set<string>; onToggleFavorite: (listing: Listing) => void; onNavigate: (route: string) => void }

export const SavedListings: React.FC<SavedProps> = ({ listings, loading, favorites, onToggleFavorite, onNavigate }) => {
  const known = useMemo(() => new Map(listings.map(item => [item.id, item])), [listings]);
  const [extra, setExtra] = useState<Map<string, Listing | null>>(new Map());
  // Saved items not in the live list (e.g. sold long ago): fetch them once.
  useEffect(() => {
    if (loading) return;
    const missing = [...favorites].filter(id => !known.has(id) && !extra.has(id));
    if (!missing.length) return;
    void Promise.all(missing.map(async id => [id, (await getV2Listing(id).catch(() => null)) as Listing | null] as const)).then(entries => setExtra(current => new Map([...current, ...entries])));
  }, [favorites, known, extra, loading]);
  const saved = [...favorites].map(id => known.get(id) || extra.get(id)).filter((item): item is Listing => Boolean(item));
  const gone = [...favorites].filter(id => extra.get(id) === null);

  return (
    <div className="mx-auto max-w-[1200px] space-y-3 pb-[calc(96px+env(safe-area-inset-bottom))] lg:pb-8">
      <header className="space-y-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70 sm:p-4">
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Saved items</h1>
        <MarketNav active="saved" onNavigate={onNavigate} savedCount={favorites.size} />
      </header>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
        {loading ? Array.from({ length: 4 }, (_, index) => <CardSkeleton key={index} />)
          : saved.length === 0 ? <EmptyState title="No saved items yet" text="Tap the ♥ on any listing to save it here." icon={<Heart size={30} />} action={<button type="button" onClick={() => onNavigate('/marketplace')} className="min-h-11 rounded-xl bg-[#1877F2] px-5 text-sm font-bold text-white">Browse Marketplace</button>} />
            : saved.map(item => <ListingCard key={item.id} item={item} saved onToggleSave={() => onToggleFavorite(item)} onOpen={() => onNavigate(`/marketplace/listing/${encodeURIComponent(item.id)}`)} />)}
      </div>
      {gone.length > 0 && <p className="px-1 text-xs text-slate-500">{gone.length} saved item{gone.length === 1 ? ' was' : 's were'} removed by the seller.</p>}
    </div>
  );
};
