/**
 * /friends/add — add a friend by GitHub username.
 *
 * Text input for the username (with or without leading @). On submit:
 *  1. Resolve the GitHub profile (worker /user/lookup) — 404 if no
 *     such user
 *  2. Check if the user is on CodeTrail (public-read usersByLogin)
 *  3. Write the friend doc (users/{uid}/friends/{githubId})
 *  4. Navigate back to /friends
 *
 * Hype-man errors: "We couldn't find @xyz on GitHub." rather than
 * "GitHub returned 404."
 */
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/hooks/use-auth';
import { useFriends, FRIEND_CAP } from '@/hooks/use-friends';
import { resolveFriendByLogin } from '@/lib/firebase-friends';
import { Spacing } from '@/constants/theme';

export default function AddFriendScreen() {
  const { user, userProfile, githubAccessToken } = useAuth();
  const { friends, add } = useFriends(user?.uid ?? null);
  const [login, setLogin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = useCallback(async () => {
    if (!user || !userProfile || !githubAccessToken) {
      setError('You need to be signed in to add a friend.');
      return;
    }
    const cleanLogin = login.trim().replace(/^@/, '');
    if (!cleanLogin) {
      setError('Type a GitHub username first.');
      return;
    }
    if (friends.length >= FRIEND_CAP) {
      setError(`You can follow up to ${FRIEND_CAP} friends. Remove one to add another.`);
      return;
    }
    // Already following?
    if (friends.some((f) => f.login.toLowerCase() === cleanLogin.toLowerCase())) {
      setError(`You're already following @${cleanLogin}.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const resolved = await resolveFriendByLogin(githubAccessToken, cleanLogin);
      await add(resolved);
      // Brief success then back. Could use a toast in v2.0.
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not add friend. Try again.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }, [user, userProfile, githubAccessToken, login, friends, add]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Add a friend',
          headerShown: true,
          headerStyle: { backgroundColor: '#0d1117' },
          headerTitleStyle: { color: '#e6edf3' },
          headerTintColor: '#e6edf3',
        }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kav}
      >
        <View style={styles.body}>
          <ThemedText type="default" style={styles.label}>
            GitHub username
          </ThemedText>
          <TextInput
            value={login}
            onChangeText={setLogin}
            placeholder="@diepreyecd"
            placeholderTextColor="#484f58"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            keyboardType="ascii-capable"
            returnKeyType="go"
            onSubmitEditing={handleAdd}
            style={styles.input}
            editable={!submitting}
            accessibilityLabel="GitHub username"
          />
          <ThemedText type="small" style={styles.hint}>
            We'll show their recent ships on your /repos feed. They don't need to be on CodeTrail yet.
          </ThemedText>

          {error ? (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              onPress={() => router.back()}
              disabled={submitting}
              style={({ pressed }) => [
                styles.btn,
                styles.btnSecondary,
                pressed && styles.btnPressed,
                submitting && styles.btnDisabled,
              ]}
            >
              <ThemedText type="default" style={styles.btnSecondaryLabel}>
                Cancel
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={handleAdd}
              disabled={submitting || !login.trim()}
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                pressed && styles.btnPressed,
                (submitting || !login.trim()) && styles.btnDisabled,
              ]}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText type="default" style={styles.btnPrimaryLabel}>
                  Add
                </ThemedText>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
  },
  kav: {
    flex: 1,
  },
  body: {
    flex: 1,
    padding: Spacing.four,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: Spacing.two,
  },
  input: {
    backgroundColor: '#161b22',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#30363d',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    color: '#e6edf3',
    fontSize: 16,
  },
  hint: {
    color: '#8b949e',
    marginTop: Spacing.two,
  },
  error: {
    color: '#f85149',
    marginTop: Spacing.three,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginTop: 'auto',
    paddingTop: Spacing.four,
  },
  btn: {
    flex: 1,
    paddingVertical: Spacing.three,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnPrimary: {
    backgroundColor: '#208AEF',
  },
  btnPrimaryLabel: {
    color: '#fff',
    fontWeight: '600',
  },
  btnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#30363d',
  },
  btnSecondaryLabel: {
    color: '#e6edf3',
    fontWeight: '600',
  },
  btnPressed: {
    opacity: 0.7,
  },
  btnDisabled: {
    opacity: 0.4,
  },
});
