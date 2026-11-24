import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ConnectionBanner } from './components/ConnectionBanner.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { PreferencesProvider } from './context/PreferencesContext.tsx';
import './index.css';
import { installAvatarFallback } from './utils/avatar';

// Any profile picture that fails to load turns into an initials circle (no broken-image icons).
installAvatarFallback();

// Makes the app installable and fast. Production only, so dev hot-reload is never cached.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.warn('Service worker not registered:', err));
  });
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <PreferencesProvider>
      <ConnectionBanner />
      <App />
    </PreferencesProvider>
  </ErrorBoundary>,
);
