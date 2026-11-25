import React, { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChatMediaGate } from '../components/LowData';
import { ArrowLeft, Camera, Download, ExternalLink, FileArchive, FileAudio, FileText, Image as ImageIcon, Mic, MessageSquare, Paperclip, Phone, Play, SendHorizontal, Share2, Smile, Square, Video, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { avatarClick } from '../components/AvatarViewer';
import { api, invalidateApiReadCache, type DirectConversation, type DirectMessage } from '../services/api';
import type { MessageAttachment, User } from '../types';
import { assetUrl } from '../services/apiBase';
import { ChatMediaViewer, downloadChatAttachment, shareChatAttachment, type ChatAttachmentItem, type ChatMediaItem } from '../components/ChatMediaViewer';
import { messagePreview } from '../../server/messagePreview';
import { clearUnreadMessages } from '../services/unread';

interface MessagesPageProps { initialUserId: string | null; onViewProfile: (userId: string) => void; }
const timeLabel = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const MAX_MESSAGE_LENGTH = 2000;
const INPUT_MAX_HEIGHT = 100;
const dedupeMessages = (rows: DirectMessage[]) => { const m = new Map(rows.map(x => [x._id, x])); return [...m.values()].sort((a,b)=>a.createdAt-b.createdAt); };
const messagesAreEqual = (c: DirectMessage[], n: DirectMessage[]) => c.length===n.length && c.every((msg,i)=>{ const nx=n[i]; return msg._id===nx._id && msg.senderId===nx.senderId && msg.receiverId===nx.receiverId && msg.text===nx.text && msg.mediaUrl===nx.mediaUrl && msg.mediaType===nx.mediaType && JSON.stringify(msg.attachments||[])===JSON.stringify(nx.attachments||[]) && msg.createdAt===nx.createdAt && msg.readAt===nx.readAt; });
const fmtCall = (s:number)=>`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;

const fileSizeLabel = (size:number) => size < 1024 ? `${size} B` : size < 1024*1024 ? `${(size/1024).toFixed(1)} KB` : `${(size/(1024*1024)).toFixed(1)} MB`;
// Same safe preview as notifications: never base64 (voice -> "🎤 Voice message"), text -> first 50 characters.
const conversationPreview = (message:DirectMessage) => messagePreview(message);
const inferredMimeType = (file:File) => {
  const extension=file.name.toLowerCase().split('.').pop()||'';
  const types:Record<string,string> = {
    jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',avif:'image/avif',heic:'image/heic',heif:'image/heif',
    mp4:'video/mp4',pdf:'application/pdf',doc:'application/msword',
    docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    zip:'application/zip',mp3:'audio/mpeg'
  };
  return !file.type||file.type==='application/octet-stream'?types[extension]||file.type||'application/octet-stream':file.type;
};
const fileNameFromUrl = (url:string) => {
  if(url.startsWith('data:'))return 'attachment';
  try { return decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || 'attachment'); }
  catch { return 'attachment'; }
};
const getMessageAttachments = (message:DirectMessage):ChatAttachmentItem[] => {
  const items:ChatAttachmentItem[] = [];
  const add = (item:ChatAttachmentItem) => { if (!items.some(existing=>existing.id===item.id)) items.push(item); };
  if (message.mediaUrl) {
    const kind = message.mediaType === 'image' || message.mediaType === 'video' || message.mediaType === 'audio' ? message.mediaType : 'file';
    add({ id:`${message._id}-media`, url:assetUrl(message.mediaUrl), name:fileNameFromUrl(message.mediaUrl), mimeType:kind==='file'?'application/octet-stream':`${kind}/*`, size:0, kind });
  }
  message.attachments?.forEach((attachment,index)=>{
    const kind = attachment.mimeType.startsWith('image/') ? 'image' : attachment.mimeType.startsWith('video/') ? 'video' : attachment.mimeType.startsWith('audio/') ? 'audio' : 'file';
    add({ id:`${message._id}-attachment-${index}`, url:assetUrl(attachment.url), name:attachment.name, mimeType:attachment.mimeType, size:attachment.size, kind });
  });
  const text = message.text || '';
  if (text.startsWith('[IMAGE]')) {
    const url = text.slice(7);
    add({ id:`${message._id}-legacy-image`, url:assetUrl(url), name:fileNameFromUrl(url), mimeType:'image/*', size:0, kind:'image' });
  } else if (text.startsWith('[FILE]')) {
    const body = text.slice(6);
    const separator = body.indexOf('|');
    if (separator > 0) {
      const url = body.slice(separator + 1);
      const mimeType = url.match(/^data:([^;,]+)/i)?.[1] || 'application/octet-stream';
      const kind = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('audio/') ? 'audio' : 'file';
      add({ id:`${message._id}-legacy-file`, url:assetUrl(url), name:body.slice(0,separator), mimeType, size:0, kind });
    }
  }
  return items;
};

const MessageBubble: React.FC<{
  message: DirectMessage;
  isMine: boolean;
  onOpenMedia: (id:string)=>void;
  onDownload: (item:ChatAttachmentItem)=>void;
  onShare: (item:ChatAttachmentItem)=>void;
}> = ({message, isMine, onOpenMedia, onDownload, onShare}) => {
  const text = message.text || '';
  if (text.startsWith('[VOICE]')) return <div className={`rounded-2xl px-4 py-2.5 ${isMine?'rounded-br-md bg-blue-600':'rounded-bl-md border border-slate-200 bg-white'}`}><audio controls src={text.slice(7)} className="w-56 max-w-full" /></div>;
  const attachments = getMessageAttachments(message);
  const displayText = text.startsWith('[IMAGE]') || text.startsWith('[FILE]') ? '' : text;
  const cls = `whitespace-pre-wrap break-words rounded-2xl px-3 py-2.5 text-sm leading-relaxed ${isMine ? 'rounded-br-md bg-blue-600 text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-900'}`;
  const renderActions = (item:ChatAttachmentItem) => <div className="absolute right-2 top-2 flex gap-1 opacity-100 transition md:opacity-0 md:group-hover:opacity-100">
    <button type="button" onClick={()=>onDownload(item)} aria-label={`Download ${item.name}`} className="grid h-9 w-9 place-items-center rounded-full bg-black/70 text-white shadow-sm"><Download size={16}/></button>
    <button type="button" onClick={()=>onShare(item)} aria-label={`Share ${item.name}`} className="grid h-9 w-9 place-items-center rounded-full bg-black/70 text-white shadow-sm"><Share2 size={16}/></button>
  </div>;
  return <div className={cls}>
    {displayText && <p>{displayText.startsWith('[CALL]') ? `📞 ${displayText.slice(6)}` : displayText}</p>}
    {attachments.map(item => item.kind === 'image' || item.kind === 'video'
      ? <ChatMediaGate key={item.id} url={item.url} kind={item.kind} size={item.size} name={item.name}><div className="group relative mt-1.5 overflow-hidden rounded-xl">
          <button type="button" onClick={()=>onOpenMedia(item.id)} aria-label={`Open ${item.kind}: ${item.name}`} className="block max-w-full">
            {item.kind === 'image'
              ? <img src={item.url} alt={item.name} loading="lazy" className="max-h-72 max-w-full rounded-xl object-contain"/>
              : <span className="relative block"><video src={item.url} muted playsInline preload="metadata" className="max-h-72 max-w-full rounded-xl"/><span className="absolute inset-0 grid place-items-center bg-black/20 text-white"><Play size={34} fill="currentColor"/></span></span>}
          </button>
          {renderActions(item)}
        </div></ChatMediaGate>
      : <div key={item.id} className="mt-1.5 min-w-0 max-w-full rounded-xl border border-current/15 bg-black/5 p-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-black/10">
              {item.kind==='audio' ? <FileAudio size={20}/> : item.mimeType.includes('zip') ? <FileArchive size={20}/> : item.mimeType.startsWith('image/') ? <ImageIcon size={20}/> : <FileText size={20}/>}
            </span>
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{item.name}</span><span className="text-[10px] opacity-70">{fileSizeLabel(item.size)}</span></span>
            <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.name}`} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/10"><ExternalLink size={16}/></a>
            <button type="button" onClick={()=>onDownload(item)} aria-label={`Download ${item.name}`} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/10"><Download size={16}/></button>
            <button type="button" onClick={()=>onShare(item)} aria-label={`Share ${item.name}`} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/10"><Share2 size={16}/></button>
          </div>
          {item.kind==='audio'&&<audio controls src={item.url} className="mt-2 w-full"/>}
        </div>)}
  </div>;
};

const EmojiPickerPanel = lazy(async () => {
  const { default: Picker, Categories, SkinTonePickerLocation, SuggestionMode, Theme } = await import('emoji-picker-react');
  const categories = [
    { category: Categories.SUGGESTED, name: 'Frequently used' },
    { category: Categories.SMILEYS_PEOPLE, name: 'Smileys & People' },
    { category: Categories.ANIMALS_NATURE, name: 'Animals' },
    { category: Categories.FOOD_DRINK, name: 'Food' },
    { category: Categories.ACTIVITIES, name: 'Activities' },
    { category: Categories.TRAVEL_PLACES, name: 'Travel' },
    { category: Categories.OBJECTS, name: 'Objects' },
    { category: Categories.SYMBOLS, name: 'Symbols' },
    { category: Categories.FLAGS, name: 'Flags' }
  ];
  const Panel: React.FC<{ onPick: (emoji: string) => void }> = ({ onPick }) => (
    <Picker onEmojiClick={data => onPick(data.emoji)} width="100%" height={330} theme={Theme.LIGHT} categories={categories} suggestedEmojisMode={SuggestionMode.FREQUENT} searchPlaceholder="Search emoji" skinTonePickerLocation={SkinTonePickerLocation.SEARCH} previewConfig={{ showPreview: false }} autoFocusSearch={false} lazyLoadEmojis />
  );
  return { default: Panel };
});

interface PendingAttachment { id:string; file:File; previewUrl:string|null; }
interface ComposerProps {
  value:string;
  onChange:(v:string)=>void;
  onSend:()=>void|Promise<void>;
  onSendMedia:(text:string)=>Promise<void>;
  onSendAttachments:(files:File[],caption:string)=>Promise<number>;
  sending:boolean;
  uploadStatus:string;
}
const iconButton = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

const MessageComposer: React.FC<ComposerProps> = ({ value, onChange, onSend, onSendMedia, onSendAttachments, sending, uploadStatus }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const photoVideoFileRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const [caret, setCaret] = useState<{ position: number; tick: number } | null>(null);
  const [notice, setNotice] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [showCamera, setShowCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const camStreamRef = useRef<MediaStream|null>(null);
  const recRef = useRef<MediaRecorder|null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number|null>(null);
  const pendingRef = useRef(pendingAttachments);
  const hasText = value.trim().length > 0;
  pendingRef.current = pendingAttachments;

  useEffect(() => () => pendingRef.current.forEach(item => { if(item.previewUrl) URL.revokeObjectURL(item.previewUrl); }), []);
  useLayoutEffect(() => { const el=textareaRef.current; if(!el) return; el.style.height='auto'; el.style.height=`${Math.min(el.scrollHeight, INPUT_MAX_HEIGHT)}px`; el.style.overflowY = el.scrollHeight > INPUT_MAX_HEIGHT ? 'auto' : 'hidden'; }, [value]);
  useLayoutEffect(() => { if(!caret) return; const el=textareaRef.current; if(!el) return; el.focus(); el.setSelectionRange(caret.position, caret.position); }, [caret]);
  useEffect(() => { if(!pickerOpen) return; const onDown=(e:MouseEvent|TouchEvent)=>{ const t=e.target as Node; if(panelRef.current?.contains(t)||emojiButtonRef.current?.contains(t)) return; setPickerOpen(false); }; const onKey=(e:KeyboardEvent)=>{ if(e.key==='Escape') setPickerOpen(false); }; document.addEventListener('mousedown',onDown); document.addEventListener('touchstart',onDown); document.addEventListener('keydown',onKey); return ()=>{ document.removeEventListener('mousedown',onDown); document.removeEventListener('touchstart',onDown); document.removeEventListener('keydown',onKey); }; }, [pickerOpen]);
  useEffect(() => { if(!attachSheetOpen) return; const onDown=(e:MouseEvent|TouchEvent)=>{ const t=e.target as Node; if(attachMenuRef.current?.contains(t)) return; setAttachSheetOpen(false); }; const onKey=(e:KeyboardEvent)=>{ if(e.key==='Escape') setAttachSheetOpen(false); }; document.addEventListener('mousedown',onDown); document.addEventListener('touchstart',onDown); document.addEventListener('keydown',onKey); return ()=>{ document.removeEventListener('mousedown',onDown); document.removeEventListener('touchstart',onDown); document.removeEventListener('keydown',onKey); }; }, [attachSheetOpen]);
  useEffect(() => { if(!notice) return; const t=window.setTimeout(()=>setNotice(''),3000); return ()=>window.clearTimeout(t); }, [notice]);
  useEffect(() => { if(!showCamera) return; let alive=true; navigator.mediaDevices.getUserMedia({video:true}).then(s=>{ if(!alive) return; camStreamRef.current=s; if(videoRef.current) videoRef.current.srcObject=s; }).catch(()=>setNotice('Camera permission denied. Allow camera in browser.')); return ()=>{ alive=false; camStreamRef.current?.getTracks().forEach(tr=>tr.stop()); camStreamRef.current=null; }; }, [showCamera]);

  const insertEmoji = (emoji: string) => { const el=textareaRef.current; const start=el?.selectionStart ?? value.length; const end=el?.selectionEnd ?? value.length; const next=value.slice(0,start)+emoji+value.slice(end); if(next.length>MAX_MESSAGE_LENGTH) return; onChange(next); setCaret({position:start+emoji.length, tick:Date.now()}); };
  const addFiles = (event:React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files || []);
    if(files.length) setPendingAttachments(current=>[...current,...files.map(file=>({
      id:crypto.randomUUID(),
      file,
      previewUrl:inferredMimeType(file).startsWith('image/')?URL.createObjectURL(file):null
    }))]);
    setAttachSheetOpen(false);
    event.currentTarget.value='';
  };
  const removeAttachment = (id:string) => {
    const removed=pendingAttachments.find(item=>item.id===id);
    if(removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    setPendingAttachments(current=>current.filter(item=>item.id!==id));
  };
  const submit = async () => {
    if(sending) return;
    setPickerOpen(false);
    if(pendingAttachments.length) {
      const sentCount=await onSendAttachments(pendingAttachments.map(item=>item.file),value.trim());
      if(sentCount>0) {
        pendingAttachments.slice(0,sentCount).forEach(item=>{if(item.previewUrl)URL.revokeObjectURL(item.previewUrl);});
        setPendingAttachments(current=>current.slice(sentCount));
        onChange('');
      }
      textareaRef.current?.focus();
      return;
    }
    if(!hasText) return;
    void onSend();
    textareaRef.current?.focus();
  };
  const startRecording = async () => {
    try { const stream=await navigator.mediaDevices.getUserMedia({audio:true}); const rec=new MediaRecorder(stream); chunksRef.current=[]; recRef.current=rec; rec.ondataavailable=e=>{ if(e.data.size) chunksRef.current.push(e.data); }; rec.onstop=async()=>{ stream.getTracks().forEach(tr=>tr.stop()); const blob=new Blob(chunksRef.current,{type:'audio/webm'}); const reader=new FileReader(); reader.onload=()=>{ void onSendMedia(`[VOICE]${reader.result}`); }; reader.readAsDataURL(blob); }; rec.start(); setRecording(true); setRecSecs(0); recTimerRef.current=window.setInterval(()=>setRecSecs(s=>s+1),1000); }
    catch { setNotice('Mic permission denied. Allow microphone in browser.'); }
  };
  const stopRecording = () => { if(recTimerRef.current) window.clearInterval(recTimerRef.current); recRef.current?.stop(); setRecording(false); };
  const takePhoto = () => { const v=videoRef.current; if(!v) return; const c=document.createElement('canvas'); c.width=v.videoWidth; c.height=v.videoHeight; c.getContext('2d')?.drawImage(v,0,0); void onSendMedia(`[IMAGE]${c.toDataURL('image/jpeg',0.85)}`); setShowCamera(false); };
  return (
    <form onSubmit={e=>{e.preventDefault(); void submit();}} className="relative shrink-0 border-t border-slate-200 bg-white px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 md:pb-3">
      {pickerOpen && <div ref={panelRef} className="absolute bottom-full left-2 right-2 z-30 mb-2 max-h-[45dvh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl sm:right-auto sm:w-[22rem]"><Suspense fallback={<div className="flex h-40 items-center justify-center text-sm text-slate-500">Loading emojis…</div>}><EmojiPickerPanel onPick={insertEmoji} /></Suspense></div>}
      {attachSheetOpen && <div ref={attachMenuRef} role="menu" aria-label="Attach media" className="absolute bottom-full left-2 z-40 mb-2 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
        <button type="button" role="menuitem" onClick={()=>photoVideoFileRef.current?.click()} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100"><ImageIcon size={18}/>Photo or video</button>
        <button type="button" role="menuitem" onClick={()=>fileRef.current?.click()} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100"><FileText size={18}/>File</button>
        <button type="button" role="menuitem" onClick={()=>{setAttachSheetOpen(false);setShowCamera(true);}} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100"><Camera size={18}/>Camera</button>
      </div>}
      {showCamera && <div className="absolute bottom-full left-2 right-2 z-30 mb-2 rounded-2xl border bg-black p-2 shadow-xl"><video ref={videoRef} autoPlay playsInline className="w-full rounded-xl" /><div className="mt-2 flex justify-center gap-2"><button type="button" onClick={takePhoto} className="rounded-full bg-white px-4 py-2 text-sm font-bold">📸 Take Photo</button><button type="button" onClick={()=>setShowCamera(false)} className="rounded-full bg-slate-700 px-4 py-2 text-sm font-bold text-white">Cancel</button></div></div>}
      {notice && <p role="status" className="mb-2 px-1 text-xs text-slate-500">{notice}</p>}
      {pendingAttachments.length>0&&<div className="mb-2 rounded-2xl border border-slate-200 bg-slate-50 p-2.5">
        <div className="mb-2 flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-700">{pendingAttachments.length} attachment{pendingAttachments.length===1?'':'s'}</span>{uploadStatus&&<span role="status" className="truncate text-[11px] text-blue-700">{uploadStatus}</span>}</div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {pendingAttachments.map(item=><div key={item.id} className="relative flex w-32 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
            {item.previewUrl?<img src={item.previewUrl} alt={`Preview ${item.file.name}`} className="h-20 w-full object-cover"/>:<div className="grid h-20 place-items-center bg-slate-100 text-slate-500">{item.file.type.startsWith('video/')?<Video size={24}/>:item.file.type.startsWith('audio/')?<FileAudio size={24}/>:item.file.name.toLowerCase().endsWith('.zip')?<FileArchive size={24}/>:<FileText size={24}/>}</div>}
            <button type="button" disabled={sending} onClick={()=>removeAttachment(item.id)} aria-label={`Remove ${item.file.name}`} className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/70 text-white disabled:opacity-50"><X size={15}/></button>
            <span className="truncate px-2 pt-1.5 text-[11px] font-medium text-slate-700">{item.file.name}</span><span className="px-2 pb-1.5 text-[10px] text-slate-500">{fileSizeLabel(item.file.size)}</span>
          </div>)}
        </div>
        <label className="block text-[11px] font-semibold text-slate-500">Caption
          <textarea ref={textareaRef} value={value} rows={2} maxLength={MAX_MESSAGE_LENGTH} placeholder="Add a caption…" aria-label="Add a caption" disabled={sending} onChange={event=>onChange(event.target.value.slice(0,MAX_MESSAGE_LENGTH))} className="mt-1 block max-h-[90px] min-h-12 w-full resize-y rounded-xl bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-60"/>
        </label>
      </div>}
      <input ref={photoVideoFileRef} type="file" accept="image/*,video/*" multiple className="hidden" disabled={sending} onChange={addFiles} />
      <input ref={fileRef} type="file" accept="*/*" multiple className="hidden" disabled={sending} onChange={addFiles} />
      <div className="flex min-w-0 items-end gap-0.5 sm:gap-1">
        <button ref={emojiButtonRef} type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>setPickerOpen(o=>!o)} aria-label="Emoji" className={`${iconButton} ${pickerOpen?'bg-blue-50 text-blue-600':''}`}><Smile size={22}/></button>
        <button type="button" onClick={()=>{setPickerOpen(false);setAttachSheetOpen(o=>!o);}} aria-label="Attach files" aria-expanded={attachSheetOpen} title="Attach files, images, or videos" className={iconButton} disabled={sending}><Paperclip size={21}/></button>
        <div className="flex min-w-0 flex-1 items-end rounded-3xl border border-transparent bg-slate-100 px-4 py-2 focus-within:border-blue-300 focus-within:bg-white">
          {recording ? <div className="flex w-full items-center gap-2 text-sm text-red-600"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600"/> Recording {fmtCall(recSecs)} — tap mic to send</div> : pendingAttachments.length ? <span className="w-full py-1 text-xs text-slate-500">{pendingAttachments.length} file{pendingAttachments.length===1?'':'s'} ready to send</span> : <textarea ref={textareaRef} value={value} rows={1} maxLength={MAX_MESSAGE_LENGTH} placeholder="Type a message" aria-label="Type a message" onChange={e=>onChange(e.target.value.slice(0,MAX_MESSAGE_LENGTH))} onKeyDown={e=>{ if(e.key==='Enter' && !e.shiftKey && !e.nativeEvent.isComposing){ e.preventDefault(); void submit(); } }} className="block max-h-[100px] w-full resize-none bg-transparent text-sm leading-5 text-slate-900 outline-none placeholder:text-slate-400" />}
        </div>
        <button type="button" onClick={()=>setShowCamera(s=>!s)} aria-label="Camera" title="Take photo" className={iconButton} disabled={sending}><Camera size={21}/></button>
        {recording ? <button type="button" onClick={stopRecording} aria-label="Stop recording" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-600 text-white"><Square size={18}/></button>
        : hasText || pendingAttachments.length ? <button type="submit" disabled={sending} aria-label="Send message" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"><SendHorizontal size={19}/></button>
        : <button type="button" onClick={startRecording} aria-label="Record a voice message" title="Voice message" className={iconButton}><Mic size={21}/></button>}
      </div>
    </form>
  );
};

export const MessagesPage: React.FC<MessagesPageProps> = ({ initialUserId, onViewProfile }) => {
  const { user: currentUser } = useAuth();
  const { startCall, isConnected, onDirectMessage, onDirectMessagesRead } = useSocket();
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string|null>(initialUserId);
  const [selectedUser, setSelectedUser] = useState<User|null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [hasLoadedChat, setHasLoadedChat] = useState(false);
  const [draft, setDraft] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);
  const [chatReloadKey, setChatReloadKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [mediaNotice, setMediaNotice] = useState('');
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [visibleViewportHeight, setVisibleViewportHeight] = useState(() => typeof window === 'undefined' ? 0 : window.visualViewport?.height || window.innerHeight);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number|null>(null);
  const [showContacts, setShowContacts] = useState(false);
  const [contacts, setContacts] = useState<User[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const hasInitialScrollRef = useRef(false);
  const loadingConversationsRef = useRef(false);
  const selectedUserIdRef = useRef(selectedUserId);
  selectedUserIdRef.current = selectedUserId;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    const updateViewport = () => {
      const viewport = window.visualViewport;
      const height = viewport?.height || window.innerHeight;
      const focusedInput = document.activeElement instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
      setVisibleViewportHeight(height);
      setKeyboardOpen(Boolean(viewport && focusedInput && window.innerHeight - viewport.height > 120));
    };
    updateViewport();
    window.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('scroll', updateViewport);
    return () => {
      window.removeEventListener('resize', updateViewport);
      window.visualViewport?.removeEventListener('resize', updateViewport);
      window.visualViewport?.removeEventListener('scroll', updateViewport);
    };
  }, []);

  const loadConversations = useCallback(async (): Promise<boolean> => {
    if (loadingConversationsRef.current) return true;
    loadingConversationsRef.current = true;
    try {
      setConversations(await api.getDmConversations(currentUser?.id));
      return true;
    } catch (error) {
      console.warn('[DM] Background conversation-list request failed', error);
      return false;
    } finally {
      setLoadingList(false);
      loadingConversationsRef.current = false;
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (!isOnline) { setLoadingList(false); return; }
    void loadConversations();
  }, [loadConversations, isOnline]);

  useEffect(() => {
    if (!currentUser?.id) return;
    const unsubscribeMessage = onDirectMessage(({ message, partner }) => {
      const partnerId = message.senderId === currentUser.id ? message.receiverId : message.senderId;
      const isIncoming = message.senderId !== currentUser.id;
      const isSelected = selectedUserIdRef.current === partnerId;
      const isVisible = !document.hidden;
      if (isSelected) {
        setMessages(previous => dedupeMessages([...previous, message]));
        setHasLoadedChat(true);
        if (isIncoming && isVisible) {
          void api.markDmRead(partnerId, currentUser.id).then(() => {
            setConversations(previous => previous.map(item => item.user.id === partnerId ? { ...item, unreadCount: 0 } : item));
          }).catch(error => console.warn('[DM] Could not mark messages read:', error));
        }
      }
      invalidateApiReadCache('dm:conversations', currentUser.id);
      invalidateApiReadCache(`dm:conversation:${partnerId}`, currentUser.id);
      setConversations(previous => {
        const existing = previous.find(item => item.user.id === partnerId);
        const updated: DirectConversation = existing
          ? {
              ...existing,
              lastMessage: message,
              unreadCount: isIncoming ? existing.unreadCount + (isSelected && isVisible ? 0 : 1) : existing.unreadCount
            }
          : { user: partner, lastMessage: message, unreadCount: isIncoming && !(isSelected && isVisible) ? 1 : 0 };
        return [updated, ...previous.filter(item => item.user.id !== partnerId)].sort((a, b) => b.lastMessage.createdAt - a.lastMessage.createdAt);
      });
    });
    const unsubscribeRead = onDirectMessagesRead(({ readerId, senderId, readAt }) => {
      if (readerId !== selectedUserIdRef.current || senderId !== currentUser.id) return;
      invalidateApiReadCache('dm:conversations', currentUser.id);
      invalidateApiReadCache(`dm:conversation:${readerId}`, currentUser.id);
      setMessages(previous => previous.map(message =>
        message.senderId === currentUser.id && message.receiverId === readerId && message.readAt === null
          ? { ...message, readAt }
          : message
      ));
      setConversations(previous => previous.map(item => item.user.id === readerId ? { ...item, unreadCount: 0 } : item));
    });
    const markVisibleConversationRead = () => {
      const partnerId = selectedUserIdRef.current;
      if (document.hidden || !partnerId) return;
      const hasUnread = messagesRef.current.some(message =>
        message.senderId === partnerId && message.receiverId === currentUser.id && !message.readAt
      );
      if (!hasUnread) return;
      void api.markDmRead(partnerId, currentUser.id).then(() => {
        setMessages(previous => previous.map(message =>
          message.senderId === partnerId && message.receiverId === currentUser.id && !message.readAt
            ? { ...message, readAt: Date.now() }
            : message
        ));
        setConversations(previous => previous.map(item => item.user.id === partnerId ? { ...item, unreadCount: 0 } : item));
      }).catch(error => console.warn('[DM] Could not mark messages read:', error));
    };
    document.addEventListener('visibilitychange', markVisibleConversationRead);
    return () => {
      unsubscribeMessage();
      unsubscribeRead();
      document.removeEventListener('visibilitychange', markVisibleConversationRead);
    };
  }, [currentUser?.id, onDirectMessage, onDirectMessagesRead]);

  useEffect(()=>{ if(!showContacts) return; let alive=true; setLoadingContacts(true); void api.getUsers().then(u=>{ if(alive) setContacts(u.filter(c=>c.id!==currentUser?.id)); }).catch(()=>{ if(alive) setMediaNotice('Could not load contacts. Please try again.'); }).finally(()=>{ if(alive) setLoadingContacts(false); }); return ()=>{alive=false;}; },[showContacts, currentUser?.id]);
  useEffect(()=>{ setSelectedUserId(initialUserId); },[initialUserId]);

  useEffect(() => {
    let alive = true;
    if (!selectedUserId) {
      setSelectedUser(null);
      setMessages([]);
      setHasLoadedChat(false);
      setLoadingChat(false);
      setSendError('');
      return () => { alive = false; };
    }
    setMessages([]);
    setHasLoadedChat(false);
    setLoadingChat(true);
    setSendError('');
    isNearBottomRef.current = true;
    hasInitialScrollRef.current = false;
    const knownUser = conversations.find(item => item.user.id === selectedUserId)?.user;
    if (knownUser) setSelectedUser(knownUser);
    else if (selectedUser?.id !== selectedUserId) {
      setSelectedUser(null);
      if (selectedUserId !== currentUser?.id) {
        void api.getUserProfile(selectedUserId)
          .then(profile => { if(alive) setSelectedUser(profile.user); })
          .catch(() => { if(alive) setMediaNotice('Could not load this person’s profile.'); });
      }
    }
    return () => { alive = false; };
  // The selected conversation is reset only when its id changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId, currentUser?.id]);

  useEffect(() => {
    if (!selectedUserId) return;
    let alive = true;
    if (!isOnline) { setLoadingChat(false); return () => { alive = false; }; }
    setLoadingChat(true);
    void api.getDmConversation(selectedUserId, currentUser?.id).then(rows => {
      if (!alive) return;
      const next = dedupeMessages(rows);
      setMessages(previous => messagesAreEqual(previous, next) ? previous : next);
      setHasLoadedChat(true);
      const hasUnread = Boolean(currentUser?.id) && rows.some(message =>
        message.senderId === selectedUserId && message.receiverId === currentUser?.id && !message.readAt
      );
      if (hasUnread && !document.hidden) {
        // Chat opened (also from a notification / push): badge drops now, server marks all read.
        clearUnreadMessages(rows.filter(message => message.senderId === selectedUserId && message.receiverId === currentUser?.id && !message.readAt).length);
        setConversations(previous => previous.map(item => item.user.id === selectedUserId ? { ...item, unreadCount: 0 } : item));
        void api.markDmRead(selectedUserId, currentUser?.id).then(() => {
          setConversations(previous => previous.map(item => item.user.id === selectedUserId ? { ...item, unreadCount: 0 } : item));
        }).catch(error => console.warn('[DM] Could not mark messages read:', error));
      }
    }).catch(() => {
      if (alive) setSendError('Could not load messages. Please check your connection and try again.');
    }).finally(() => {
      if (alive) setLoadingChat(false);
    });
    return () => { alive = false; };
  }, [selectedUserId, currentUser?.id, isOnline, chatReloadKey]);

  const sortedMessages = useMemo(()=>messages.filter(m=>!(m.text||'').startsWith('[SIGNAL]')).slice().sort((a,b)=>a.createdAt-b.createdAt),[messages]);
  const mediaItems = useMemo(
    () => sortedMessages.flatMap(getMessageAttachments).filter((item):item is ChatMediaItem=>item.kind==='image'||item.kind==='video'),
    [sortedMessages]
  );
  useLayoutEffect(()=>{ if(!sortedMessages.length||!isNearBottomRef.current)return; const c=messagesContainerRef.current; if(c){ c.scrollTo({top:c.scrollHeight,behavior:hasInitialScrollRef.current?'smooth':'auto'}); hasInitialScrollRef.current=true; } },[sortedMessages]);
  useEffect(()=>{ if(!mediaNotice)return; const timer=window.setTimeout(()=>setMediaNotice(''),2500); return()=>window.clearTimeout(timer); },[mediaNotice]);

  const updateConversationPreview = (message: DirectMessage, partner = selectedUser) => {
    if (!partner) return;
    setConversations(previous => {
      const existing = previous.find(item => item.user.id === partner.id);
      const updated: DirectConversation = { user: partner, lastMessage: message, unreadCount: existing?.unreadCount || 0 };
      return [updated, ...previous.filter(item => item.user.id !== partner.id)].sort((a, b) => b.lastMessage.createdAt - a.lastMessage.createdAt);
    });
  };
  const send = async () => { const text=draft.trim(); if(!selectedUserId||!text||sending) return; setSending(true); setSendError(''); try{ const sent=await api.sendDm(selectedUserId,text,undefined,currentUser?.id); isNearBottomRef.current=true; setMessages(p=>dedupeMessages([...p,sent])); updateConversationPreview(sent); setDraft(''); }catch(err){ console.error('[DM] User send failed',err); setSendError('Message could not be sent. Please try again.'); }finally{ setSending(false); } };
  const sendMedia = async (text:string) => { if(!selectedUserId||sending) return; setSending(true); setSendError(''); try{ const sent=await api.sendDm(selectedUserId,text,undefined,currentUser?.id); isNearBottomRef.current=true; setMessages(p=>dedupeMessages([...p,sent])); updateConversationPreview(sent); }catch(err){ console.error('[DM] Media send failed',err); setSendError('Media could not be sent. Please try again.'); }finally{ setSending(false); } };
  const sendAttachments = async (files:File[], caption:string):Promise<number> => {
    if(!selectedUserId||!files.length||sending)return 0;
    const receiverId=selectedUserId;
    setSending(true);
    setSendError('');
    let sentCount=0;
    try {
      for(let offset=0;offset<files.length;offset+=10) {
        const batch=files.slice(offset,offset+10);
        const attachments:MessageAttachment[]=[];
        for(const file of batch) {
          setUploadStatus(`Uploading ${file.name}…`);
          const mimeType=inferredMimeType(file);
          const uploadFile=file.type===mimeType?file:new File([file],file.name,{type:mimeType});
          let url:string;
          if(mimeType.startsWith('video/')) {
            url=(await api.uploadReelFile(uploadFile,(_percent,status)=>setUploadStatus(status||`Uploading ${file.name}…`))).url;
          } else {
            url=await api.uploadFile(uploadFile);
          }
          attachments.push({url,name:file.name,mimeType,size:file.size});
        }
        setUploadStatus('Sending attachments…');
        const sent=await api.sendDm(receiverId,sentCount===0?caption:'',attachments,currentUser?.id);
        updateConversationPreview(sent, selectedUser?.id === receiverId ? selectedUser : conversations.find(item => item.user.id === receiverId)?.user);
        if(selectedUserIdRef.current===receiverId){isNearBottomRef.current=true;setMessages(current=>dedupeMessages([...current,sent]));}
        sentCount+=batch.length;
      }
    } catch(err) {
      console.error('[DM] Attachment send failed',err);
      setSendError('Could not send all attachments. Please retry.');
    } finally {
      setUploadStatus('');
      setSending(false);
    }
    return sentCount;
  };
  const openMedia = (id:string) => {
    const index=mediaItems.findIndex(item=>item.id===id);
    if(index>=0)setViewerIndex(index);
  };
  const downloadAttachment = async (item:ChatAttachmentItem) => {
    try { await downloadChatAttachment(item); setMediaNotice('Downloaded'); }
    catch(err) { setMediaNotice(err instanceof Error?err.message:'Could not download this file.'); }
  };
  const shareAttachment = async (item:ChatAttachmentItem) => {
    try {
      const result=await shareChatAttachment(item);
      if(result==='copied')setMediaNotice('Media link copied');
    } catch(err) {
      if(!(err instanceof DOMException&&err.name==='AbortError'))setMediaNotice(err instanceof Error?err.message:'Could not share this media.');
    }
  };

  const startDmCall = (callType: 'audio' | 'video') => {
    if (!selectedUserId || !selectedUser) return;
    void startCall(selectedUserId, selectedUser.name, selectedUser.avatar, callType);
  };

  const selectConversation=(item:DirectConversation)=>{ setConversations(previous=>previous.map(c=>c.user.id===item.user.id?{...c,unreadCount:0}:c)); setSelectedUserId(item.user.id); setSelectedUser(item.user); setShowContacts(false); };
  const selectContact=(contact:User)=>{ setSelectedUserId(contact.id); setSelectedUser(contact); setShowContacts(false); };
  const chatHeight = Math.max(180, visibleViewportHeight - (keyboardOpen ? 90 : 150));

  return <section style={{height: `${chatHeight}px`}} className="relative mx-auto flex min-h-0 w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-700"><MessageSquare size={20}/></div><div><h1 className="text-lg font-bold text-slate-900">Messages</h1><p className="text-xs text-slate-500">Private conversations</p></div></header>
    <div className="grid min-h-0 flex-1 md:grid-cols-[300px_minmax(0,1fr)]">
      <aside className={`${selectedUserId && !showContacts ? 'hidden md:flex' : 'flex'} min-h-0 flex-col border-b border-slate-200 md:border-b-0 md:border-r`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div className="text-sm font-bold text-slate-800">{showContacts ? 'New chat' : 'Your conversations'}</div>{showContacts ? <button type="button" onClick={()=>setShowContacts(false)} className="rounded-lg px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50">Back</button> : <button type="button" onClick={()=>setShowContacts(true)} className="rounded-lg px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50">New Chat</button>}</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">{showContacts ? <>{loadingContacts && <p className="px-3 py-6 text-center text-sm text-slate-500">Loading contacts…</p>}{!loadingContacts && contacts.length===0 && <p className="px-3 py-6 text-center text-sm text-slate-500">No contacts available.</p>}{contacts.map(c=><button key={c.id} type="button" onClick={()=>selectContact(c)} className="flex min-h-[64px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-slate-50"><img src={c.avatar} alt="" title="View profile picture" onClick={avatarClick({ userId: c.id, name: c.name, avatar: c.avatar })} className="h-10 w-10 shrink-0 cursor-pointer rounded-full bg-slate-200 object-cover"/><span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{c.name}</span></button>)}</> : <>{loadingList && <p className="px-3 py-6 text-center text-sm text-slate-500">Loading conversations…</p>}{!loadingList && conversations.length===0 && <div className="px-4 py-10 text-center"><p className="font-semibold text-slate-800">No conversations yet</p><p className="mt-1 text-sm text-slate-500">Say hi to start chatting.</p></div>}{conversations.map(item=><button key={item.user.id} type="button" onClick={()=>selectConversation(item)} className={`flex min-h-[72px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-slate-50 ${selectedUserId===item.user.id?'bg-blue-50':''}`}><img src={item.user.avatar} alt="" title="View profile picture" onClick={avatarClick({ userId: item.user.id, name: item.user.name, avatar: item.user.avatar })} className="h-11 w-11 shrink-0 cursor-pointer rounded-full bg-slate-200 object-cover"/><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-900">{item.user.name}</span><span className="block truncate text-xs text-slate-500">{conversationPreview(item.lastMessage)}</span></span><span className="flex shrink-0 flex-col items-end gap-1"><span className="text-[10px] text-slate-400">{timeLabel(item.lastMessage.createdAt)}</span>{item.unreadCount>0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white">{item.unreadCount}</span>}</span></button>)}</>}</div>
      </aside>
      <section className={`${selectedUserId && !showContacts ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-col`}>
        {selectedUser ? <>
          <div className="sticky top-0 z-20 flex min-h-[64px] shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 sm:px-5">
            <button type="button" onClick={()=>setSelectedUserId(null)} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-slate-100 md:hidden" aria-label="Back"><ArrowLeft size={20}/></button>
            <button type="button" onClick={()=>onViewProfile(selectedUser.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><img src={selectedUser.avatar} alt="" title="View profile picture" onClick={avatarClick({ userId: selectedUser.id, name: selectedUser.name, avatar: selectedUser.avatar })} className="h-10 w-10 shrink-0 cursor-pointer rounded-full object-cover"/><span className="min-w-0 flex-1"><span className="block truncate font-bold text-slate-900">{selectedUser.name}</span>{!isOnline ? <span className="block text-[11px] text-slate-400">Offline. Reconnect to load messages</span> : !isConnected ? <span className="block text-[11px] text-slate-400">Connecting…</span> : null}</span></button>
            <button type="button" onClick={()=>startDmCall('audio')} title="Voice call" aria-label="Voice call" className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100"><Phone size={20}/></button>
            <button type="button" onClick={()=>startDmCall('video')} title="Video call" aria-label="Video call" className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100"><Video size={20}/></button>
          </div>
          <div ref={messagesContainerRef} onScroll={e=>{ const c=e.currentTarget; isNearBottomRef.current = c.scrollHeight - c.clientHeight - c.scrollTop <= 120; }} className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto overscroll-contain bg-slate-50 px-3 pt-5 pb-4 sm:px-6">
            {loadingChat && sortedMessages.length===0 && <p className="m-auto text-sm text-slate-500">Loading messages…</p>}
            {!loadingChat && !hasLoadedChat && sortedMessages.length===0 && <p className="m-auto max-w-xs text-center text-sm text-slate-500">{isOnline ? <>Unable to load messages. <button type="button" onClick={()=>{setSendError('');setChatReloadKey(key=>key+1);}} className="font-bold underline">Retry</button></> : 'Offline. Reconnect to load messages.'}</p>}
            {!loadingChat && hasLoadedChat && sortedMessages.length===0 && <p className="m-auto max-w-xs text-center text-sm text-slate-500">No messages yet. Say hi to start chatting.</p>}
            {sortedMessages.map(m=><div key={m._id} className={`max-w-[82%] sm:max-w-[70%] ${m.senderId===currentUser?.id?'self-end':'self-start'}`}><MessageBubble message={m} isMine={m.senderId===currentUser?.id} onOpenMedia={openMedia} onDownload={item=>void downloadAttachment(item)} onShare={item=>void shareAttachment(item)}/><div className={`mt-1 text-[10px] text-slate-400 ${m.senderId===currentUser?.id?'text-right':''}`}>{timeLabel(m.createdAt)}</div></div>)}
          </div>
          <div className="z-10 shrink-0"><MessageComposer value={draft} onChange={setDraft} onSend={send} onSendMedia={sendMedia} onSendAttachments={sendAttachments} sending={sending} uploadStatus={uploadStatus}/></div>
        </> : <div className="hidden flex-1 flex-col items-center justify-center text-center md:flex"><div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600"><MessageSquare size={28}/></div><h2 className="font-bold text-slate-800">Your messages</h2><p className="mt-1 text-sm text-slate-500">Choose someone to open a private chat.</p></div>}
      </section>
    </div>
    {mediaNotice && <div role="status" className="border-t border-blue-100 bg-blue-50 px-4 py-2 text-sm text-blue-700">{mediaNotice}</div>}
    {sendError && <div role="alert" className="border-t border-rose-100 bg-rose-50 px-4 py-2 text-sm text-rose-700">{sendError}</div>}
    {viewerIndex!==null&&<ChatMediaViewer items={mediaItems} index={viewerIndex} onIndexChange={setViewerIndex} onClose={()=>setViewerIndex(null)}/>}

  </section>;
};