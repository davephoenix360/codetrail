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
import { Spacing } from '@/constants/theme';

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
        <ActivityIndicator size="large" />
      </ThemedView>
    );
  }

  if (isSignedIn) {
    // Redirect is in flight; show a brief placeholder.
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator size="large" />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <ThemedText type="title" style={styles.heading}>
            CodeTrail
          </ThemedText>
          <ThemedText style={styles.tagline}>
            The hype-man for your coding projects.
          </ThemedText>
          <ThemedText style={styles.muted}>
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
              <ThemedText type="link">Go to your projects →</ThemedText>
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
  },
  tagline: {
    fontSize: 18,
    textAlign: 'center',
    fontWeight: '500',
  },
  muted: {
    textAlign: 'center',
    opacity: 0.7,
    marginTop: Spacing.one,
  },
  fallback: {
    marginTop: Spacing.four,
  },
});
