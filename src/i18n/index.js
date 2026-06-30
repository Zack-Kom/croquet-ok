import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import es from './es.json';

const LANG_KEY = 'cq-lang';

// Detect stored preference, then fall back to browser language
function detectLanguage() {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === 'en' || stored === 'es') return stored;
  } catch {}
  const browser = navigator.language || navigator.userLanguage || 'en';
  return browser.toLowerCase().startsWith('es') ? 'es' : 'en';
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
    lng: detectLanguage(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

export function setLanguage(lang) {
  i18n.changeLanguage(lang);
  try { localStorage.setItem(LANG_KEY, lang); } catch {}
}

export function getStoredLang() {
  try { return localStorage.getItem(LANG_KEY); } catch { return null; }
}

export function browserLang() {
  const b = navigator.language || navigator.userLanguage || 'en';
  return b.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export default i18n;
