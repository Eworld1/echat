import React, { useMemo, useState } from 'react';
import { Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { activeFilterCount, applyFilters, CATEGORIES, CATEGORY_EMOJI, DEFAULT_FILTERS, LOCATIONS, type Listing, type ListingFilters, type SortOrder } from '../../services/market';
import { CardSkeleton, EmptyState, ListingCard, MarketNav } from '../../components/market/MarketUI';

interface Props {
  listings: Listing[];
  loading: boolean;
  error: string;
  favorites: Set<string>;
  onToggleFavorite: (listing: Listing) => void;
  onNavigate: (route: string) => void;
}

const SORTS: { id: SortOrder; label: string }[] = [{ id: 'newest', label: 'Newest' }, { id: 'price_low', label: 'Lowest price' }, { id: 'price_high', label: 'Highest price' }];
const selectClass = 'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#1877F2] focus:ring-2 focus:ring-[#1877F2]/15';

export const MarketHome: React.FC<Props> = ({ listings, loading, error, favorites, onToggleFavorite, onNavigate }) => {
  const [filters, setFilters] = useState<ListingFilters>(() => {
    try { return { ...DEFAULT_FILTERS, ...JSON.parse(window.sessionStorage.getItem('echat_market_filters') || '{}') }; } catch { return DEFAULT_FILTERS; }
  });
  const [panelOpen, setPanelOpen] = useState(false);
  const update = (patch: Partial<ListingFilters>) => setFilters(current => {
    const next = { ...current, ...patch };
    try { window.sessionStorage.setItem('echat_market_filters', JSON.stringify(next)); } catch { /* storage blocked */ }
    return next;
  });
  const results = useMemo(() => applyFilters(listings, filters), [listings, filters]);
  const extraFilters = activeFilterCount(filters);
  const filtered = filters.search || filters.category !== 'All' || extraFilters > 0;

  return (
    <div className="mx-auto max-w-[1200px] space-y-3 pb-[calc(96px+env(safe-area-inset-bottom))] lg:pb-8">
      <header className="space-y-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70 sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Marketplace</h1>
          <button type="button" onClick={() => onNavigate('/marketplace/sell')} className="hidden min-h-10 items-center gap-1.5 rounded-full bg-[#1877F2] px-4 text-sm font-bold text-white hover:bg-[#166FE5] sm:flex"><Plus size={17} />Sell something</button>
        </div>
        <div className="flex gap-2">
          <label className="flex min-h-11 flex-1 items-center gap-2 rounded-full bg-[#F0F2F5] px-4 focus-within:ring-2 focus-within:ring-[#1877F2]/30">
            <Search size={18} className="shrink-0 text-slate-500" />
            <input value={filters.search} onChange={event => update({ search: event.target.value })} placeholder="Search products" aria-label="Search products" type="search" enterKeyHint="search"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-slate-900 outline-none placeholder:text-slate-500" />
            {filters.search && <button type="button" onClick={() => update({ search: '' })} aria-label="Clear search" className="grid h-7 w-7 place-items-center rounded-full bg-slate-300/60"><X size={14} /></button>}
          </label>
          <button type="button" onClick={() => setPanelOpen(value => !value)} aria-expanded={panelOpen} aria-label="Filters"
            className={`relative flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-bold ${panelOpen || extraFilters ? 'bg-[#E7F0FD] text-[#1877F2]' : 'bg-[#F0F2F5] text-slate-800'}`}>
            <SlidersHorizontal size={17} /><span className="hidden sm:inline">Filters</span>
            {extraFilters > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#1877F2] px-1 text-[11px] text-white">{extraFilters}</span>}
          </button>
        </div>
        <MarketNav active="browse" onNavigate={onNavigate} savedCount={favorites.size} />
      </header>

      {panelOpen && (
        <section className="grid gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filters">
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">Price (Le)</p>
            <div className="grid grid-cols-2 gap-2">
              <input inputMode="numeric" value={filters.minPrice} onChange={event => update({ minPrice: event.target.value.replace(/[^\d]/g, '') })} placeholder="Min" aria-label="Minimum price" className={selectClass} />
              <input inputMode="numeric" value={filters.maxPrice} onChange={event => update({ maxPrice: event.target.value.replace(/[^\d]/g, '') })} placeholder="Max" aria-label="Maximum price" className={selectClass} />
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Location</span>
            <select value={filters.location} onChange={event => update({ location: event.target.value })} className={selectClass}>
              <option value="All">All of Sierra Leone</option>
              {LOCATIONS.map(place => <option key={place}>{place}</option>)}
            </select>
          </label>
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">Condition</p>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#F0F2F5] p-1">
              {(['All', 'New', 'Used'] as const).map(value => (
                <button key={value} type="button" onClick={() => update({ condition: value })} aria-pressed={filters.condition === value} className={`min-h-9 rounded-lg text-sm font-bold ${filters.condition === value ? 'bg-white text-[#1877F2] shadow-sm' : 'text-slate-600'}`}>{value}</button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Sort by</span>
            <select value={filters.sort} onChange={event => update({ sort: event.target.value as SortOrder })} className={selectClass}>
              {SORTS.map(sort => <option key={sort.id} value={sort.id}>{sort.label}</option>)}
            </select>
          </label>
          <div className="flex items-center justify-between gap-2 sm:col-span-2 lg:col-span-4">
            <p className="text-sm text-slate-600">{results.length} result{results.length === 1 ? '' : 's'}</p>
            <button type="button" onClick={() => update({ ...DEFAULT_FILTERS, search: filters.search, category: filters.category })} className="min-h-9 rounded-full px-3 text-sm font-bold text-[#1877F2] hover:bg-[#E7F0FD]">Reset filters</button>
          </div>
        </section>
      )}

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="tablist" aria-label="Categories">
        {['All', ...CATEGORIES].map(category => (
          <button key={category} type="button" role="tab" aria-selected={filters.category === category} onClick={() => update({ category })}
            className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-bold transition ${filters.category === category ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50'}`}>
            <span aria-hidden="true">{CATEGORY_EMOJI[category]}</span>{category}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      <h2 className="px-1 text-lg font-extrabold text-slate-900">{filtered ? `${results.length} result${results.length === 1 ? '' : 's'}` : "Today's picks"}</h2>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5">
        {loading ? Array.from({ length: 8 }, (_, index) => <CardSkeleton key={index} />)
          : results.length === 0 ? (
            listings.some(item => item.status !== 'sold')
              ? <EmptyState title="No matching listings" text="Try a different search, category or filter." action={<button type="button" onClick={() => update(DEFAULT_FILTERS)} className="min-h-11 rounded-xl bg-[#1877F2] px-5 text-sm font-bold text-white">Clear all filters</button>} />
              : <EmptyState title="No listings yet - Be the first to sell" text="Snap a photo, set a price and reach buyers across Sierra Leone." action={<button type="button" onClick={() => onNavigate('/marketplace/sell')} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#1877F2] px-5 text-sm font-bold text-white"><Plus size={17} />Sell something</button>} />
          )
            : results.map(item => <ListingCard key={item.id} item={item} saved={favorites.has(item.id)} onToggleSave={() => onToggleFavorite(item)} onOpen={() => onNavigate(`/marketplace/listing/${encodeURIComponent(item.id)}`)} />)}
      </div>

      <button type="button" onClick={() => onNavigate('/marketplace/sell')} className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] right-4 z-30 flex min-h-12 items-center gap-2 rounded-full bg-[#1877F2] px-5 text-sm font-extrabold text-white shadow-lg shadow-blue-600/30 sm:hidden"><Plus size={19} />Sell</button>
    </div>
  );
};
