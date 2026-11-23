import React from 'react';

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
  if (images.length === 0) return null;

  const renderImage = (url: string, index: number, single = false) => {
    const image = (
      <img
        src={url}
        alt={`${altPrefix} ${index + 1}`}
        loading="lazy"
        className={single
          ? 'block h-auto max-h-[600px] w-full object-contain'
          : 'h-full w-full object-cover object-top transition group-hover:brightness-95'}
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
