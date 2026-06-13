/**
 * CodeTrail home/landing screen.
 *
 * - Signed out: shows the sign-in view.
 * - Signed in: redirects to /repos (the main authenticated screen).
 *
 * The redirect happens in a useEffect to avoid React's "cannot update
 * another component during render" warning.
 */
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { useAuth } from '@/hooks/use-auth';
import { SignInWithGitHub } from '@/components/sign-in-with-github';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Radius, Spacing } from '@/constants/theme';

export default function HomeScreen() {
  const { user, loading, isSignedIn } = useAuth();

  // If signed in, send them to /repos.
  useEffect(() => {
    if (!loading && isSignedIn) {
      router.replace('/repos');
    }
  }, [loading, isSignedIn]);

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator size="large" color={Colors.dark.accent} />
      </ThemedView>
    );
  }

  if (isSignedIn) {
    // Redirect is in flight; show a brief placeholder.
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator size="large" color={Colors.dark.accent} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <ThemedText type="display" style={styles.heading}>
            🔥
          </ThemedText>
          <ThemedText type="h1" style={styles.title}>
            CodeTrail
          </ThemedText>
          <ThemedText type="bodyBold" style={styles.tagline}>
            The hype-man for your coding projects.
          </ThemedText>
          <ThemedText type="small" style={styles.muted}>
            Sign in with GitHub to start tracking your streak. No judgment, just momentum.
          </ThemedText>
          <SignInWithGitHub />
          {user ? (
            // Theoretically unreachable — the redirect above catches signed-in users.
            // Kept as a safety net for the in-between moment.
            <Pressable
              onPress={() => router.replace('/repos')}
              style={styles.fallback}
            >
              <ThemedText type="link" style={styles.fallbackLabel}>
                Go to your projects →
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.five,
  },
  content: {
    alignItems: 'center',
    gap: Spacing.three,
    maxWidth: 360,
  },
  heading: {
    textAlign: 'center',
    fontSize: 64,
    lineHeight: 72,
    // Soft glow on the flame
    textShadowColor: 'rgba(247, 129, 102, 0.35)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  title: { textAlign: 'center', letterSpacing: -0.4 },
  tagline: { textAlign: 'center' },
  muted: {
    textAlign: 'center',
    color: Colors.dark.muted,
    marginTop: Spacing.one,
    marginBottom: Spacing.four,
  },
  fallback: { marginTop: Spacing.four },
  fallbackLabel: { color: Colors.dark.accent },
});
