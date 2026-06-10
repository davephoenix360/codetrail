/**
 * CodeTrail home screen.
 *
 * Shows a sign-in button when signed out, the user's name/email when signed in.
 * Built on the hype-man voice: encouraging, never guilt-trippy.
 */
import { StyleSheet, View, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/hooks/use-auth';
import { SignInWithGitHub } from '@/components/sign-in-with-github';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function HomeScreen() {
  const { user, loading, isSignedIn, signOut } = useAuth();

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator size="large" />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {isSignedIn ? (
          <View style={styles.content}>
            <ThemedText type="title" style={styles.heading}>
              You shipped.
            </ThemedText>
            <ThemedText style={styles.muted}>
              Hi, {user?.displayName || user?.email}. Time to pick a repo to track.
            </ThemedText>
            <Pressable
              onPress={signOut}
              style={styles.signOutButton}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
            >
              <ThemedText style={styles.signOutText}>Sign out</ThemedText>
            </Pressable>
          </View>
        ) : (
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
          </View>
        )}
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
    padding: 24,
  },
  content: {
    alignItems: 'center',
    gap: 12,
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
    marginTop: 4,
  },
  signOutButton: {
    marginTop: 32,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  signOutText: {
    opacity: 0.5,
    fontSize: 14,
  },
});
