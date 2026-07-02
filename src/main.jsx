import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider, SignedIn, SignedOut, SignIn, useSignIn } from '@clerk/clerk-react';
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n/index.js';
import App from './App.jsx';
import { CroquetOkLogo } from './components/OKBadge.jsx';
import { LawnBackground, LAWN_BASE } from './components/LawnBackground.jsx';
import { isNativePlatform, signInWithGoogleNative, SSO_REDIRECT_URL, isNativeGoogleBridge } from './lib/nativeAuth.js';
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

// Native (Capacitor) sign-in: Clerk's prebuilt <SignIn> uses an in-WebView redirect
// for "Continue with Google", which Google blocks inside embedded WebViews. So on the
// native app we render our own button that runs the OAuth handshake in the system
// browser (see src/lib/nativeAuth.js). Web is unaffected — it keeps using <SignIn>.
function NativeGoogleSignIn() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);

  async function handleGoogle() {
    if (!isLoaded || busy) return;
    setErr(null);
    setBusy(true);
    try {
      await signInWithGoogleNative(signIn, setActive);
      // On success, <SignedIn> takes over and renders <App>; keep the button disabled
      // through the transition rather than flipping back to the idle state.
    } catch (e) {
      setErr((e && e.message) ? e.message : 'Google sign-in failed. Please try again.');
      setBusy(false);
    }
  }

  return React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: '100%' },
  },
    React.createElement('button', {
      onClick: handleGoogle,
      disabled: !isLoaded || busy,
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        width: '100%', maxWidth: 340, padding: '14px 18px', borderRadius: 12,
        border: 'none', background: '#fff', color: '#1f2937', fontSize: 16, fontWeight: 600,
        boxShadow: '0 8px 32px rgba(0,0,0,0.35)', cursor: (!isLoaded || busy) ? 'default' : 'pointer',
        opacity: (!isLoaded || busy) ? 0.7 : 1,
      },
    },
      React.createElement('img', {
        src: 'https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg',
        alt: '', width: 20, height: 20, style: { display: 'block' },
      }),
      busy ? 'Signing in…' : 'Continue with Google'
    ),
    err && React.createElement('p', {
      style: { margin: 0, color: '#fecaca', fontSize: 13, textAlign: 'center', maxWidth: 340 },
    }, err)
  );
}

// Bridge page for native Google sign-in: the app opens this URL directly in the
// SYSTEM BROWSER (not the WebView) via Browser.open() in nativeAuth.js. Running
// signIn.create() here — inside the same continuous Chrome tab that will also
// receive Google's redirect back to Clerk — keeps Clerk's __client cookie valid
// through the whole handshake. (The earlier approach called signIn.create() from
// the WebView, whose cookie jar Chrome/Custom Tabs never share, so Clerk rejected
// the callback with "authorization_invalid".) Once Clerk's own oauth_callback
// completes, it redirects this same tab straight to our custom URL scheme with a
// rotating_token_nonce — Android intercepts that and hands it back to the app via
// the deep link, where nativeAuth.js finishes with signIn.reload()/setActive().
function NativeGoogleBridge() {
  const { isLoaded, signIn } = useSignIn();
  const [error, setError] = React.useState(null);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (!isLoaded || !signIn || started.current) return;
    started.current = true;
    (async () => {
      try {
        await signIn.create({ strategy: 'oauth_google', redirectUrl: SSO_REDIRECT_URL });
        const url = signIn.firstFactorVerification?.externalVerificationRedirectURL;
        if (!url) throw new Error('Clerk did not return a Google sign-in URL.');
        window.location.href = url.toString();
      } catch (e) {
        setError((e && e.errors && e.errors[0] && e.errors[0].message) || 'Could not start Google sign-in.');
      }
    })();
  }, [isLoaded, signIn]);

  return React.createElement('div', {
    style: {
      position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 12, background: LAWN_BASE,
      color: '#fff', fontFamily: 'inherit', padding: '2rem', textAlign: 'center',
    },
  },
    React.createElement('p', { style: { margin: 0, fontSize: 15 } }, error || 'Connecting to Google…')
  );
}

// Fallback rendered only if Android's App Link interception (see AndroidManifest.xml
// + public/.well-known/assetlinks.json) doesn't fire before this page loads — e.g.
// the OS hasn't finished domain verification yet. Shouldn't normally be seen; the
// deep link (appUrlOpen) is what actually completes the sign-in.
function NativeOAuthCompleteFallback() {
  return React.createElement('div', {
    style: {
      position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 12, background: LAWN_BASE,
      color: '#fff', fontFamily: 'inherit', padding: '2rem', textAlign: 'center',
    },
  },
    React.createElement('p', { style: { margin: 0, fontSize: 15 } }, 'Signed in — you can return to the Croquet OK app now.')
  );
}

function isNativeOAuthCompletePath() {
  try {
    return window.location.pathname === '/native-oauth-complete';
  } catch {
    return false;
  }
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
        width: '100%',
        maxWidth: 440,
        flexShrink: 0,
      }
    },
      isNativePlatform()
        ? React.createElement(React.Fragment, null,
            // Native: our own Google button (system-browser flow) on top, then the
            // full Clerk <SignIn> for email/other methods — with Clerk's own social
            // buttons hidden so there's no broken in-WebView "Continue with Google".
            React.createElement(NativeGoogleSignIn),
            React.createElement('div', { style: { height: 10 } }),
            React.createElement(SignIn, {
              routing: 'hash',
              appearance: {
                elements: {
                  rootBox: { width: '100%' },
                  cardBox: { width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.35)' },
                  socialButtons: { display: 'none' },
                  socialButtonsBlockButton: { display: 'none' },
                  socialButtonsIconButton: { display: 'none' },
                  dividerRow: { display: 'none' },
                },
              },
            })
          )
        : React.createElement(SignIn, {
            routing: 'hash',
            appearance: {
              elements: {
                rootBox: { width: '100%' },
                cardBox: { width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.35)' },
              },
            },
          })
    )
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement(I18nextProvider, { i18n },
  React.createElement(ClerkProvider, { publishableKey: PUBLISHABLE_KEY, afterSignInUrl: '/', afterSignUpUrl: '/' },
    isNativeGoogleBridge()
    ? React.createElement(NativeGoogleBridge)
    : isNativeOAuthCompletePath()
    ? React.createElement(NativeOAuthCompleteFallback)
    : React.createElement(React.Fragment, null,
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
