import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider, SignedIn, SignedOut, SignIn } from '@clerk/clerk-react';
import App from './App.jsx';
import './index.css';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement(ClerkProvider, { publishableKey: PUBLISHABLE_KEY },
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
);
