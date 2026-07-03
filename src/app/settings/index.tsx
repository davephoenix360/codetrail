/**
 * Settings hub.
 *
 * For MVP, this is a simple list of links to the various settings
 * sub-screens. Lives at /settings — accessible from the gear icon in
 * the /repos header.
 *
 * Voice: hype-man throughout. No "Configure" or "Manage" — just the
 * friendly action ("Notifications", "Sign out", "About").
 */
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';

interface SettingsLink {
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}

export default function SettingsScreen() {
  const { signOut } = useAuth();

  const links: SettingsLink[] = [
    {
      label: 'Notifications',
      description: 'Daily check-ins, milestone hype, and welcome-backs.',
      icon: 'notifications-outline',
      onPress: () => router.push('/settings/notifications'),
    },
    // Future sub-screens: Account, Help, About
  ];

  return (
    <ThemedView style={styles.full}>
      <SafeAreaView style={styles.safe}>
        {/* Header — back button + title */}
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={22} color={Colors.dark.text} />
          </Pressable>
          <ThemedText type="h1" style={styles.title}>
            Settings
          </ThemedText>
          <View style={styles.backBtnSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          {links.map((link) => (
            <Pressable
              key={link.label}
              onPress={link.onPress}
              accessibilityRole="button"
              accessibilityLabel={link.label}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={styles.rowIcon}>
                <Ionicons name={link.icon} size={20} color={Colors.dark.accent} />
              </View>
              <View style={styles.rowText}>
                <ThemedText type="bodyBold" style={styles.rowLabel}>
                  {link.label}
                </ThemedText>
                <ThemedText type="small" style={styles.rowDescription}>
                  {link.description}
                </ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.dark.muted} />
            </Pressable>
          ))}

          <Pressable
            onPress={signOut}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}
          >
            <ThemedText type="bodyBold" style={styles.signOutLabel}>
              Sign out
            </ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1 },
  safe: { flex: 1, padding: Spacing.four },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.five,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.chip,
    backgroundColor: Colors.dark.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnSpacer: { width: 40 },
  title: { color: Colors.dark.text, letterSpacing: -0.4 },
  scroll: { paddingBottom: Spacing.seven },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Radius.card,
    backgroundColor: Colors.dark.raised,
    marginBottom: Spacing.two,
    gap: Spacing.three,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.chip,
    backgroundColor: Colors.dark.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowLabel: { color: Colors.dark.text },
  rowDescription: { color: Colors.dark.muted, marginTop: 2 },
  pressed: { opacity: 0.6 },
  signOut: {
    paddingVertical: Spacing.three,
    alignItems: 'center',
    borderRadius: Radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.dark.border,
    marginTop: Spacing.five,
  },
  signOutLabel: { color: Colors.dark.muted },
});
