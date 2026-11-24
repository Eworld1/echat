import React, { useEffect, useState } from 'react';
import { assetUrl } from '../services/apiBase';
import { initialsAvatar, isUsableAvatarUrl } from '../utils/avatar';

interface UserAvatarProps {
  src?: string | null;
  name: string;
  /** Diameter in px (the same circle everywhere, never stretched). */
  size?: number;
  className?: string;
  /** Optional coloured ring (e.g. unseen story). */
  ring?: string;
  onClick?: () => void;
  title?: string;
}

/**
 * Profile picture: a cropped circle, or a coloured circle with the person's initial(s) when there is
 * no photo or it fails to load. Never shows a broken-image icon.
 */
export const UserAvatar: React.FC<UserAvatarProps> = ({ src, name, size = 40, className = '', ring, onClick, title }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  const url = !failed && isUsableAvatarUrl(src) ? assetUrl(src) : initialsAvatar(name || '?');
  const image = (
    <img
      src={url}
      alt={name || 'Profile picture'}
      data-avatar=""
      data-name={name}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      onClick={onClick}
      title={title}
      className={`shrink-0 rounded-full bg-slate-200 object-cover ${onClick ? 'cursor-pointer transition hover:opacity-90' : ''} ${className}`}
      style={{ width: size, height: size, boxShadow: ring ? `0 0 0 2px #fff, 0 0 0 4px ${ring}` : undefined }}
    />
  );
  return image;
};

/** For places that need a plain src string: a usable photo URL, else the initials image. */
export const avatarSrc = (src: string | null | undefined, name: string) => (isUsableAvatarUrl(src) ? assetUrl(src) : initialsAvatar(name || '?'));
