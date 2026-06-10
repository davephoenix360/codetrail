/**
 * Sign in with GitHub button.
 *
 * Uses Firebase Auth's `signInWithRedirect` with the GitHub provider. Firebase
 * handles the OAuth URL generation, the in-app browser via expo-web-browser,
 * the code-for-token exchange server-side (using the GitHub Client Secret
 * stored in Firebase Console), and the deep-link handoff back to the app.
 */
import { useState } from 'react';
import { Pressable, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { GithubAuthProvider, signInWithRedirect } from 'firebase/auth';
import { auth } from '@/lib/firebase';

const GITHUB_SCOPES = ['read:user', 'user:email', 'public_repo'];

export function SignInWithGitHub() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const provider = new GithubAuthProvider();
      GITHUB_SCOPES.forEach((s) => provider.addScope(s));
      await signInWithRedirect(auth, provider);
      // Note: setLoading(false) intentionally NOT called here on success —
      // the app is being redirected away and will reload after the auth round-trip.
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Sign-in failed';
      console.error('Sign-in error:', e);
      setError(msg);
      setLoading(false);
    }
  };

  return (
    <>
      <Pressable
        onPress={handleSignIn}
        disabled={loading}
        style={[styles.button, loading && styles.buttonDisabled]}
        accessibilityRole="button"
        accessibilityLabel="Sign in with GitHub"
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Sign in with GitHub</Text>
        )}
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#24292e',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 24,
    minWidth: 240,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#cf222e', marginTop: 8, textAlign: 'center', maxWidth: 320 },
});
