/**
 * Settings → Linked GitHub accounts.
 *
 * Shows the list of GitHub accounts linked to the current CodeTrail user.
 * Lets the user:
 *   - Add a new GitHub account (via the LinkAnotherAccountButton)
 *   - Set a non-primary account as primary
 *   - Unlink a non-primary account
 *
 * Hype-man voice throughout: every action prompt, every error, every
 * empty state. See BRIEF.md §"Voice & tone" for the full checklist.
 */
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LinkAnotherAccountButton } from '@/components/link-github-account-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/hooks/use-auth';
import { setPrimaryAccount, unlinkGithubAccount } from '@/lib/firebase-accounts';
import type { LinkedAccount } from '@/lib/account-types';
import { Spacing } from '@/constants/theme';

export default function AccountsSettingsScreen() {
  const {
    user,
    linkedAccounts,
    primaryAccount,
    activeAccount,
    accountsLoaded,
    reloadAccounts,
  } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Pull-to-refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reloadAccounts();
    } finally {
      setRefreshing(false);
    }
  }, [reloadAccounts]);

  // Set a non-primary account as primary
  const handleSetPrimary = useCallback(
    async (account: LinkedAccount) => {
      if (!user || !primaryAccount) return;
      if (account.isPrimary) return;
      setBusy(true);
      try {
        await setPrimaryAccount(user.uid, account.githubId, primaryAccount.githubId);
        await reloadAccounts();
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not change the primary account.';
        Alert.alert('Hmm, that did not work.', msg, [{ text: 'OK' }]);
      } finally {
        setBusy(false);
      }
    },
    [user, primaryAccount, reloadAccounts],
  );

  // Unlink a non-primary account
  const handleUnlink = useCallback(
    (account: LinkedAccount) => {
      if (!user) return;
      if (account.isPrimary) return; // primary can't be unlinked
      if (linkedAccounts.length <= 1) {
        Alert.alert(
          'You need at least one',
          'This is your only GitHub account. Add another one before unlinking this.',
          [{ text: 'OK' }],
        );
        return;
      }
      Alert.alert(
        'Unlink this account?',
        `Your @${account.login} commits will no longer count toward your CodeTrail stats. You can link it back any time.`,
        [
          { text: 'Keep it', style: 'cancel' },
          {
            text: 'Unlink',
            style: 'destructive',
            onPress: async () => {
              setBusy(true);
              try {
                await unlinkGithubAccount(user.uid, account.githubId, account.isPrimary);
                await reloadAccounts();
              } catch (e) {
                const msg = e instanceof Error ? e.message : 'Could not unlink that account.';
                Alert.alert('Hmm, that did not work.', msg, [{ text: 'OK' }]);
              } finally {
                setBusy(false);
              }
            },
          },
        ],
      );
    },
    [user, linkedAccounts, reloadAccounts],
  );

  if (!user) {
    return (
      <ThemedView style={styles.full}>
        <SafeAreaView style={styles.safe}>
          <ThemedText>Sign in to manage your linked accounts.</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (!accountsLoaded) {
    return (
      <ThemedView style={styles.full}>
        <SafeAreaView style={styles.safe}>
          <ActivityIndicator />
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.full}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Linked accounts</ThemedText>
          <ThemedText type="small" style={styles.muted}>
            All the GitHub accounts that count toward your CodeTrail stats.
          </ThemedText>
        </View>

        {linkedAccounts.length === 0 ? (
          <View style={styles.empty}>
            <ThemedText type="smallBold">No accounts linked yet</ThemedText>
            <ThemedText type="small" style={[styles.muted, styles.spacedTop]}>
              This should not happen — your sign-in should have created at least one.
            </ThemedText>
          </View>
        ) : (
          <FlatList
            data={linkedAccounts}
            keyExtractor={(a) => String(a.githubId)}
            renderItem={({ item }) => (
              <AccountRow
                account={item}
                isActive={item.githubId === activeAccount?.githubId}
                onSetPrimary={() => handleSetPrimary(item)}
                onUnlink={() => handleUnlink(item)}
                busy={busy}
              />
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
            }
            contentContainerStyle={styles.listContent}
          />
        )}

        <View style={[styles.footer, linkedAccounts.length > 0 && styles.footerSpaced]}>
          <LinkAnotherAccountButton
            onLinked={async () => {
              await reloadAccounts();
            }}
            onError={(message) => {
              Alert.alert('Could not link that one', message, [{ text: 'OK' }]);
            }}
          />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AccountRow({
  account,
  isActive,
  onSetPrimary,
  onUnlink,
  busy,
}: {
  account: LinkedAccount;
  isActive: boolean;
  onSetPrimary: () => void;
  onUnlink: () => void;
  busy: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <ThemedText type="smallBold">@{account.login}</ThemedText>
        <View style={styles.badges}>
          {account.isPrimary ? <Badge text="Primary" /> : null}
          {isActive && !account.isPrimary ? <Badge text="Active" /> : null}
        </View>
      </View>
      <View style={styles.rowActions}>
        {!account.isPrimary ? (
          <Pressable
            onPress={onSetPrimary}
            disabled={busy}
            style={styles.actionButton}
            accessibilityRole="button"
            accessibilityLabel={`Set @${account.login} as primary`}
          >
            <ThemedText type="small">Set as primary</ThemedText>
          </Pressable>
        ) : null}
        {!account.isPrimary ? (
          <Pressable
            onPress={onUnlink}
            disabled={busy}
            style={styles.actionButton}
            accessibilityRole="button"
            accessibilityLabel={`Unlink @${account.login}`}
          >
            <ThemedText type="small" style={styles.destructive}>
              Unlink
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function Badge({ text }: { text: string }) {
  return (
    <View style={styles.badge}>
      <ThemedText type="small" style={styles.badgeText}>
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1 },
  safe: { flex: 1, padding: Spacing.four },
  header: { gap: Spacing.one, marginBottom: Spacing.three },
  muted: { opacity: 0.7 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.five,
    gap: Spacing.two,
  },
  spacedTop: { marginTop: Spacing.two },
  row: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    gap: Spacing.two,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  badges: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  badge: {
    backgroundColor: '#3c87f7',
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: 8,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  rowActions: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginTop: Spacing.two,
  },
  actionButton: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  destructive: {
    color: '#d73a49',
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  listContent: {
    paddingBottom: Spacing.three,
  },
  footer: {
    paddingTop: Spacing.four,
  },
  footerSpaced: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
});
