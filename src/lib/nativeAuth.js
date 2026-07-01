// Native (Capacitor) Google OAuth for the Android app.
//
// Why this exists: the app runs as a Capacitor WebView that loads the live site
// (server.url = https://croquetok.com). Google deliberately blocks OAuth inside
// embedded WebViews, so the normal Clerk <SignIn> "Continue with Google" button
// fails there with `authorization_invalid`. The fix is to run the OAuth handshake
// in the SYSTEM browser (Chrome Custom Tab) and hand the result back to the WebView
// via a deep link carrying a one-time `rotating_token_nonce`, which Clerk uses to
// sync the session into the WebView's own client.
//
// Flow:
//   1. signIn.create({ strategy: 'oauth_google', redirectUrl }) → Clerk returns an
//      externalVerificationRedirectURL (Clerk → Google).
//   2. Open that URL in the system browser via @capacitor/browser.
//   3. Google → Clerk redirects to au.okinnovations.croquetok://sso-callback?...nonce.
//      Android routes that custom scheme back into MainActivity; @capacitor/app fires
//      'appUrlOpen'.
//   4. signIn.reload({ rotatingTokenNonce }) pulls the completed sign-in; then
//      setActive({ session: createdSessionId }) activates it and <SignedIn> renders.
//
// Everything here is gated by isNativePlatform() at the call site, so the web build
// keeps using Clerk's prebuilt <SignIn> and never touches this path.

import { Capacitor } from '@capacitor/core';

export const SSO_REDIRECT_URL = 'au.okinnovations.croquetok://sso-callback';

export function isNativePlatform() {
  try {
    return Capacitor && typeof Capacitor.isNativePlatform === 'function'
      ? Capacitor.isNativePlatform()
      : false;
  } catch {
    return false;
  }
}

// Runs the full external-browser Google OAuth handshake. `signIn` and `setActive`
// come from Clerk's useSignIn(). Resolves once the session is active; rejects with a
// descriptive Error otherwise. The caller shows any error to the user.
export async function signInWithGoogleNative(signIn, setActive) {
  const { Browser } = await import('@capacitor/browser');
  const { App } = await import('@capacitor/app');

  // Kick off the OAuth sign-in and get Clerk's hand-off URL to the provider.
  await signIn.create({ strategy: 'oauth_google', redirectUrl: SSO_REDIRECT_URL });
  const externalUrl = signIn.firstFactorVerification?.externalVerificationRedirectURL;
  if (!externalUrl) {
    throw new Error('Clerk did not return an OAuth redirect URL. Is Google enabled and the redirect URL allow-listed?');
  }

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

    Browser.open({ url: externalUrl.toString() }).catch((e) => {
      finish(e instanceof Error ? e : new Error(String(e)));
    });
  });
}
