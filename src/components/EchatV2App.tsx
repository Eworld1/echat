import React, { useCallback, useEffect, useState } from 'react';
import { ECHAT_V2_ENABLED } from '../config/featureFlags';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import type { User } from '../types';
import { EchatV2Layout, type V2Route } from './EchatV2Layout';
import { V2Home } from '../pages/v2/V2Home';
import { V2Moments } from '../pages/v2/V2Moments';
import { V2Vibes } from '../pages/v2/V2Vibes';
import { V2Circle } from '../pages/v2/V2Circle';
import { V2Chat } from '../pages/v2/V2Chat';
import { V2Communities } from '../pages/v2/V2Communities';
import { V2Events } from '../pages/v2/V2Events';
import { V2Saved } from '../pages/v2/V2Saved';
import { V2Market } from '../pages/v2/V2Market';
import { V2Settings } from '../pages/v2/V2Settings';
import { V2MarketOrders } from '../pages/v2/V2MarketOrders';
import { V2Profile } from '../pages/v2/V2Profile';
import { MarketChatBox } from './v2/chat/MarketChatBox';
import { getV2Listing, type V2MarketListing } from '../services/v2Market';
import { openWhatsAppOrder } from '../utils/whatsappOrder';
import { EchatV2IntroVideo } from './EchatV2IntroVideo';
import { V2Ads, V2Dashboard, V2Feeds, V2Finds, V2Kids, V2Memories, V2PagesRoute } from '../pages/v2/V2AddOnPages';
import { V2AI } from '../pages/v2/V2AI';
import { V2Avatars } from '../pages/v2/V2Avatars';
import { V2Games } from '../pages/v2/V2Games';

interface MarketChat { listing:V2MarketListing; partner:User; whatsappEnabled:boolean; minimized:boolean; }
const routeFromPath=(path:string):V2Route=>path.startsWith('/v2/market/listing/')?path as V2Route:(['/v2/home','/v2/moments','/v2/vibes','/v2/circle','/v2/chat','/v2/communities','/v2/groups','/v2/market','/v2/events','/v2/saved','/v2/market/orders','/v2/settings','/v2/profile','/v2/dashboard','/v2/finds','/v2/ai','/v2/ads','/v2/avatar','/v2/feeds','/v2/games','/v2/memories','/v2/kids','/v2/pages','/v2/intro'].includes(path)?path as V2Route:'/v2/home');
export const EchatV2App:React.FC<{embedded?:boolean}>=({embedded=false})=>{
  const {user}=useAuth();const [route,setRoute]=useState<V2Route>(()=>routeFromPath(location.pathname));const [marketChat,setMarketChat]=useState<MarketChat|null>(null);const [error,setError]=useState('');const [showIntro,setShowIntro]=useState(()=>!embedded&&(routeFromPath(location.pathname)==='/v2/intro'||localStorage.getItem('echat_v2_intro_seen')!=='true'));
  const navigate=useCallback((next:V2Route)=>{window.history.pushState({echatV2:true},'',next);setRoute(next);window.dispatchEvent(new Event('echat:navigate'));},[]);
  useEffect(()=>{const handle=()=>setRoute(routeFromPath(location.pathname));window.addEventListener('popstate',handle);const navigation=()=>setRoute(routeFromPath(location.pathname));window.addEventListener('echat:navigate',navigation);return()=>{window.removeEventListener('popstate',handle);window.removeEventListener('echat:navigate',navigation);};},[]);
  useEffect(()=>{const raw=localStorage.getItem('echat_last_market_chat');if(!raw)return;try{const saved=JSON.parse(raw) as {listingId:string;sellerId:string};void Promise.all([getV2Listing(saved.listingId),api.getUserProfile(saved.sellerId)]).then(([listing,profile])=>{if(listing)setMarketChat({listing,partner:profile.user,whatsappEnabled:Boolean(listing.whatsappEnabled&&listing.whatsappDisplay),minimized:true});}).catch(()=>{});}catch{/* ignore malformed local draft */}},[]);
  const openMarketChat=(listing:V2MarketListing,partner:User)=>{const isBuyer=user?.id!==listing.sellerId;setMarketChat({listing,partner,whatsappEnabled:isBuyer&&Boolean(listing.whatsappEnabled&&listing.whatsappDisplay),minimized:false});localStorage.setItem('echat_last_market_chat',JSON.stringify({listingId:listing.id,sellerId:partner.id}));};
  const closeChat=()=>{setMarketChat(null);localStorage.removeItem('echat_last_market_chat');};
  if(!ECHAT_V2_ENABLED)return <div className="p-8 text-center"><p>Echat is temporarily unavailable.</p><button onClick={()=>window.location.assign('/v2/home')} className="mt-3 rounded-full bg-slate-900 px-4 py-2 text-white">Reload Echat</button></div>;
  return <EchatV2Layout embedded={embedded} route={route} onNavigate={navigate} onCreate={()=>{navigate('/v2/home');window.dispatchEvent(new Event('echat:v2-create'));}}>
    {error&&<p role="alert" className="mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}<button onClick={()=>setError('')} className="ml-2 underline">Dismiss</button></p>}
    {route==='/v2/home'&&<V2Home onNavigate={navigate}/ >}{route==='/v2/moments'&&<V2Moments/>}{route==='/v2/vibes'&&<V2Vibes/>}{route==='/v2/circle'&&<V2Circle/>}{route==='/v2/profile'&&<V2Profile/>}{route==='/v2/dashboard'&&<V2Dashboard/>}{route==='/v2/chat'&&<V2Chat/>}{route==='/v2/communities'&&<V2Communities/>}{route==='/v2/groups'&&<V2Communities/>}{route==='/v2/events'&&<V2Events/>}{route==='/v2/saved'&&<V2Saved/>}{route==='/v2/finds'&&<V2Finds/>}{route==='/v2/ai'&&<V2AI/>}{route==='/v2/ads'&&<V2Ads/>}{route==='/v2/avatar'&&<V2Avatars/>}{route==='/v2/feeds'&&<V2Feeds/>}{route==='/v2/games'&&<V2Games/>}{route==='/v2/memories'&&<V2Memories/>}{route==='/v2/kids'&&<V2Kids/>}{route==='/v2/pages'&&<V2PagesRoute onNavigate={navigate}/ >}{(route==='/v2/market'||route.startsWith('/v2/market/listing/'))&&<V2Market route={route} onNavigate={navigate} onChat={openMarketChat}/ >}{route==='/v2/market/orders'&&<V2MarketOrders onChat={openMarketChat}/>}{route==='/v2/settings'&&<V2Settings onWatchIntro={()=>navigate('/v2/intro')}/>}
    {marketChat&&<MarketChatBox listing={marketChat.listing} seller={marketChat.partner} whatsappEnabled={marketChat.whatsappEnabled} minimized={marketChat.minimized} onMinimize={()=>setMarketChat(value=>value?{...value,minimized:true}:value)} onRestore={()=>setMarketChat(value=>value?{...value,minimized:false}:value)} onClose={closeChat} onExpand={()=>{setMarketChat(value=>value?{...value,minimized:true}:value);navigate('/v2/chat');}} onWhatsApp={()=>{if(!user)return;void openWhatsAppOrder(marketChat.listing,user,()=>setError('Seller has no WhatsApp order option. Continue in Echat Chat.')).then(result=>setError(result.message)).catch(e=>setError(e instanceof Error?e.message:'Could not open WhatsApp.'));}}/>}
    {(showIntro||route==='/v2/intro')&&<EchatV2IntroVideo mode="modal" onClose={()=>{localStorage.setItem('echat_v2_intro_seen','true');setShowIntro(false);if(route==='/v2/intro')navigate('/v2/home');}} onExplore={()=>{localStorage.setItem('echat_v2_intro_seen','true');setShowIntro(false);navigate('/v2/home');}}/>}
  </EchatV2Layout>;
};
