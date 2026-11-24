import React from 'react';

/** EChat logo with a soft purple/pink glow. */
export const GlowLogo: React.FC<{ size?: number; className?: string }> = ({ size = 72, className = '' }) => (
  <span className={`relative inline-grid shrink-0 place-items-center ${className}`} style={{ width: size, height: size }}>
    <span aria-hidden="true" className="ec-gradient absolute inset-0 rounded-full opacity-70 blur-xl" />
    <img src="/logo-192.png" alt="EChat logo" width={size} height={size} className="ec-glow relative h-full w-full rounded-full object-cover ring-2 ring-white/40" />
  </span>
);

/** Logo + gradient "EChat" wordmark (top bar). */
export const BrandWordmark: React.FC<{ size?: number }> = ({ size = 34 }) => (
  <span className="flex items-center gap-2">
    <GlowLogo size={size} />
    <span className="ec-gradient-text text-[22px] font-black tracking-tight">EChat</span>
  </span>
);
