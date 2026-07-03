/**
 * Notifications settings screen.
 *
 * Lets the user opt in / out of the 4 hype-man notification types.
 * Per the BRIEF, friend activity is OFF by default ("low-noise by
 * default. No FOMO design"). The server-side scheduler (future
 * Cloudflare Worker cron) reads these prefs + the push token to
 * decide what to send and when.
 *
 * Voice: hype-man throughout. The screen frames this as "How should
 * CodeTrail show up in your day?" — not "Configure notifications."
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { getDeviceTimezone, registerForPushNotificationsAsync, persistPushRegistration } from '@/lib/notifications';
import {
  defaultNotificationPrefs,
  getNotificationPrefs,
  updateNotificationPrefs,
  type NotificationPrefs,
} from '@/lib/notification-prefs';

type LoadState = 'loading' | 'ready' | 'saving' | 'error';

export default function NotificationsScreen() {
  const { user, userProfile, reloadProfile } = useAuth();
  const [state, setState] = useState<LoadState>('loading');
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<'unknown' | 'granted' | 'denied'>('unknown');

  // Load prefs on mount.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const timezone = getDeviceTimezone();
        const loaded = await getNotificationPrefs(user.uid, timezone);
        if (cancelled) return;
        setPrefs(loaded);
        setState('ready');
        // Best-effort: surface whether the push permission was already
        // granted. In Expo Go (SDK 53+) the module isn't loadable, so
        // we skip the permission check and report 'unknown' status.
        try {
          const Notifications = require('expo-notifications');
          const { granted } = (await Notifications.getPermissionsAsync()) as unknown as {
            granted: boolean;
          };
          if (!cancelled) setPushStatus(granted ? 'granted' : 'denied');
        } catch {
          if (!cancelled) setPushStatus('unknown');
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not load notification settings.');
        setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Persist a single field change. Optimistic update + revert on error.
  const updatePref = useCallback(
    async <K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) => {
      if (!user || !prefs) return;
      const previous = prefs;
      setPrefs({ ...prefs, [key]: value });
      setState('saving');
      try {
        await updateNotificationPrefs(user.uid, { [key]: value });
        setState('ready');
      } catch (e) {
        // Revert on failure.
        setPrefs(previous);
        setState('ready');
        const message = e instanceof Error ? e.message : 'Could not save your preferences.';
        Alert.alert('Save failed', message);
      }
    },
    [user, prefs],
  );

  // Trigger the system permission prompt. Re-registers the push token
  // once the user grants.
  const requestPushPermission = useCallback(async () => {
    if (!user) return;
    try {
      const token = await registerForPushNotificationsAsync();
      if (token) {
        const timezone = getDeviceTimezone();
        await persistPushRegistration(user.uid, token, timezone);
        await reloadProfile();
        setPushStatus('granted');
      } else {
        setPushStatus('denied');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not enable notifications.';
      Alert.alert('Notifications', message);
    }
  }, [user, reloadProfile]);

  if (state === 'loading' || !prefs) {
    return (
      <ThemedView style={styles.full}>
        <SafeAreaView style={styles.safe}>
          <Header />
          <View style={styles.center}>
            <ActivityIndicator color={Colors.dark.accent} />
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (state === 'error') {
    return (
      <ThemedView style={styles.full}>
        <SafeAreaView style={styles.safe}>
          <Header />
          <View style={[styles.center, styles.errorCard]}>
            <ThemedText type="smallBold" style={styles.errorTitle}>
              Could not load notification settings
            </ThemedText>
            <ThemedText type="small" style={styles.errorBody}>
              {error}
            </ThemedText>
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.full}>
      <SafeAreaView style={styles.safe}>
        <Header />
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Voice: framing — "How should CodeTrail show up in your day?" */}
          <ThemedText type="body" style={styles.intro}>
            How should CodeTrail show up in your day? Toggle what you want to hear.
          </ThemedText>

          {/* Push permission status card. Shown when permission isn't
              granted — gives the user a one-tap "Enable" button. */}
          {pushStatus === 'denied' && (
            <Pressable
              onPress={requestPushPermission}
              accessibilityRole="button"
              style={({ pressed }) => [styles.permissionCard, pressed && styles.pressed]}
            >
              <Ionicons name="notifications-off-outline" size={20} color={Colors.dark.accent} />
              <View style={styles.permissionText}>
                <ThemedText type="bodyBold" style={styles.permissionTitle}>
                  Notifications are turned off
                </ThemedText>
                <ThemedText type="small" style={styles.permissionBody}>
                  Tap to allow CodeTrail to send you reminders.
                </ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.dark.muted} />
            </Pressable>
          )}

          {/* The hype-man notification types */}
          <SectionHeader title="Daily cadence" />
          <PrefRow
            label="Daily check-in"
            description="Friendly nudge if you haven't shipped today. Late enough to still ship before midnight."
            value={prefs.dailyCheckIn}
            onValueChange={(v) => updatePref('dailyCheckIn', v)}
            disabled={prefs.lowNoiseMode}
          />
          <PrefRow
            label="Low-noise mode"
            description="Pause the daily check-in. Milestone celebrations still come through."
            value={prefs.lowNoiseMode}
            onValueChange={(v) => updatePref('lowNoiseMode', v)}
          />

          <SectionHeader title="Milestones" />
          <PrefRow
            label="Streak milestones"
            description="The hype-man celebration when you hit 7, 14, 30, 60, or 100 days."
            value={prefs.streakMilestones}
            onValueChange={(v) => updatePref('streakMilestones', v)}
          />

          <SectionHeader title="When life happens" />
          <PrefRow
            label="Streak broken"
            description={`"Streak's at 0. The next one starts the moment you ship." Always supportive, never guilt-trippy.`}
            value={prefs.streakBroken}
            onValueChange={(v) => updatePref('streakBroken', v)}
            disabled={prefs.lowNoiseMode}
          />
          <PrefRow
            label="Welcome back"
            description={`"Welcome back. Your projects missed you." Sent if you've been away for 7+ days.`}
            value={prefs.welcomeBack}
            onValueChange={(v) => updatePref('welcomeBack', v)}
            disabled={prefs.lowNoiseMode}
          />

          <SectionHeader title="Friends" />
          <PrefRow
            label="Friend activity"
            description='"Tino just shipped X." Off by default — opt in if you want the social layer.'
            value={prefs.friendActivity}
            onValueChange={(v) => updatePref('friendActivity', v)}
            disabled={prefs.lowNoiseMode}
          />

          <ThemedText type="tiny" style={styles.footnote}>
            Timezone: {prefs.timezone} · Check-in: {prefs.checkInTime}
          </ThemedText>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Header() {
  return (
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
        Notifications
      </ThemedText>
      <View style={styles.backBtnSpacer} />
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <ThemedText type="smallBold" style={styles.sectionHeader}>
      {title}
    </ThemedText>
  );
}

function PrefRow({
  label,
  description,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.prefRow, disabled && styles.prefRowDisabled]}>
      <View style={styles.prefText}>
        <ThemedText type="bodyBold" style={styles.prefLabel}>
          {label}
        </ThemedText>
        <ThemedText type="small" style={styles.prefDescription}>
          {description}
        </ThemedText>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: Colors.dark.raised, true: Colors.dark.accent }}
        thumbColor={value ? '#fff' : Colors.dark.muted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1 },
  safe: { flex: 1, padding: Spacing.four },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.five,
  },
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
  pressed: { opacity: 0.6 },
  scroll: { paddingBottom: Spacing.seven },
  intro: { color: Colors.dark.muted, marginBottom: Spacing.four, lineHeight: 20 },
  permissionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.accentSoft,
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.dark.accent,
    padding: Spacing.three,
    gap: Spacing.three,
    marginBottom: Spacing.four,
  },
  permissionText: { flex: 1 },
  permissionTitle: { color: Colors.dark.text },
  permissionBody: { color: Colors.dark.muted, marginTop: 2 },
  sectionHeader: {
    color: Colors.dark.muted,
    marginTop: Spacing.five,
    marginBottom: Spacing.two,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    gap: Spacing.three,
  },
  prefRowDisabled: { opacity: 0.4 },
  prefText: { flex: 1 },
  prefLabel: { color: Colors.dark.text },
  prefDescription: { color: Colors.dark.muted, marginTop: 4, lineHeight: 18 },
  footnote: {
    color: Colors.dark.muted,
    textAlign: 'center',
    marginTop: Spacing.five,
  },
  errorCard: {
    backgroundColor: Colors.dark.dangerSoft,
    borderRadius: Radius.card,
    padding: Spacing.four,
  },
  errorTitle: { color: Colors.dark.text, marginBottom: Spacing.two },
  errorBody: { color: Colors.dark.muted },
});
