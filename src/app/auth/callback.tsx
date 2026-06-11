/**
 * Auth callback route.
 *
 * Mounted when the app is opened (or navigated to) via the deep link
 * `exp://<host>:<port>/--/auth/callback?code=X&state=Y` — i.e., GitHub's
 * 302 redirect after a successful OAuth authorization.
 *
 * This is the "cold start" path:
 *   - User taps "Sign in with GitHub" in the app
 *   - WebBrowser opens the GitHub authorize URL
 *   - User authorizes on GitHub
 *   - GitHub 302s to exp://...?code=X&state=Y
 *   - OS dispatches the deep link to Expo Go
 *   - Expo Go opens the app at this route
 *
 * The "in-flight" path (where the app was already in the foreground when
 * the WebBrowser session completed) is handled by the Linking event
 * listener in components/sign-in-with-github.tsx. Both paths call
 * `processAuthCallback`, which dedupes via a module-level set so the URL
 * is only processed once.
 */
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { processAuthCallback, REDIRECT_URI } from '@/lib/auth-callback';

export default function AuthCallbackRoute() {
  const params = useLocalSearchParams<{
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
  }>();
  const router = useRouter();
  const hasProcessedRef = useRef(false);

  useEffect(() => {
    if (hasProcessedRef.current) return;
    hasProcessedRef.current = true;

    (async () => {
      // Reconstruct the full URL that processAuthCallback expects.
      // useLocalSearchParams strips the host/scheme, so we add them back.
      const search = new URLSearchParams();
      if (params.code) search.set('code', String(params.code));
      if (params.state) search.set('state', String(params.state));
      if (params.error) search.set('error', String(params.error));
      if (params.error_description) search.set('error_description', String(params.error_description));
      const fullUrl = `${REDIRECT_URI.split('?')[0]}?${search.toString()}`;

      if (params.error) {
        // GitHub returned an error (user denied, bad scope, etc.)
        // The auth-callback module will console.warn this; we just navigate home.
        await processAuthCallback(fullUrl);
        router.replace('/');
        return;
      }

      if (!params.code) {
        // No code in URL — probably user opened the route directly.
        // Don't call processAuthCallback (it would warn about no code).
        router.replace('/');
        return;
      }

      await processAuthCallback(fullUrl);
      // Whether sign-in succeeded or failed, head home. useAuth's
      // onAuthStateChanged will show the right UI for each case.
      router.replace('/');
    })();
  }, [params, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color="#208AEF" size="large" />
      <Text style={styles.text}>Completing sign-in…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  text: {
    color: '#8b949e',
    marginTop: 16,
    fontSize: 15,
  },
});
