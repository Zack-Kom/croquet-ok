// Native (Capacitor) Google OAuth for the Android app.
//
// Why this exists: the app runs as a Capacitor WebView that loads the live site
// (server.url = https://croquetok.com). Google deliberately blocks OAuth inside
// embedded WebViews, so the normal Clerk <SignIn> "Continue with Google" button
// fails there with `authorization_invalid`. Running the OAuth handshake in the
// system browser (Chrome Custom Tab) fixes the WebView-block problem, but a first
// attempt still failed: calling signIn.create() from the WebView sets Clerk's
// `__client` cookie in the WebView's OWN cookie jar, which Chrome/Custom Tabs never
// share (separate storage, same as any two unrelated browsers) — so when Google's
// redirect lands back at clerk.croquetok.com/v1/oauth_callback inside the Custom
// Tab, Clerk has no cookie to correlate it against and rejects with
// `authorization_invalid`. On a normal desktop/mobile BROWSER this never comes up
// because the whole flow — create → Google → callback — happens in one continuous
// tab/cookie-jar the whole way.
//
// Fix: run signIn.create() itself inside the system browser too, on a dedicated
// "bridge" page (see NativeGoogleBridge in main.jsx) that the app opens directly via
// Browser.open(). That keeps the __client cookie valid all the way through Clerk's
// callback, exactly like a normal browser sign-in. Only the very last hop crosses
// back into the WebView: Clerk's callback redirects the SAME Chrome tab straight to
// our custom URL scheme with a one-time `rotating_token_nonce`, Android's deep-link
// intent-filter routes that back into MainActivity, and this file's `appUrlOpen`
// listener finishes the handoff into the WebView's own Clerk client.
//
// Flow:
//   1. Open the bridge URL (croquetok.com?native_google_bridge=1) in the system
//      browser via @capacitor/browser. That page's own JS calls signIn.create() and
//      navigates itself to Google — all within that one Chrome tab.
//   2. Google → Clerk redirects that same tab to
//      au.okinnovations.croquetok://sso-callback?...nonce. Android routes the custom
//      scheme back into MainActivity; @capacitor/app fires 'appUrlOpen'.
//   3. signIn.reload({ rotatingTokenNonce }) (in the WebView's Clerk client) pulls
//      the now-completed sign-in by nonce — this is the one cross-context handoff
//      the mechanism is actually designed for; then setActive({ session:
//      createdSessionId }) activates it and <SignedIn> renders.
//
// Everything here is gated by isNativePlatform() at the call site, so the web build
// keeps using Clerk's prebuilt <SignIn> and never touches this path.

import { Capacitor } from '@capacitor/core';

export const SSO_REDIRECT_URL = 'au.okinnovations.croquetok://sso-callback';
const BRIDGE_URL = 'https://croquetok.com/?native_google_bridge=1';

export function isNativePlatform() {
  try {
    return Capacitor && typeof Capacitor.isNativePlatform === 'function'
      ? Capacitor.isNativePlatform()
      : false;
  } catch {
    return false;
  }
}

// True when this page load IS the native-Google bridge tab itself (opened by
// signInWithGoogleNative below, running in the system browser, not the WebView).
export function isNativeGoogleBridge() {
  try {
    return new URLSearchParams(window.location.search).get('native_google_bridge') === '1';
  } catch {
    return false;
  }
}

// Runs the full external-browser Google OAuth handshake by opening the bridge page
// (see module comment above). `signIn` and `setActive` come from the WebView's own
// Clerk useSignIn() — used only for the final reload()/setActive() handoff, never to
// create the sign-in itself. Resolves once the session is active; rejects with a
// descriptive Error otherwise. The caller shows any error to the user.
export async function signInWithGoogleNative(signIn, setActive) {
  const { Browser } = await import('@capacitor/browser');
  const { App } = await import('@capacitor/app');

  return new Promise((resolve, reject) => {
    let listener;
    let settled = false;

    const finish = async (err, value) => {
      if (settled) return;
      settled = true;
      try { if (listener) await listener.remove(); } catch { /* ignore */ }
      try { await Browser.close(); } catch { /* ignore — tab may already be gone */ }
      if (err) reject(err); else resolve(value);
    };

    App.addListener('appUrlOpen', async ({ url }) => {
      if (!url || url.indexOf(SSO_REDIRECT_URL) !== 0) return; // not our callback
      try {
        const nonce = new URL(url).searchParams.get('rotating_token_nonce');
        const res = await signIn.reload(nonce ? { rotatingTokenNonce: nonce } : undefined);
        if (res.status === 'complete' && res.createdSessionId) {
          await setActive({ session: res.createdSessionId });
          await finish(null, 'complete');
        } else {
          await finish(new Error('Google sign-in did not complete (status: ' + res.status + ').'));
        }
      } catch (e) {
        await finish(e instanceof Error ? e : new Error(String(e)));
      }
    }).then((h) => { listener = h; })
      .catch((e) => finish(e instanceof Error ? e : new Error(String(e))));

    Browser.open({ url: BRIDGE_URL }).catch((e) => {
      finish(e instanceof Error ? e : new Error(String(e)));
    });
  });
}
