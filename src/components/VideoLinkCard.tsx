import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, Play, RotateCcw } from 'lucide-react';
import { parseVideoLink } from '../utils/embedVideo';

export const VideoLinkCard: React.FC<{ text: string }> = ({ text }) => {
  const link = parseVideoLink(text);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(true);
  const [cc, setCc] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [caption, setCaption] = useState('');
  const [ccError, setCcError] = useState('');
  const shellRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  useEffect(() => {
    const node = shellRef.current;
    if (!node || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.15 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!playing || frameLoaded) return;
    const timer = window.setTimeout(() => setFailed(true), 8000);
    return () => window.clearTimeout(timer);
  }, [playing, frameLoaded]);
  useEffect(() => {
    if (!playing || !cc) { recognitionRef.current?.stop?.(); recognitionRef.current = null; return; }
    const w = window as any;
    const Speech = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Speech) { setCcError('Captions not supported on this browser'); setCc(false); return; }
    const rec = new Speech(); recognitionRef.current = rec; rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
    rec.onresult = (event: any) => { const result = event.results[event.results.length - 1]; if (result?.[0]) setCaption(result[0].transcript); };
    rec.onerror = () => setCcError('Captions unavailable');
    try { rec.start(); } catch { setCcError('Captions unavailable'); }
    return () => { try { rec.stop(); } catch {} };
  }, [playing, cc]);
  if (!link) return null;
  const source = link.kind === 'youtube' ? 'YouTube Live' : link.kind === 'facebook' ? 'Facebook Live' : 'Link preview';
  const externalName = link.kind === 'youtube' ? 'YouTube' : link.kind === 'facebook' ? 'Facebook' : 'website';
  const thumb = link.kind === 'youtube' ? `https://i.ytimg.com/vi/${link.videoId}/hqdefault.jpg` : '';
  return <div ref={shellRef} className="mx-4 mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 text-white">
    <div className="relative aspect-video bg-gradient-to-br from-slate-800 to-black">
      {playing && visible && !failed ? <><iframe key={link.embedUrl} src={link.embedUrl} title={source} className="absolute inset-0 h-full w-full border-0" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" allowFullScreen onLoad={() => setFrameLoaded(true)} onError={() => setFailed(true)} /><span className="absolute left-3 top-3 rounded-full bg-red-600 px-2 py-1 text-[10px] font-black">{source}</span><button onClick={() => setCc(x => !x)} className="absolute bottom-3 right-3 rounded-lg bg-black/75 px-2 py-1 text-xs font-bold">CC {cc ? 'On' : 'Off'}</button>{cc && caption && <div className="absolute bottom-3 left-1/2 max-w-[85%] -translate-x-1/2 rounded bg-black/80 px-3 py-1 text-center text-sm font-semibold">{caption}</div>}</> : <>
        {thumb && <img src={thumb} alt="Video thumbnail" className="absolute inset-0 h-full w-full object-cover opacity-70" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/35 p-5 text-center"><span className={`rounded-full px-3 py-1 text-xs font-bold ${link.kind === 'facebook' ? 'bg-blue-600' : 'bg-red-600'}`}>{source}</span>{failed && <p className="text-sm">{link.kind === 'facebook' ? "This Facebook video can't be embedded." : 'This video is unavailable or could not be loaded.'}</p>}{link.kind === 'link' && <p className="text-sm">Open this link on {new URL(link.originalUrl).hostname}</p>}{link.kind !== 'link' && !failed && <button onClick={() => { setFailed(false); setPlaying(true); }} className="rounded-full bg-white p-4 text-slate-900 shadow-lg"><Play fill="currentColor" size={24} /></button>}{failed && link.kind === 'youtube' && <button onClick={() => { setFailed(false); setPlaying(true); }} className="flex items-center gap-1 rounded-lg bg-white/15 px-3 py-2 text-xs"><RotateCcw size={14} />Retry</button>}</div>
      </>}
    </div>
    <div className="flex items-center justify-between gap-2 p-3"><span className="truncate text-xs text-slate-300">{link.originalUrl}</span><a href={link.originalUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-bold">Open in {externalName}<ExternalLink size={13} /></a></div>
    {ccError && <p className="px-3 pb-3 text-xs text-amber-300">{ccError}</p>}
  </div>;
};
