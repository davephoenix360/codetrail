/**
 * Settings → Linked accounts (stub — full UI in Phase 2.5 task 47)
 */
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function AccountsSettingsScreen() {
  return (
    <ThemedView style={styles.full}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <ThemedText type="subtitle">Linked accounts</ThemedText>
          <ThemedText type="small" style={styles.muted}>
            Coming soon. (Phase 2.5 task 47 builds the real screen.)
          </ThemedText>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1 },
  safe: { flex: 1, padding: Spacing.four },
  content: { gap: Spacing.two },
  muted: { opacity: 0.7 },
});
