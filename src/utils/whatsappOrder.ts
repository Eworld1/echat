import { api } from '../services/api';
import { createV2Order, getSellerWhatsApp, type V2MarketListing } from '../services/v2Market';
import type { User } from '../types';

const rateKey=(buyerId:string)=>`echat_v2_wa_clicks:${buyerId}`;
export async function openWhatsAppOrder(listing:V2MarketListing,buyer:User,onFallbackChat:()=>void):Promise<{message:string;url?:string}>{
  const saved=JSON.parse(localStorage.getItem(rateKey(buyer.id))||'[]') as number[];const recent=saved.filter(time=>Date.now()-time<60*60*1000);
  if(recent.length>=10)throw new Error('You’ve reached the WhatsApp order limit. Please try again later.');
  const seller=await getSellerWhatsApp(listing.sellerId);
  if(!seller.enabled||!seller.number||!seller.display){onFallbackChat();return{message:'Seller has no WhatsApp order option. Echat Chat is ready.'};}
  const number=seller.number.replace(/\s+/g,'');if(!/^\+[0-9]{7,15}$/.test(number))throw new Error('Seller WhatsApp details are unavailable. Use Echat Chat instead.');
  const phone=number.slice(1);const text=`Hi ${listing.sellerName}! I'm from Echat Market 👋 I'm interested in your listing:\n\n📌 ${listing.title}\n💰 Price: ${listing.currency}${listing.price}\n🔗 Link: ${location.origin}/v2/market/listing/${listing.id}\n\nIs it still available?`;
  const url=`https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  localStorage.setItem(rateKey(buyer.id),JSON.stringify([...recent,Date.now()]));
  const order=await createV2Order({listingId:listing.id,listingTitle:listing.title,listingPhoto:listing.photos[0]||'',price:listing.price,currency:listing.currency,quantity:1,buyerId:buyer.id,buyerName:buyer.name,buyerAvatar:buyer.avatar,sellerId:listing.sellerId,delivery:'Pickup',location:listing.location,note:'Buyer started WhatsApp order',status:'pending',source:'whatsapp',activity:'whatsapp_started'});
  try{await api.sendMessage({receiverId:listing.sellerId,text:`Buyer started a WhatsApp order for ${listing.title} (${listing.currency}${listing.price}). Order ${order.id}`,v2_market_order:{orderId:order.id,listingId:listing.id,buyerId:buyer.id,sellerId:listing.sellerId,status:'pending',createdAt:order.createdAt,source:'whatsapp'}});}catch{ /* the V2 order remains saved even if the classic chat service is temporarily unavailable */ }
  window.open(url,'_blank','noopener,noreferrer');
  return{message:'Opening WhatsApp… Your order message is ready to send.',url};
}
