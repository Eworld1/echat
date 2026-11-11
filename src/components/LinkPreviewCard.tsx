import React, { useEffect, useState } from 'react';
import { ExternalLink, Link2 } from 'lucide-react';
import { extractFirstUrl, fetchLinkPreview, isVideoPlatformUrl, type LinkPreview } from '../utils/linkPreview';

export const LinkPreviewCard: React.FC<{ text: string; compact?: boolean }> = ({ text, compact = false }) => {
  const url = extractFirstUrl(text);
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setPreview(null);
    setImageFailed(false);
    if (url && !isVideoPlatformUrl(url)) fetchLinkPreview(url).then(value => { if (active) setPreview(value); });
    return () => { active = false; };
  }, [url]);
  if (!url || isVideoPlatformUrl(url)) return null;
  const fallbackDomain = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })();
  return <a href={url} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()} className={`mt-2 block overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-left text-slate-800 hover:bg-slate-100 ${compact ? 'max-w-[280px]' : ''}`}>
    {preview?.image && !imageFailed && <img src={preview.image} onError={() => setImageFailed(true)} alt="" loading="lazy" className="aspect-video max-h-48 w-full object-cover" />}
    <div className="flex items-start gap-2 p-3">
      {preview?.favicon ? <img src={preview.favicon} onError={event => { event.currentTarget.style.display = 'none'; }} alt="" className="mt-0.5 h-4 w-4 shrink-0" /> : <Link2 size={16} className="mt-0.5 shrink-0 text-slate-500" />}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{preview?.domain || fallbackDomain}</p>
        <p className="mt-0.5 line-clamp-2 text-sm font-bold">{preview?.title || fallbackDomain}</p>
        {preview?.description && <p className="mt-1 line-clamp-2 text-xs text-slate-600">{preview.description}</p>}
        {!preview && <p className="mt-1 truncate text-xs text-slate-500">{url}</p>}
      </div><ExternalLink size={14} className="mt-1 shrink-0 text-slate-400" />
    </div>
  </a>;
};
