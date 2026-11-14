import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Check, Copy, LoaderCircle, MessageSquarePlus, Pencil, RefreshCw, Send, Square, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import { v2Ai, type V2AiChat, type V2AiMessage } from '../../services/v2Ai';

const starters = ['Write a caption for my new post', 'Help me understand a school topic', 'Give me a business idea for Freetown', 'Help me write a short story'];
const timeLabel = (stamp: number) => new Date(stamp).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const V2AI: React.FC = () => {
  const [chats, setChats] = useState<V2AiChat[]>([]);
  const [active, setActive] = useState('');
  const [messages, setMessages] = useState<V2AiMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [renaming, setRenaming] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [copied, setCopied] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadChats = useCallback(async (selectFirst = true) => {
    setLoadingHistory(true); setError('');
    try {
      const list = await v2Ai.list(); setChats(list);
      if (selectFirst && !active && list[0]) setActive(list[0].id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load eChat AI history.'); }
    finally { setLoadingHistory(false); }
  }, [active]);

  useEffect(() => { void loadChats(); }, [loadChats]);
  useEffect(() => {
    if (!active) { setMessages([]); return; }
    let cancelled = false;
    setMessages([]); setError('');
    void v2Ai.load(active).then(data => { if (!cancelled) setMessages(data.messages); }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not open this chat.'); });
    return () => { cancelled = true; };
  }, [active]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages]);

  const newChat = async (): Promise<V2AiChat | null> => {
    setError('');
    try { const chat = await v2Ai.create(); setChats(value => [chat, ...value]); setActive(chat.id); return chat; }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create a new chat.'); return null; }
  };
  const send = async (value = prompt, chatId = active) => {
    const text = value.trim();
    if (!text || !chatId || generating) return;
    setPrompt(''); setError(''); setGenerating(true);
    const userMessage: V2AiMessage = { id: crypto.randomUUID(), role: 'user', content: text, createdAt: Date.now() };
    const responseId = crypto.randomUUID();
    setMessages(current => [...current, userMessage, { id: responseId, role: 'assistant', content: '', createdAt: Date.now() }]);
    const abort = new AbortController(); abortRef.current = abort;
    try {
      await v2Ai.stream(chatId, text, abort.signal, token => setMessages(current => current.map(message => message.id === responseId ? { ...message, content: message.content + token } : message)));
      const data = await v2Ai.load(chatId); setMessages(data.messages); setChats(current => current.map(chat => chat.id === chatId ? data.chat : chat).sort((a,b)=>b.updatedAt-a.updatedAt));
    } catch (reason) {
      if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'eChat AI could not answer.');
      const data = await v2Ai.load(chatId).catch(() => null);
      if (data) setMessages(data.messages);
      else setMessages(current => current.filter(message => message.id !== responseId));
    } finally { setGenerating(false); abortRef.current = null; }
  };
  const stop = () => abortRef.current?.abort();
  const rename = async (chatId: string) => {
    const title = renameValue.trim(); if (!title) return;
    try { await v2Ai.rename(chatId, title); setChats(current => current.map(chat => chat.id === chatId ? { ...chat, title } : chat)); setRenaming(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not rename the chat.'); }
  };
  const remove = async (chatId: string) => {
    if (!window.confirm('Delete this eChat AI conversation?')) return;
    try { await v2Ai.remove(chatId); const remaining = chats.filter(chat => chat.id !== chatId); setChats(remaining); if (active === chatId) setActive(remaining[0]?.id || ''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete the chat.'); }
  };
  const feedback = async (messageId: string, value: 'like' | 'dislike') => {
    if (!active) return;
    try { await v2Ai.feedback(active, messageId, value); setMessages(current => current.map(message => message.id === messageId ? { ...message, feedback: value } : message)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save feedback.'); }
  };
  const copy = async (message: V2AiMessage) => {
    try { await navigator.clipboard.writeText(message.content); setCopied(message.id); window.setTimeout(() => setCopied(''), 1400); }
    catch { setError('Clipboard access is unavailable in this browser.'); }
  };
  const regenerate = () => {
    const lastPrompt = [...messages].reverse().find(message => message.role === 'user')?.content;
    if (lastPrompt) void send(lastPrompt);
  };

  return <div className="echat-v2-page mx-auto flex h-[calc(100dvh-150px)] min-h-[540px] max-w-[1100px] flex-col overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm md:flex-row">
    <aside className="flex max-h-52 shrink-0 flex-col border-b border-slate-100 bg-slate-50 p-3 md:max-h-none md:w-72 md:border-b-0 md:border-r">
      <button onClick={()=>void newChat()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0F1B2D] px-4 text-sm font-bold text-white"><MessageSquarePlus size={17}/>New chat</button>
      <h2 className="px-2 pb-2 pt-4 text-xs font-extrabold uppercase tracking-wider text-slate-500">Recent chats</h2>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">{chats.map(chat=><div key={chat.id} className={`group rounded-xl ${active===chat.id?'bg-[#FFF2C7]':'hover:bg-white'}`}><button onClick={()=>setActive(chat.id)} className="w-full truncate px-3 pb-1 pt-2 text-left text-sm font-semibold">{chat.title}</button><div className="flex items-center gap-2 px-3 pb-2 text-[11px] text-slate-500">{timeLabel(chat.updatedAt)}<button aria-label="Rename chat" onClick={()=>{setRenaming(chat.id);setRenameValue(chat.title);}} className="ml-auto rounded p-1 hover:bg-slate-200"><Pencil size={13}/></button><button aria-label="Delete chat" onClick={()=>void remove(chat.id)} className="rounded p-1 text-rose-600 hover:bg-rose-50"><Trash2 size={13}/></button></div>{renaming===chat.id&&<form onSubmit={event=>{event.preventDefault();void rename(chat.id);}} className="flex gap-1 px-2 pb-2"><input autoFocus value={renameValue} onChange={event=>setRenameValue(event.target.value)} maxLength={80} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs"/><button className="rounded-lg bg-emerald-600 px-2 text-white"><Check size={13}/></button></form>}</div>)}{loadingHistory&&!chats.length&&<p className="p-3 text-xs text-slate-500">Loading chats…</p>}{!loadingHistory&&!chats.length&&<p className="p-3 text-xs leading-5 text-slate-500">Your saved conversations will appear here.</p>}</div>
    </aside>
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-4 py-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#FFF2C7] text-[#705000]"><Bot size={19}/></span><div><h1 className="font-extrabold">eChat AI</h1><p className="text-xs text-slate-500">Helpful answers, writing, learning, and ideas</p></div></header>
      {error&&<p role="alert" className="mx-4 mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
        {!active||!messages.length?<div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center"><div className="mb-6 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#FFF2C7] text-[#705000]"><Bot size={28}/></span><h2 className="mt-4 text-2xl font-extrabold">What can I help with?</h2><p className="mt-2 text-sm text-slate-500">Ask a question or choose a starter below.</p></div><div className="grid gap-2 sm:grid-cols-2">{starters.map(starter=><button key={starter} onClick={()=>{if(active)void send(starter);else void newChat().then(chat=>chat&&send(starter,chat.id));}} className="rounded-2xl border border-slate-200 p-4 text-left text-sm font-semibold hover:border-amber-300 hover:bg-amber-50">{starter}</button>)}</div>{!active&&<button onClick={()=>void newChat()} className="mx-auto mt-4 min-h-11 rounded-full bg-[#F5B301] px-5 text-sm font-extrabold">Start a new chat</button>}</div>:<div className="mx-auto max-w-3xl space-y-6">{messages.map((message,index)=><article key={message.id} className={message.role==='user'?'ml-auto max-w-[90%] rounded-2xl bg-slate-100 p-4 sm:max-w-[78%]':'max-w-full'}><p className="whitespace-pre-wrap text-sm leading-7">{message.content|| (generating&&index===messages.length-1?<span className="inline-flex items-center gap-2 text-slate-500"><LoaderCircle size={16} className="animate-spin"/>eChat AI is thinking…</span>:null)}</p>{message.role==='assistant'&&message.content&&<div className="mt-3 flex flex-wrap items-center gap-1 text-slate-500"><button onClick={()=>void copy(message)} aria-label="Copy response" className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs hover:bg-slate-100">{copied===message.id?<Check size={15}/>:<Copy size={15}/>} {copied===message.id?'Copied':'Copy'}</button><button onClick={()=>void feedback(message.id,'like')} aria-label="Like response" className={`grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100 ${message.feedback==='like'?'text-emerald-700':''}`}><ThumbsUp size={15}/></button><button onClick={()=>void feedback(message.id,'dislike')} aria-label="Dislike response" className={`grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100 ${message.feedback==='dislike'?'text-rose-700':''}`}><ThumbsDown size={15}/></button>{index===messages.length-1&&!generating&&<button onClick={regenerate} aria-label="Regenerate response" className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs hover:bg-slate-100"><RefreshCw size={14}/>Regenerate</button>}</div>}</article>)}</div>}
      </div>
      <form onSubmit={event=>{event.preventDefault();if(active)void send();else void newChat().then(chat=>chat&&send(prompt,chat.id));}} className="mx-auto flex w-full max-w-3xl shrink-0 items-end gap-2 border-t border-slate-100 p-3 sm:p-4"><textarea value={prompt} onChange={event=>setPrompt(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();if(active)void send();else void newChat().then(chat=>chat&&send(prompt,chat.id));}}} rows={1} maxLength={8000} placeholder="Message eChat AI…" className="max-h-36 min-h-12 min-w-0 flex-1 resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base outline-none focus:ring-2 focus:ring-amber-300"/><button type="button" disabled={!generating} onClick={stop} aria-label="Stop generating" className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700 disabled:hidden"><Square size={16}/></button><button disabled={generating||!prompt.trim()} aria-label="Send message" className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#F5B301] text-[#0F1B2D] disabled:opacity-50"><Send size={18}/></button></form>
    </section>
  </div>;
};
