import React from 'react';

export const SplashScreen: React.FC<{ leaving?: boolean }> = ({ leaving = false }) => <div className="fixed inset-0 z-[10000] grid place-items-center bg-white text-slate-900 transition-opacity duration-500" style={{ opacity: leaving ? 0 : 1 }}>
  <div className="flex flex-col items-center animate-in fade-in zoom-in-95 duration-700">
    <img src="/logo-mark-blue.svg" alt="Echat" className="h-40 w-40 object-contain sm:h-48 sm:w-48" />
    <h1 className="mt-5 text-3xl font-black tracking-wide text-[#0A2A6B]">Echat</h1>
    <p className="mt-1 text-sm text-slate-600">Connect, Share &amp; Chat</p>
    <span className="mt-5 h-5 w-5 animate-spin rounded-full border-2 border-[#0A2A6B] border-t-transparent" />
  </div>
</div>;
