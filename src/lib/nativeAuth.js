// Native (Capacitor) Google sign-in for the Android app.
//
// Why this exists: the app runs as a Capacitor WebView loading the live site
// (server.url = https://croquetok.com). Clerk's normal "Continue with Google" button
// relies on a browser REDIRECT flow (Clerk -> Google -> Clerk), which only works
// inside one continuous browser tab/cookie-jar. Google blocks that flow inside
// embedded WebViews outright, and three different attempts at bridging it through
// the system browser (Chrome Custom Tab) all hit the same wall from different
// angles: Clerk's web SDK (signIn.create(), used by <SignIn>) only implements the
// single-browser-tab redirect flow. Its "Native applications" nonce-handoff
// mechanism belongs to Clerk's separate Native API (used by @clerk/clerk-expo etc.),
// which clerk-react never calls no matter how the browser context is split.
//
// Real fix: skip Clerk's OAuth redirect flow entirely. Use Android's own native
// Google Sign-In (a system account-picker dialog, not a browser at all —
// @capawesome/capacitor-google-sign-in, backed by Android's Credential Manager API)
// to get a Google ID token directly, then hand that token straight to Clerk via
// clerk.authenticateWithGoogleOneTap({ token }) — a plain API call that runs
// entirely inside the WebView's own JS context. No browser redirect, no separate
// cookie jar, no cross-context handoff of any kind.
//
// Setup this depends on: GoogleSignIn.initialize() takes the WEB OAuth client ID
// (not an Android-specific one) — this must be the exact client ID configured on
// Clerk's Google SSO connection (Clerk dashboard -> User & authentication -> SSO
// connections -> Google -> Client ID), so the token's audience matches what Clerk
// validates against. Additionally, Google Cloud Console needs a registered Android
// OAuth client (in the SAME project as that web client) for this app's package name
// + signing certificate SHA-1 — one for the debug keystore, one for the release
// keystore — before the native picker will authorize this app at all.
//
// Everything here is gated by isNativePlatform() at the call site, so the web build
// keeps using Clerk's prebuilt <SignIn> and never touches this path.

import { Capacitor } from '@capacitor/core';

// Clerk's configured Google SSO connection client ID (dashboard -> SSO connections ->
// Google -> Client ID). Must stay in sync with that value.
const GOOGLE_WEB_CLIENT_ID = '470748927930-422dcv0oonnhoi2prdhq0sgok6eht997.apps.googleusercontent.com';

let initialized = false;

export function isNativePlatform() {
  try {
    return Capacitor && typeof Capacitor.isNativePlatform === 'function'
      ? Capacitor.isNativePlatform()
      : false;
  } catch {
    return false;
  }
}

// Runs the native Google sign-in + Clerk token exchange. `clerk` is the Clerk
// instance from useClerk(). Resolves once the session is active; rejects with a
// descriptive Error otherwise (including a plain cancel, so the caller can decide
// whether to surface it).
export async function signInWithGoogleNative(clerk) {
  const { GoogleSignIn } = await import('@capawesome/capacitor-google-sign-in');

  if (!initialized) {
    await GoogleSignIn.initialize({ clientId: GOOGLE_WEB_CLIENT_ID });
    initialized = true;
  }

  const { idToken } = await GoogleSignIn.signIn();
  if (!idToken) throw new Error('Google did not return an ID token.');

  const res = await clerk.authenticateWithGoogleOneTap({ token: idToken });
  await clerk.handleGoogleOneTapCallback(res, {
    signInFallbackRedirectUrl: '/',
    signUpFallbackRedirectUrl: '/',
  });
}
