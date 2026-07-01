import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider, SignedIn, SignedOut, SignIn } from '@clerk/clerk-react';
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n/index.js';
import App from './App.jsx';
import { CroquetOkLogo } from './components/OKBadge.jsx';
import { LawnBackground, LAWN_BASE } from './components/LawnBackground.jsx';
import './index.css';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Save bc-join destination before Clerk wipes the hash on sign-in redirect
try {
  const h = window.location.hash.replace(/^#/, '');
  if (h.startsWith('bc-join')) localStorage.setItem('bc-pending-join', h);
} catch {}

// Shrinks the wordmark on narrow viewports so "Croquet? [OK!]" always fits
// within the screen width instead of overflowing off both edges.
function useLandingLogoScale() {
  const compute = () => {
    if (typeof window === 'undefined') return 2.6;
    const w = window.innerWidth;
    if (w < 360) return 1.5;
    if (w < 400) return 1.7;
    if (w < 480) return 2.0;
    if (w < 640) return 2.3;
    return 2.6;
  };
  const [scale, setScale] = React.useState(compute);
  React.useEffect(() => {
    const onResize = () => setScale(compute());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return scale;
}

function LandingScreen() {
  const logoScale = useLandingLogoScale();
  return React.createElement('div', {
    style: {
      position: 'fixed',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      background: LAWN_BASE,
      padding: '2rem 1.25rem',
      gap: '2rem',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
    }
  },
    React.createElement(LawnBackground),
    React.createElement('div', {
      style: {
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        justifyContent: 'center',
        width: '100%',
        maxWidth: 440,
        padding: '0 0.5rem',
        flexShrink: 0,
      }
    },
      React.createElement(CroquetOkLogo, { scale: logoScale })
    ),
    React.createElement('div', {
      style: {
        position: 'relative',
        zIndex: 1,
        background: '#fff',
        borderRadius: 12,
        padding: '1.5rem',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
        width: '100%',
        maxWidth: 400,
        boxSizing: 'border-box',
        flexShrink: 0,
      }
    },
      React.createElement(SignIn, { routing: 'hash' })
    )
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement(I18nextProvider, { i18n },
  React.createElement(ClerkProvider, { publishableKey: PUBLISHABLE_KEY, afterSignInUrl: '/', afterSignUpUrl: '/' },
    React.createElement(React.Fragment, null,
      React.createElement(SignedOut, null,
        React.createElement(LandingScreen)
      ),
      React.createElement(SignedIn, null,
        React.createElement(App)
      )
    )
  )
  )
);
