/**
 * "Link another GitHub account" button.
 *
 * Handles the OAuth flow for adding a SECONDARY GitHub account to the
 * current user. The difference from sign-in is the `intent=link` flag,
 * which tells the auth callback to write to
 * `users/{currentUid}/linkedAccounts/{newGithubId}` instead of
 * creating a new Firebase user.
 *
 * The OAuth round-trip is the same: open GitHub's authorize URL in
 * WebBrowser, capture the deep link, let processAuthCallback handle
 * the rest. The auth callback sees intent=link and writes the new
 * linked account.
 *
 * After the link succeeds, the caller (Settings) should reload its
 * account list. We do that via the `onLinked` callback.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import {
  AUTH_CONSTANTS,
  generateAndStoreState,
  processAuthCallback,
  setAuthIntent,
} from '@/lib/auth-callback';

WebBrowser.maybeCompleteAuthSession();

const { GITHUB_OAUTH_CLIENT_ID, REDIRECT_URI } = AUTH_CONSTANTS;
const GITHUB_SCOPES = ['read:user', 'user:email', 'public_repo'];

export interface LinkAnotherAccountButtonProps {
  onLinked: () => void;
  onError: (message: string) => void;
}

export function LinkAnotherAccountButton({
  onLinked,
  onError,
}: LinkAnotherAccountButtonProps) {
  const [loading, setLoading] = useState(false);
  const handlerRef = useRef<{ processUrl: (url: string) => Promise<void> } | null>(null);

  // Listen for the deep link so we can dispatch to the in-flight handler
  // (the Linking event fires regardless of how the WebBrowser session ends).
  useEffect(() => {
    const sub = Linking.addEventListener('url', async ({ url }) => {
      if (!url.startsWith(REDIRECT_URI)) return;
      const handler = handlerRef.current;
      if (!handler) return;
      handlerRef.current = null;
      try {
        await WebBrowser.dismissBrowser();
      } catch {
        // Browser may already be closed; safe to ignore.
      }
      await handler.processUrl(url);
    });
    return () => sub.remove();
  }, []);

  async function handleLink() {
    if (loading) return;
    setLoading(true);

    const state = await generateAndStoreState();
    await setAuthIntent('link');

    const authUrl = new URL('https://github.com/login/oauth/authorize');
    authUrl.searchParams.set('client_id', GITHUB_OAUTH_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('scope', GITHUB_SCOPES.join(' '));
    authUrl.searchParams.set('allow_signup', 'true');

    handlerRef.current = {
      processUrl: async (url: string) => {
        const result = await processAuthCallback(url, { setLoading });
        if (result.kind === 'linked') {
          onLinked();
        } else if (result.kind === 'error') {
          onError(result.message);
        }
        // 'newUser' / 'reAuth' shouldn't happen in the link flow. If they
        // do, we treat them as a sign-in completion and the route handler
        // will navigate to /repos (which the user will then come back from).
      },
    };

    let result: Awaited<ReturnType<typeof WebBrowser.openAuthSessionAsync>>;
    try {
      result = await WebBrowser.openAuthSessionAsync(authUrl.toString(), REDIRECT_URI);
    } catch (e) {
      console.warn('[codetrail] link-account WebBrowser threw:', e);
      handlerRef.current = null;
      setLoading(false);
      onError('Could not open the GitHub sign-in page. Try again in a moment.');
      return;
    }

    // If the Linking listener already handled the URL, we're done.
    if (handlerRef.current === null) {
      setLoading(false);
      return;
    }

    if (result.type === 'success' && result.url) {
      const handler = handlerRef.current;
      handlerRef.current = null;
      await handler.processUrl(result.url);
    } else {
      handlerRef.current = null;
      setLoading(false);
    }
  }

  return (
    <Pressable
      onPress={handleLink}
      disabled={loading}
      style={[styles.button, loading && styles.buttonDisabled]}
      accessibilityRole="button"
      accessibilityLabel="Add another GitHub account"
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.buttonText}>+ Add another GitHub account</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#24292f',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
