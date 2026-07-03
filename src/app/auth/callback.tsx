/**
 * Auth callback route.
 *
 * Mounted when the app is opened (or navigated to) via the deep link
 * `exp://<host>:<port>/--/auth/callback?code=X&state=Y` — i.e., GitHub's
 * 302 redirect after a successful OAuth authorization.
 *
 * This is the "cold start" path. The "in-flight" path (where the app
 * was already in the foreground when the WebBrowser session completed)
 * is handled by the Linking event listener in
 * components/sign-in-with-github.tsx. Both paths call
 * `processAuthCallback`, which dedupes via a module-level set.
 *
 * After processing, we navigate based on the result kind:
 *   - newUser / returning: → /repos (the main app)
 *   - error:               → / (sign-in screen) and surface the error message
 */
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { processAuthCallback, APP_DEEP_LINK } from '@/lib/auth-callback';

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
      // The deep link we land on is `codetrail://auth/callback?code=...&state=...`
      // (the Worker's /callback route already 302-redirects to this URL).
      const search = new URLSearchParams();
      if (params.code) search.set('code', String(params.code));
      if (params.state) search.set('state', String(params.state));
      if (params.error) search.set('error', String(params.error));
      if (params.error_description) search.set('error_description', String(params.error_description));
      const fullUrl = `${APP_DEEP_LINK}?${search.toString()}`;

      const result = await processAuthCallback(fullUrl);

      if (__DEV__) {
        console.log('[auth/callback] result:', result.kind, result);
      }

      switch (result.kind) {
        case 'newUser':
        case 'returning':
          router.replace('/repos');
          return;
        case 'error':
          // Surface the error to the user — silent bounces are debug hell.
          // We navigate home after, but the Alert blocks until dismissed so
          // the user can actually read what went wrong.
          console.warn('[auth/callback] error:', result.message);
          Alert.alert(
            'Sign-in could not complete',
            result.message,
            [{ text: 'OK', onPress: () => router.replace('/') }],
            { cancelable: false },
          );
          return;
      }
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
