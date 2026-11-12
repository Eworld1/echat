import { addDoc, collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, updateDoc, where, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';

export interface V2MarketListing { id:string; title:string; description:string; price:number; currency:string; category:string; condition:string; location:string; photos:string[]; sellerId:string; sellerName:string; sellerAvatar:string; sellerVerified:boolean; whatsappEnabled?:boolean; whatsappDisplay?:boolean; createdAt:number; status:'active'|'sold'; }
export interface V2MarketOrder { id:string; listingId:string; listingTitle:string; listingPhoto:string; price:number; quantity:number; buyerId:string; buyerName:string; buyerAvatar:string; sellerId:string; delivery:'Pickup'|'Delivery'; location:string; note:string; status:'pending'|'accepted'|'declined'|'sold'; source?:'echat'|'whatsapp'; activity?:string; createdAt:number; updatedAt?:number; }
const listingsCollection='echat_v2_market_listings'; const ordersCollection='echat_v2_market_orders';

export async function getV2Listings():Promise<V2MarketListing[]>{const snapshot=await getDocs(collection(db,listingsCollection));return snapshot.docs.map(item=>({id:item.id,...item.data()} as V2MarketListing)).filter(item=>item.status!=='sold').sort((a,b)=>b.createdAt-a.createdAt);}
export async function getV2Listing(id:string):Promise<V2MarketListing|null>{const item=await getDoc(doc(db,listingsCollection,id));return item.exists()?({id:item.id,...item.data()} as V2MarketListing):null;}
export async function createV2Listing(value:Omit<V2MarketListing,'id'|'createdAt'|'status'>):Promise<V2MarketListing>{const data={...value,createdAt:Date.now(),status:'active' as const};const saved=await addDoc(collection(db,listingsCollection),data);return{id:saved.id,...data};}
export async function updateV2Listing(id:string,updates:Partial<V2MarketListing>):Promise<void>{await updateDoc(doc(db,listingsCollection,id),{...updates,updatedAt:Date.now()});}
export async function createV2Order(value:Omit<V2MarketOrder,'id'|'createdAt'>):Promise<V2MarketOrder>{const data={...value,createdAt:Date.now()};const saved=await addDoc(collection(db,ordersCollection),data);return{id:saved.id,...data};}
export async function getV2Orders(sellerId:string):Promise<V2MarketOrder[]>{const snapshot=await getDocs(query(collection(db,ordersCollection),where('sellerId','==',sellerId)));return snapshot.docs.map(item=>({id:item.id,...item.data()} as V2MarketOrder)).sort((a,b)=>b.createdAt-a.createdAt);}
export function listenV2Orders(sellerId:string,onOrders:(orders:V2MarketOrder[])=>void,onError:(error:Error)=>void):Unsubscribe{return onSnapshot(query(collection(db,ordersCollection),where('sellerId','==',sellerId)),snapshot=>onOrders(snapshot.docs.map(item=>({id:item.id,...item.data()} as V2MarketOrder)).sort((a,b)=>b.createdAt-a.createdAt)),error=>onError(error));}
export async function updateV2Order(id:string,updates:Partial<V2MarketOrder>):Promise<void>{await updateDoc(doc(db,ordersCollection,id),{...updates,updatedAt:Date.now()});}
export async function reportV2Listing(listingId:string,reporterId:string,reason:string):Promise<void>{await addDoc(collection(db,'echat_v2_market_reports'),{listingId,reporterId,reason,createdAt:Date.now()});}

export async function saveV2WhatsApp(uid:string,value:{whatsapp:string;whatsappEnabled:boolean;whatsappDisplay:boolean;whatsappAutoReplyTemplate:string}):Promise<void>{await setDoc(doc(db,'users',uid),{v2:value},{merge:true});}
/** Read the private number only after an authenticated buyer presses the WhatsApp order button. */
export async function getSellerWhatsApp(uid:string):Promise<{number:string;enabled:boolean;display:boolean}>{const snapshot=await getDoc(doc(db,'users',uid));const v2=snapshot.data()?.v2||{};return{number:typeof v2.whatsapp==='string'?v2.whatsapp:'',enabled:v2.whatsappEnabled===true,display:v2.whatsappDisplay===true};}
