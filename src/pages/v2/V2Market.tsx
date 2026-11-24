import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Phone } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import type { User } from '../../types';
import { emptyMarketSellerProfile, getMarketSellerProfile, listenV2Listings, saveMarketSellerProfile, type MarketSellerProfile, type V2MarketListing } from '../../services/v2Market';
import { listenFavorites, marketErrorMessage, migrateLocalFavorites, setFavorite, type Listing } from '../../services/market';
import { ListingCard } from '../../components/market/MarketUI';
import { UserAvatar } from '../../components/UserAvatar';
import { MarketHome } from '../market/MarketHome';
import { ListingDetail } from '../market/ListingDetail';
import { ListingForm } from '../market/ListingForm';
import { MyListings, SavedListings } from '../market/MyMarket';

/**
 * EChat Marketplace router. Listings live in Firestore (echat_v2_market_listings); photos on Cloudinary.
 * Routes: /marketplace · /listing/:id · /sell · /edit/:id · /mine · /saved · /seller/:id · /seller-settings
 */
interface Props { route:string; onNavigate:(route:string)=>void; onChat:(listing:V2MarketListing,seller:User)=>void; onViewProfile?:(userId:string)=>void; }
const categories=['Vehicles','Phones','Electronics','Fashion','Furniture','Homes','Jobs','Services','Other'];
const deliveryChoices=['Pickup','Delivery in Freetown','Delivery Nationwide'];
const inputClass='min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100';
const whatsappUrl=(number:string,item:string)=>`https://wa.me/${number.replace(/\D/g,'')}?text=${encodeURIComponent(`Hi, I'm interested in your ${item} on eChat`)}`;

const routeId=(route:string,prefix:string)=>route.startsWith(prefix)?decodeURIComponent(route.slice(prefix.length).split('/')[0]):'';

export const V2Market:React.FC<Props>=({route,onNavigate,onChat,onViewProfile})=>{
  const {user}=useAuth();
  const uid=user?.id||'';
  const [listings,setListings]=useState<Listing[]>([]);
  const [loadingListings,setLoadingListings]=useState(true);
  const [error,setError]=useState('');
  const [favorites,setFavorites]=useState<Set<string>>(new Set());
  const [toast,setToast]=useState('');
  const [busy,setBusy]=useState(false);
  const [sellerProfile,setSellerProfile]=useState<MarketSellerProfile>(emptyMarketSellerProfile);
  const [sellerProfiles,setSellerProfiles]=useState<Record<string,MarketSellerProfile|null>>({});
  const [savedNotice,setSavedNotice]=useState('');
  const [storeUser,setStoreUser]=useState<User|null>(null);

  const listingPrefix='/marketplace/listing/';
  const listingId=routeId(route,listingPrefix);
  const editId=routeId(route,'/marketplace/edit/');
  const isSell=route==='/marketplace/sell';
  const isMine=route==='/marketplace/mine';
  const isSaved=route==='/marketplace/saved';
  const isSellerSettings=route==='/marketplace/seller-settings';
  const storeId=routeId(route,'/marketplace/seller/');

  // Live listings (one listener for every Marketplace screen, so new / edited / sold items show instantly).
  useEffect(()=>{if(isSellerSettings)return;setLoadingListings(true);return listenV2Listings(items=>{setListings(items as Listing[]);setLoadingListings(false);setError('');},e=>{setError(marketErrorMessage(e));setLoadingListings(false);});},[isSellerSettings]);
  useEffect(()=>listenFavorites(uid,setFavorites),[uid]);
  useEffect(()=>{if(uid)void migrateLocalFavorites(uid).catch(()=>{});},[uid]);
  useEffect(()=>{if(!toast)return;const timer=window.setTimeout(()=>setToast(''),2500);return()=>window.clearTimeout(timer);},[toast]);
  useEffect(()=>{if(!user?.id||!isSellerSettings)return;void getMarketSellerProfile(user.id).then(profile=>setSellerProfile(profile||emptyMarketSellerProfile)).catch(()=>setSellerProfile(emptyMarketSellerProfile));},[user?.id,isSellerSettings]);
  useEffect(()=>{let active=true;if(storeId){setStoreUser(null);void Promise.all([api.getUserProfile(storeId),getMarketSellerProfile(storeId).catch(()=>null)]).then(([result,profile])=>{if(active){setStoreUser(result.user);setSellerProfiles(current=>({...current,[storeId]:profile}));}}).catch(()=>{if(active)setStoreUser(null);});}return()=>{active=false;};},[storeId]);

  const toggleFavorite=useCallback(async(item:Listing)=>{
    if(!uid){setToast('Sign in to save items.');return;}
    const on=!favorites.has(item.id);
    setFavorites(current=>{const next=new Set(current);if(on)next.add(item.id);else next.delete(item.id);return next;});
    try{await setFavorite(uid,item.id,on);setToast(on?'Saved to your Saved items':'Removed from Saved');}
    catch(e){setFavorites(current=>{const next=new Set(current);if(on)next.delete(item.id);else next.add(item.id);return next;});setToast(marketErrorMessage(e));}
  },[uid,favorites]);

  const saveProfile=async(event:React.FormEvent)=>{event.preventDefault();if(!user)return;setBusy(true);setSavedNotice('');setError('');try{await saveMarketSellerProfile(user.id,sellerProfile);setSavedNotice('Seller profile saved. Your Marketplace listings will show the updated details.');setSellerProfiles(current=>({...current,[user.id]:sellerProfile}));}catch(e){setError(e instanceof Error?e.message:'Could not save seller profile.');}finally{setBusy(false);}};
  const toggleDelivery=(choice:string)=>setSellerProfile(current=>({...current,deliveryOptions:current.deliveryOptions.includes(choice)?current.deliveryOptions.filter(item=>item!==choice):[...current.deliveryOptions,choice]}));

  const toastView=toast&&<div role="status" aria-live="polite" className="fixed left-1/2 top-[max(1rem,env(safe-area-inset-top))] z-[95] -translate-x-1/2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-xl">{toast}</div>;
  const seller=user?{id:user.id,name:user.name,avatar:user.avatar||'',verified:Boolean(user.isVerified),whatsappEnabled:Boolean(user.v2?.whatsappEnabled),whatsappDisplay:Boolean(user.v2?.whatsappDisplay),location:user.location}:null;
  const signInNotice=<div className="mx-auto max-w-xl rounded-2xl bg-white p-8 text-center text-sm text-slate-600 shadow-sm">Sign in to use the Marketplace.</div>;

  if(isSellerSettings)return <main className="mx-auto max-w-3xl space-y-4 pb-10 text-slate-900"><button onClick={()=>onNavigate('/marketplace')} className="flex min-h-10 items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft size={17}/>Back to Marketplace</button><header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">Marketplace</p><h1 className="mt-1 text-2xl font-extrabold">Seller Settings</h1><p className="mt-2 text-sm text-slate-600">Create your seller profile. Admins who sell can set up a profile here too.</p></header><form onSubmit={saveProfile} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1.5 text-sm font-semibold">Shop / Business Name<input className={inputClass} value={sellerProfile.shopName} onChange={e=>setSellerProfile({...sellerProfile,shopName:e.target.value})} maxLength={80} placeholder="Your shop name"/></label><label className="space-y-1.5 text-sm font-semibold">Business Category<select className={inputClass} value={sellerProfile.category} onChange={e=>setSellerProfile({...sellerProfile,category:e.target.value})}>{categories.map(item=><option key={item}>{item}</option>)}</select></label><label className="space-y-1.5 text-sm font-semibold sm:col-span-2">Bio / About your business<textarea className={`${inputClass} min-h-24 py-3`} value={sellerProfile.bio} onChange={e=>setSellerProfile({...sellerProfile,bio:e.target.value})} maxLength={800} placeholder="Tell buyers about your business"/></label><label className="space-y-1.5 text-sm font-semibold">Location / City<input className={inputClass} value={sellerProfile.location} onChange={e=>setSellerProfile({...sellerProfile,location:e.target.value})} placeholder="Freetown, Sierra Leone"/></label><label className="space-y-1.5 text-sm font-semibold">Business Hours<input className={inputClass} value={sellerProfile.businessHours} onChange={e=>setSellerProfile({...sellerProfile,businessHours:e.target.value})} placeholder="Mon-Sat 9am-6pm"/></label><label className="space-y-1.5 text-sm font-semibold">WhatsApp Number (include country code)<input className={inputClass} type="tel" value={sellerProfile.whatsappNumber} onChange={e=>setSellerProfile({...sellerProfile,whatsappNumber:e.target.value})} placeholder="+232…"/></label><label className="space-y-1.5 text-sm font-semibold">Phone / Call Number<input className={inputClass} type="tel" value={sellerProfile.phoneNumber} onChange={e=>setSellerProfile({...sellerProfile,phoneNumber:e.target.value})} placeholder="+232…"/></label><label className="space-y-1.5 text-sm font-semibold">Facebook link (optional)<input className={inputClass} type="url" value={sellerProfile.facebook} onChange={e=>setSellerProfile({...sellerProfile,facebook:e.target.value})} placeholder="https://facebook.com/…"/></label><label className="space-y-1.5 text-sm font-semibold">Instagram link (optional)<input className={inputClass} type="url" value={sellerProfile.instagram} onChange={e=>setSellerProfile({...sellerProfile,instagram:e.target.value})} placeholder="https://instagram.com/…"/></label><label className="space-y-1.5 text-sm font-semibold sm:col-span-2">TikTok link (optional)<input className={inputClass} type="url" value={sellerProfile.tiktok} onChange={e=>setSellerProfile({...sellerProfile,tiktok:e.target.value})} placeholder="https://tiktok.com/@…"/></label></div><fieldset className="space-y-2"><legend className="mb-2 text-sm font-bold">Delivery Options</legend>{deliveryChoices.map(choice=><label key={choice} className="flex min-h-10 items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={sellerProfile.deliveryOptions.includes(choice)} onChange={()=>toggleDelivery(choice)} className="h-4 w-4 accent-blue-700"/>{choice}</label>)}</fieldset><label className="flex min-h-12 items-center justify-between gap-4 rounded-xl bg-slate-50 px-4"><span><span className="block text-sm font-bold">Show contact info on listings</span><span className="text-xs text-slate-600">Allow buyers to contact you directly.</span></span><input aria-label="Show contact info on listings" type="checkbox" checked={sellerProfile.showContactInfo} onChange={e=>setSellerProfile({...sellerProfile,showContactInfo:e.target.checked})} className="h-5 w-5 accent-blue-700"/></label>{savedNotice&&<p role="status" className="rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-800">{savedNotice}</p>}{error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<button disabled={busy} className="min-h-12 w-full rounded-xl bg-blue-700 px-5 font-bold text-white disabled:opacity-60">{busy?'Saving…':'Save Seller Profile'}</button></form></main>;

  if(isSell||editId){
    if(!seller)return signInNotice;
    if(editId){
      const editing=listings.find(item=>item.id===editId);
      if(loadingListings)return <div className="mx-auto max-w-2xl rounded-2xl bg-white p-8 text-center text-sm text-slate-500">Loading…</div>;
      if(!editing||editing.sellerId!==seller.id)return <div className="mx-auto max-w-xl rounded-2xl bg-white p-8 text-center shadow-sm"><p className="font-bold text-slate-900">You can only edit your own listings.</p><button type="button" onClick={()=>onNavigate('/marketplace/mine')} className="mt-4 min-h-11 rounded-xl bg-[#1877F2] px-5 text-sm font-bold text-white">My Listings</button></div>;
      return <ListingForm key={editing.id} listing={editing} seller={seller} onCancel={()=>onNavigate(`${listingPrefix}${encodeURIComponent(editing.id)}`)} onDone={id=>{setToast('Changes saved');onNavigate(`${listingPrefix}${encodeURIComponent(id)}`);}}/>;
    }
    return <ListingForm seller={seller} onCancel={()=>onNavigate('/marketplace')} onDone={id=>{setToast('Your listing is live!');onNavigate(`${listingPrefix}${encodeURIComponent(id)}`);}}/>;
  }

  if(listingId){
    const live=listings.find(item=>item.id===listingId)||null;
    return <>{toastView}<ListingDetail key={listingId} id={listingId} live={live} me={user||null} saved={favorites.has(listingId)} onToggleSave={item=>void toggleFavorite(item)} onBack={()=>{if(window.history.length>1)window.history.back();else onNavigate('/marketplace');}} onNavigate={onNavigate} onChat={(item,partner)=>onChat(item,partner)} onViewProfile={onViewProfile}/></>;
  }

  if(isMine){if(!user)return signInNotice;return <MyListings listings={listings} loading={loadingListings} uid={user.id} favorites={favorites} onNavigate={onNavigate}/>;}
  if(isSaved){if(!user)return signInNotice;return <>{toastView}<SavedListings listings={listings} loading={loadingListings} favorites={favorites} onToggleFavorite={item=>void toggleFavorite(item)} onNavigate={onNavigate}/></>;}

  if(storeId){const profile=sellerProfiles[storeId]??null;const storeListings=listings.filter(item=>item.sellerId===storeId&&item.status!=='sold');return <main className="mx-auto max-w-[1050px] space-y-4 pb-10 text-slate-900"><button onClick={()=>onNavigate('/marketplace')} className="flex min-h-10 items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft size={17}/>Back to Marketplace</button><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div className="flex items-center gap-4"><UserAvatar src={storeUser?.avatar} name={profile?.shopName||storeUser?.name||'Seller'} size={64}/><div><h1 className="text-2xl font-extrabold">{profile?.shopName||storeUser?.name||'Seller Storefront'}</h1><p className="text-sm text-slate-600">{storeUser?.name}{profile?.location?` · ${profile.location}`:''}</p></div></div>{profile?.bio&&<p className="mt-4 max-w-2xl text-sm leading-6 text-slate-700">{profile.bio}</p>}{profile?.businessHours&&<p className="mt-2 text-sm text-slate-600">Business hours: {profile.businessHours}</p>}{profile?.showContactInfo&&profile&&(profile.phoneNumber||profile.whatsappNumber)&&<div className="mt-4 flex flex-wrap gap-2">{profile.phoneNumber&&<a href={`tel:${profile.phoneNumber}`} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-bold"><Phone size={15}/>Call</a>}{profile.whatsappNumber&&<a target="_blank" rel="noreferrer" href={whatsappUrl(profile.whatsappNumber,'an item')} className="inline-flex min-h-10 items-center rounded-lg bg-[#25D366] px-4 text-sm font-bold text-white">WhatsApp</a>}</div>}{(!profile||(!profile.phoneNumber&&!profile.whatsappNumber))&&<p className="mt-4 text-sm text-slate-500">Seller has not added contact info yet</p>}</section><h2 className="text-xl font-extrabold">Listings</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{storeListings.map(item=><ListingCard key={item.id} item={item} saved={favorites.has(item.id)} onToggleSave={()=>void toggleFavorite(item)} onOpen={()=>onNavigate(`${listingPrefix}${encodeURIComponent(item.id)}`)}/>)}</div>{storeListings.length===0&&<div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">No active listings yet.</div>}</main>;}

  return <>{toastView}<MarketHome listings={listings} loading={loadingListings} error={error} favorites={favorites} onToggleFavorite={item=>void toggleFavorite(item)} onNavigate={onNavigate}/></>;
};
