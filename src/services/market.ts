import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import { uploadToCloudinary } from './upload';
import { createV2Listing, deleteV2Listing, reportV2Listing, updateV2Listing, type V2MarketListing } from './v2Market';

/**
 * EChat Marketplace helpers. Listings stay in the existing Firestore collection
 * (echat_v2_market_listings) so every current listing keeps working; photos go to Cloudinary.
 */
export type Listing = V2MarketListing & { updatedAt?: number; soldAt?: number };

export const CATEGORIES = ['Vehicles', 'Phones', 'Electronics', 'Fashion', 'Furniture', 'Homes', 'Jobs', 'Free Stuff'] as const;
/** Sell form also offers "Other" for things that fit nowhere else. */
export const SELL_CATEGORIES = [...CATEGORIES, 'Other'] as const;
export const CATEGORY_EMOJI: Record<string, string> = { All: '🛍️', Vehicles: '🚗', Phones: '📱', Electronics: '💻', Fashion: '👗', Furniture: '🛋️', Homes: '🏠', Jobs: '💼', 'Free Stuff': '🎁', Other: '📦' };
export const CONDITIONS = ['New', 'Used - Like New', 'Used - Good', 'Used - Fair'] as const;
export const LOCATIONS = ['Freetown', 'Bo', 'Kenema', 'Makeni', 'Koidu', 'Port Loko', 'Waterloo', 'Lunsar', 'Kabala', 'Kailahun', 'Kambia', 'Magburaka', 'Moyamba', 'Pujehun', 'Bonthe'] as const;
export const MAX_PHOTOS = 5;
export type SortOrder = 'newest' | 'price_low' | 'price_high';

/** Older listings used different category names — map them onto the new list. */
export function categoryOf(listing: Pick<Listing, 'category' | 'price'>): string {
  const value = listing.category || 'Other';
  if ((CATEGORIES as readonly string[]).includes(value)) return value;
  if (value === 'Home & Living') return 'Furniture';
  if (value === 'Services') return 'Jobs';
  return 'Other';
}

export const isUsed = (condition: string) => /^used|for parts/i.test(condition || '');

/** "Le 150,000" — or "Free". */
export const formatPrice = (price: number) => (!price || price <= 0 ? 'Free' : `Le ${Math.round(price).toLocaleString('en-US')}`);

export function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - (timestamp || 0)) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 30 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

export const listingLink = (id: string) => `${window.location.origin}/marketplace/listing/${encodeURIComponent(id)}`;

export interface ListingFilters { search: string; category: string; minPrice: string; maxPrice: string; location: string; condition: 'All' | 'New' | 'Used'; sort: SortOrder }
export const DEFAULT_FILTERS: ListingFilters = { search: '', category: 'All', minPrice: '', maxPrice: '', location: 'All', condition: 'All', sort: 'newest' };

export function applyFilters(listings: Listing[], filters: ListingFilters): Listing[] {
  const words = filters.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const min = filters.minPrice === '' ? null : Number(filters.minPrice);
  const max = filters.maxPrice === '' ? null : Number(filters.maxPrice);
  const result = listings.filter(item => {
    if (item.status === 'sold') return false;
    const category = categoryOf(item);
    if (filters.category !== 'All' && !(category === filters.category || (filters.category === 'Free Stuff' && item.price <= 0))) return false;
    if (min !== null && Number.isFinite(min) && item.price < min) return false;
    if (max !== null && Number.isFinite(max) && item.price > max) return false;
    if (filters.location !== 'All' && !(item.location || '').toLowerCase().includes(filters.location.toLowerCase())) return false;
    if (filters.condition === 'New' && isUsed(item.condition)) return false;
    if (filters.condition === 'Used' && !isUsed(item.condition)) return false;
    if (words.length) {
      const haystack = `${item.title} ${item.description} ${item.category} ${item.location} ${item.sellerName}`.toLowerCase();
      if (!words.every(word => haystack.includes(word))) return false;
    }
    return true;
  });
  if (filters.sort === 'price_low') result.sort((a, b) => a.price - b.price || b.createdAt - a.createdAt);
  else if (filters.sort === 'price_high') result.sort((a, b) => b.price - a.price || b.createdAt - a.createdAt);
  else result.sort((a, b) => b.createdAt - a.createdAt);
  return result;
}

export const activeFilterCount = (filters: ListingFilters) =>
  (filters.minPrice ? 1 : 0) + (filters.maxPrice ? 1 : 0) + (filters.location !== 'All' ? 1 : 0) + (filters.condition !== 'All' ? 1 : 0) + (filters.sort !== 'newest' ? 1 : 0);

// ---------------- photos (Cloudinary) ----------------

/** Shrinks big phone photos before upload (max 1600 px, JPEG) so listings load fast. */
async function compressPhoto(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 400 * 1024) return file;
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Could not read this photo.'));
      element.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Uploads photos one by one to Cloudinary; onProgress gets the overall 0–100 %. */
export async function uploadListingPhotos(files: File[], onProgress: (percent: number, label: string) => void, signal?: AbortSignal): Promise<string[]> {
  const urls: string[] = [];
  for (let index = 0; index < files.length; index++) {
    const label = `Uploading photo ${index + 1} of ${files.length}`;
    onProgress(Math.round((index / files.length) * 100), label);
    const file = await compressPhoto(files[index]);
    const url = await uploadToCloudinary(file, {
      folder: 'echat/marketplace',
      signal,
      onProgress: percent => onProgress(Math.round(((index + percent / 100) / files.length) * 100), label)
    }).promise;
    urls.push(url);
  }
  onProgress(100, 'Photos uploaded');
  return urls;
}

// ---------------- listings ----------------

export interface ListingInput { title: string; price: number; category: string; condition: string; description: string; location: string; photos: string[] }

export function validateListing(input: ListingInput): string {
  if (input.title.trim().length < 3) return 'Add a title (at least 3 characters).';
  if (!Number.isFinite(input.price) || input.price < 0) return 'Enter a valid price (0 for free).';
  if (input.price > 10_000_000_000) return 'That price is too high.';
  if (!input.location.trim()) return 'Choose a location.';
  if (!input.photos.length) return 'Add at least one photo.';
  if (input.photos.length > MAX_PHOTOS) return `Up to ${MAX_PHOTOS} photos.`;
  return '';
}

export async function publishListing(input: ListingInput, seller: { id: string; name: string; avatar: string; verified: boolean; whatsappEnabled: boolean; whatsappDisplay: boolean }): Promise<Listing> {
  return createV2Listing({
    title: input.title.trim().slice(0, 100),
    description: input.description.trim().slice(0, 3000),
    price: Math.round(input.price),
    currency: 'SLL',
    category: input.category,
    condition: input.condition,
    location: input.location.trim().slice(0, 80),
    photos: input.photos.slice(0, MAX_PHOTOS),
    sellerId: seller.id,
    sellerName: seller.name.slice(0, 80),
    sellerAvatar: /^https?:\/\//i.test(seller.avatar) && seller.avatar.length <= 900 ? seller.avatar : '',
    sellerVerified: seller.verified,
    whatsappEnabled: seller.whatsappEnabled,
    whatsappDisplay: seller.whatsappDisplay
  });
}

export async function saveListingEdits(id: string, input: ListingInput): Promise<void> {
  await updateV2Listing(id, {
    title: input.title.trim().slice(0, 100),
    description: input.description.trim().slice(0, 3000),
    price: Math.round(input.price),
    category: input.category,
    condition: input.condition,
    location: input.location.trim().slice(0, 80),
    photos: input.photos.slice(0, MAX_PHOTOS)
  });
}

export async function setListingSold(id: string, sold: boolean): Promise<void> {
  await updateV2Listing(id, sold ? { status: 'sold', soldAt: Date.now() } as Partial<Listing> : { status: 'active' });
}

export const deleteListing = deleteV2Listing;

export const REPORT_REASONS = ['Scam or fraud', 'Prohibited item', 'Wrong category', 'Offensive content', 'Already sold', 'Other'] as const;
export const reportListing = reportV2Listing;

// ---------------- favorites (Firestore, follow the user across devices) ----------------

const favRef = (uid: string, listingId: string) => doc(db, 'marketFavorites', `${uid}_${listingId}`);

export function listenFavorites(uid: string, onIds: (ids: Set<string>) => void): Unsubscribe {
  if (!uid) { onIds(new Set()); return () => {}; }
  return onSnapshot(query(collection(db, 'marketFavorites'), where('uid', '==', uid)), snapshot => {
    onIds(new Set(snapshot.docs.map(item => String(item.data().listingId || ''))));
  }, () => onIds(new Set()));
}

export async function setFavorite(uid: string, listingId: string, on: boolean): Promise<void> {
  if (on) await setDoc(favRef(uid, listingId), { uid, listingId, createdAt: Date.now() });
  else await deleteDoc(favRef(uid, listingId));
}

/** One-time move of favorites saved on this device by the old Marketplace into Firestore. */
export async function migrateLocalFavorites(uid: string): Promise<void> {
  const key = 'echat_v2_market_saved';
  let ids: string[] = [];
  try { ids = JSON.parse(window.localStorage.getItem(key) || '[]'); } catch { return; }
  if (!uid || !Array.isArray(ids) || !ids.length) return;
  await Promise.allSettled(ids.slice(0, 100).map(id => setFavorite(uid, String(id), true)));
  try { window.localStorage.removeItem(key); } catch { /* storage blocked */ }
}

export function marketErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code || '';
  if (code === 'permission-denied') return 'Permission denied. Sign in again (and make sure the latest Firestore rules are deployed).';
  if (code === 'unavailable') return 'You appear to be offline. Check your connection.';
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
