import React from 'react';

/**
 * "from Eworld (LEK GOD)" branding (like Facebook's "from Meta").
 * fixed: pinned to the bottom centre of the screen (splash). inline: sits in the page flow (login).
 */
export const BrandFooter: React.FC<{ fixed?: boolean; className?: string }> = ({ fixed = false, className = '' }) => (
  <footer
    className={`pointer-events-none select-none text-center leading-tight ${fixed ? 'fixed inset-x-0 bottom-0 pb-[calc(24px+env(safe-area-inset-bottom))]' : ''} ${className}`}
  >
    <p className="text-[12px] text-[#8A8A8A]">from</p>
    <p className="text-[14px] font-bold tracking-wide text-[#1C1E21]">Eworld (LEK GOD)</p>
  </footer>
);
