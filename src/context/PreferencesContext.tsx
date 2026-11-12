import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LANGUAGES, en, isLanguageName, type LanguageName, type TranslationKey } from '../i18n/translations';

export type ThemeChoice = 'light' | 'dark' | 'system';

interface PreferencesContextType {
  theme: ThemeChoice;
  /** What is actually shown right now (resolves "system"). */
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: ThemeChoice) => void;
  language: LanguageName;
  setLanguage: (language: LanguageName) => void;
  t: (key: TranslationKey, vars?: Record<string, string>) => string;
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

const systemPrefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

function readTheme(): ThemeChoice {
  const saved = localStorage.getItem('echat_color_theme') || localStorage.getItem('echat_theme');
  return saved === 'dark' || saved === 'light' || saved === 'system' ? saved : 'light';
}

function readLanguage(): LanguageName {
  const saved = localStorage.getItem('echat_language');
  return isLanguageName(saved) ? saved : 'English';
}

export const PreferencesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeChoice>(readTheme);
  const [language, setLanguageState] = useState<LanguageName>(readLanguage);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Follow the device while "system" is selected
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme: 'light' | 'dark' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  // Applied instantly, in every screen, the moment the choice changes
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.style.colorScheme = resolvedTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'dark' ? '#0f172a' : '#2563EB');
  }, [resolvedTheme]);

  useEffect(() => {
    const info = LANGUAGES[language];
    document.documentElement.lang = info.code;
    document.documentElement.dir = info.dir;
  }, [language]);

  const setTheme = useCallback((next: ThemeChoice) => {
    localStorage.setItem('echat_color_theme', next);
    setThemeState(next);
  }, []);

  const setLanguage = useCallback((next: LanguageName) => {
    localStorage.setItem('echat_language', next);
    setLanguageState(next);
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string>) => {
      let text = LANGUAGES[language].dict[key] ?? en[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(v);
      return text;
    },
    [language]
  );

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, language, setLanguage, t }),
    [theme, resolvedTheme, setTheme, language, setLanguage, t]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
};

export function usePreferences(): PreferencesContextType {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside <PreferencesProvider>');
  return ctx;
}
