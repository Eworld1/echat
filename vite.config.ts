import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** Absolute site address for the link-preview tags in index.html (WhatsApp needs absolute image URLs). */
const SITE_URL = `https://${(process.env.VERCEL_PROJECT_PRODUCTION_URL || 'echat-ivory.vercel.app').replace(/^https?:\/\//, '')}`;
const siteUrlInHtml = (): Plugin => ({ name: 'echat-site-url', transformIndexHtml: html => html.replaceAll('__SITE_URL__', SITE_URL) });

export default defineConfig({
  plugins: [react(), tailwindcss(), siteUrlInHtml()],
  // NEXT_PUBLIC_* too, so the Cloudinary settings already in Vercel (NEXT_PUBLIC_CLOUDINARY_*) reach the app.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          if (id.includes('/firebase/') || id.includes('/@firebase/')) return 'firebase';
          return undefined;
        },
      },
    },
  },
});
