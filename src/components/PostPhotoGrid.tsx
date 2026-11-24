import React, { useEffect, useState } from 'react';
import { ImageUp } from 'lucide-react';
import { blurPreviewUrl, countSaving, fetchMediaSize, isUnlocked, unlock, useLowDataMode } from '../services/lowData';

interface PostPhotoGridProps {
  urls: string[];
  altPrefix: string;
  onSelect?: (index: number) => void;
  renderTileControls?: (index: number) => React.ReactNode;
  onTileDragStart?: (index: number, event: React.DragEvent<HTMLDivElement>) => void;
  onTileDragOver?: (index: number, event: React.DragEvent<HTMLDivElement>) => void;
  onTileDrop?: (index: number, event: React.DragEvent<HTMLDivElement>) => void;
}

export const PostPhotoGrid: React.FC<PostPhotoGridProps> = ({
  urls,
  altPrefix,
  onSelect,
  renderTileControls,
  onTileDragStart,
  onTileDragOver,
  onTileDrop
}) => {
  const images = Array.from(new Set(urls.filter(Boolean)));
  // Low Data Mode: tiny blurred preview first, full photo only after "Tap to load HD".
  const [lowData] = useLowDataMode();
  const [, setHdVersion] = useState(0);
  const isLight = (url: string) => lowData && /^https?:\/\//.test(url) && !isUnlocked(url); // never blur local previews (blob:)
  const lightKey = images.filter(isLight).join('|');
  useEffect(() => {
    if (!lightKey) return;
    let alive = true;
    lightKey.split('|').slice(0, 4).forEach(url => { void fetchMediaSize(url).then(size => { if (alive && size) countSaving(url, Math.max(0, size - 2048)); }); });
    return () => { alive = false; };
  }, [lightKey]);
  if (images.length === 0) return null;

  const loadHd = (url: string) => { unlock(url); setHdVersion(value => value + 1); };
  const hdButton = (url: string) => isLight(url) && (
    <button type="button" onClick={event => { event.stopPropagation(); loadHd(url); }} className="absolute left-1/2 top-1/2 z-10 flex min-h-10 -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-black/65 px-4 text-xs font-bold text-white shadow-lg backdrop-blur-sm hover:bg-black/80">
      <ImageUp size={15} />Tap to load HD
    </button>
  );

  const renderImage = (url: string, index: number, single = false) => {
    const light = isLight(url);
    const preview = light ? blurPreviewUrl(url) : '';
    const image = light && !preview ? (
      <span aria-label={`${altPrefix} ${index + 1}`} role="img" className={single ? 'block aspect-[4/3] w-full bg-gradient-to-br from-slate-300 to-slate-400 dark:from-slate-700 dark:to-slate-800' : 'block h-full w-full bg-gradient-to-br from-slate-300 to-slate-400 dark:from-slate-700 dark:to-slate-800'} />
    ) : (
      <img
        src={light ? preview : url}
        alt={`${altPrefix} ${index + 1}`}
        loading="lazy"
        className={`${single
          ? 'block h-auto max-h-[600px] w-full object-contain'
          : 'h-full w-full object-cover object-top transition group-hover:brightness-95'}${light ? ' scale-105 blur-md' : ''}`}
      />
    );

    return onSelect ? (
      <button
        type="button"
        onClick={event => {
          event.stopPropagation();
          onSelect(index);
        }}
        aria-label={`View photo ${index + 1}`}
        className={single ? 'block w-full cursor-zoom-in bg-black' : 'absolute inset-0 z-0 block h-full w-full cursor-zoom-in bg-slate-100'}
      >
        {image}
      </button>
    ) : image;
  };

  if (images.length === 1) {
    return (
      <div className="group relative mx-auto max-h-[600px] w-full overflow-hidden bg-black">
        {renderImage(images[0], 0, true)}
        {hdButton(images[0])}
        {renderTileControls?.(0)}
      </div>
    );
  }

  const layout = images.length === 2
    ? 'aspect-[2/1] grid-cols-2'
    : 'aspect-square grid-cols-2 grid-rows-2';

  return (
    <div className={`grid w-full gap-[2px] overflow-hidden bg-white ${layout}`}>
      {images.slice(0, 4).map((url, index) => (
        <div
          key={`${url}-${index}`}
          draggable={Boolean(onTileDragStart)}
          onDragStart={event => onTileDragStart?.(index, event)}
          onDragOver={event => onTileDragOver?.(index, event)}
          onDrop={event => onTileDrop?.(index, event)}
          className={`group relative min-h-0 min-w-0 overflow-hidden ${images.length === 3 && index === 0 ? 'row-span-2' : ''}`}
        >
          {renderImage(url, index)}
          {!(images.length > 4 && index === 3) && hdButton(url)}
          {images.length > 4 && index === 3 && (onSelect ? (
            <button
              type="button"
              onClick={event => {
                event.stopPropagation();
                onSelect(index);
              }}
              aria-label={`View ${images.length - 4} more photos`}
              className="absolute inset-0 z-10 grid place-items-center bg-black/55 text-3xl font-extrabold text-white"
            >
              +{images.length - 4}
            </button>
          ) : (
            <div aria-label={`${images.length - 4} more photos`} className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-black/55 text-3xl font-extrabold text-white">
              +{images.length - 4}
            </div>
          ))}
          {renderTileControls?.(index)}
        </div>
      ))}
    </div>
  );
};
