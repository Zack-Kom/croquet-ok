import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider, SignedIn, SignedOut, SignIn } from '@clerk/clerk-react';
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n/index.js';
import App from './App.jsx';
import './index.css';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Save bc-join destination before Clerk wipes the hash on sign-in redirect
try {
  const h = window.location.hash.replace(/^#/, '');
  if (h.startsWith('bc-join')) localStorage.setItem('bc-pending-join', h);
} catch {}

ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement(I18nextProvider, { i18n },
  React.createElement(ClerkProvider, { publishableKey: PUBLISHABLE_KEY, afterSignInUrl: '/', afterSignUpUrl: '/' },
    React.createElement(React.Fragment, null,
      React.createElement(SignedOut, null,
        React.createElement('div', {
          style: {
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '100vh',
            background: '#E2EDD8',
          }
        },
          React.createElement(SignIn, { routing: 'hash' })
        )
      ),
      React.createElement(SignedIn, null,
        React.createElement(App)
      )
    )
  )
  )
);
