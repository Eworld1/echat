import React, { useEffect, useMemo, useState } from 'react';
import { MessageCircle, PackageCheck, Phone, ShoppingBag } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { User } from '../../types';
import { getSellerWhatsApp, getV2Listing, listenV2Orders, updateV2Listing, updateV2Order, type V2MarketListing, type V2MarketOrder } from '../../services/v2Market';
import { api } from '../../services/api';

type Tab='pending'|'accepted'|'sold'|'declined';
interface Props { onChat:(listing:V2MarketListing,partner:User)=>void; onShop:()=>void; }

export const V2MarketOrders:React.FC<Props>=({onChat,onShop})=>{
  const {user}=useAuth();
  const [orders,setOrders]=useState<V2MarketOrder[]>([]);
  const [loading,setLoading]=useState(true);
  const [tab,setTab]=useState<Tab>('pending');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState('');

  useEffect(()=>{if(!user){setLoading(false);return;}setLoading(true);return listenV2Orders(user.id,items=>{setOrders(items);setLoading(false);},error=>{setError(error.message);setLoading(false);});},[user?.id]);
  const filtered=useMemo(()=>orders.filter(order=>order.status===tab),[orders,tab]);
  const contact=async(order:V2MarketOrder)=>{
    if(!user)return;
    setBusy(order.id);
    try{
      const [listing,profile]=await Promise.all([getV2Listing(order.listingId),api.getUserProfile(user.id===order.sellerId?order.buyerId:order.sellerId)]);
      if(!listing)throw new Error('Listing is not available.');
      onChat(listing,profile.user);
    }catch(e){setError(e instanceof Error?e.message:'Could not open order chat.');}
    finally{setBusy('');}
  };
  const action=async(order:V2MarketOrder,status:'accepted'|'declined'|'sold')=>{
    setBusy(order.id);setError('');
    try{
      await updateV2Order(order.id,{status});
      if(status==='sold')await updateV2Listing(order.listingId,{status:'sold'});
      if(status==='accepted')await api.sendMessage({receiverId:order.buyerId,text:`Your order for ${order.listingTitle} was accepted.`,v2_market_order:{orderId:order.id,listingId:order.listingId,buyerId:order.buyerId,sellerId:order.sellerId,status,createdAt:order.createdAt,source:order.source}});
    }catch(e){setError(e instanceof Error?e.message:'Could not update order.');}
    finally{setBusy('');}
  };
  const whatsapp=async(order:V2MarketOrder)=>{
    if(!user)return;
    const contactId=user.id===order.sellerId?order.buyerId:order.sellerId;
    const contactName=user.id===order.sellerId?order.buyerName:order.listingTitle;
    setBusy(order.id);
    try{
      const contactInfo=await getSellerWhatsApp(contactId);
      if(!contactInfo.enabled||!contactInfo.display||!contactInfo.number)throw new Error('WhatsApp contact is not enabled. Use Echat Chat instead.');
      const phone=contactInfo.number.replace(/\D/g,'');
      const message=`Hi ${contactName}, I’m contacting you about my Echat Market order for ${order.listingTitle}.`;
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`,'_blank','noopener,noreferrer');
    }catch(e){setError(e instanceof Error?e.message:'Could not open WhatsApp.');}
    finally{setBusy('');}
  };

  return <div className="echat-v2-page mx-auto max-w-[950px] space-y-4">
    <header className="rounded-[26px] bg-[#0F1B2D] p-6 text-white"><p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#FFC107]">My Orders</p><h1 className="mt-2 text-3xl font-extrabold">Your Marketplace orders</h1><p className="mt-2 text-sm text-slate-300">Purchases and orders from your listings update here in real time.</p></header>
    {error&&<p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <div className="flex gap-2 overflow-x-auto">{(['pending','accepted','sold','declined'] as Tab[]).map(value=><button key={value} onClick={()=>setTab(value)} className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-bold capitalize ${tab===value?'bg-[#F5B301] text-[#0F1B2D]':'bg-white text-slate-600'}`}>{value==='pending'?'Pending':value} <span className="ml-1 rounded-full bg-black/5 px-1.5">{orders.filter(order=>order.status===value).length}</span></button>)}</div>
    {loading?<div className="echat-v2-card p-9 text-center text-sm text-slate-600">Loading orders…</div>:<div className="space-y-3">{filtered.map(order=>{
      const isSeller=order.sellerId===user?.id;
      const amount=`${order.price*order.quantity} ${order.currency||'SLL'}`;
      return <article key={order.id} className="echat-v2-card flex flex-wrap items-center gap-3 p-4">
        <img src={order.listingPhoto||order.buyerAvatar} alt="" className="h-16 w-16 rounded-2xl object-cover"/>
        <div className="min-w-0 flex-1"><p className="font-extrabold">{order.listingTitle}</p><p className="mt-0.5 text-sm font-bold text-[#805900]">{amount} · {order.quantity}× · {order.delivery}</p><p className="mt-1 text-xs text-slate-500">{isSeller?`Buyer: ${order.buyerName}`:'Purchase'} · {order.location} · {new Date(order.createdAt).toLocaleString()}</p><p className="mt-1 text-[11px] text-slate-500">{order.source==='whatsapp'?'Started via WhatsApp':'Echat Market order'}</p></div>
        <span className="flex items-center gap-1 rounded-full bg-[#FFF2C7] px-3 py-1 text-xs font-bold capitalize text-[#735000]"><PackageCheck size={14}/>{order.status}</span>
        <div className="flex flex-wrap gap-2"><button disabled={busy===order.id} onClick={()=>void contact(order)} className="flex min-h-10 items-center gap-1 rounded-full bg-[#F5B301] px-3 text-xs font-extrabold"><MessageCircle size={15}/>{isSeller?'Chat Buyer':'Chat Seller'}</button>{order.status!=='declined'&&order.status!=='sold'&&<button disabled={busy===order.id} onClick={()=>void whatsapp(order)} className="flex min-h-10 items-center gap-1 rounded-full bg-[#25D366] px-3 text-xs font-extrabold text-white"><Phone size={14}/>{isSeller?'WhatsApp Buyer':'WhatsApp Seller'}</button>}{isSeller&&order.status==='pending'&&<><button disabled={busy===order.id} onClick={()=>void action(order,'accepted')} className="min-h-10 rounded-full bg-emerald-600 px-3 text-xs font-extrabold text-white">Accept</button><button disabled={busy===order.id} onClick={()=>void action(order,'declined')} className="min-h-10 rounded-full bg-rose-100 px-3 text-xs font-bold text-rose-700">Decline</button></>}{isSeller&&order.status==='accepted'&&<button disabled={busy===order.id} onClick={()=>void action(order,'sold')} className="min-h-10 rounded-full bg-[#0F1B2D] px-3 text-xs font-extrabold text-white">Mark as Sold</button>}</div>
      </article>;
    })}</div>}
    {!loading&&!orders.length&&<div className="echat-v2-card p-9 text-center text-sm text-slate-600"><ShoppingBag size={28} className="mx-auto mb-2 text-[#B17A00]"/><p>No orders yet.</p><button onClick={onShop} className="mt-4 min-h-11 rounded-full bg-[#0F1B2D] px-5 font-bold text-white">Shop in Marketplace</button></div>}
    {!loading&&orders.length>0&&!filtered.length&&<div className="echat-v2-card p-9 text-center text-sm text-slate-600">No {tab} orders yet.</div>}
  </div>;
};
