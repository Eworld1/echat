import React from 'react';

export const SplashScreen: React.FC<{ leaving?: boolean }> = ({ leaving = false }) => <div className={`fixed inset-0 z-[10000] grid place-items-center bg-black text-white ${leaving ? 'animate-out fade-out duration-500' : ''}`}>
  <div className="flex flex-col items-center animate-in fade-in zoom-in-95 duration-700">
    <img src="/logo-512.png" alt="EchatSl" className="h-56 w-56 rounded-full object-cover shadow-[0_0_80px_rgba(245,158,11,.25)] sm:h-72 sm:w-72" />
    <h1 className="mt-5 text-3xl font-black tracking-wide text-amber-300">EchatSl</h1>
    <p className="mt-1 text-sm text-slate-300">Connect, Share &amp; Chat</p>
    <span className="mt-5 h-5 w-5 animate-spin rounded-full border-2 border-amber-300 border-t-transparent" />
  </div>
</div>;
