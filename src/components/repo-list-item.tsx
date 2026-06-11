/**
 * RepoListItem — a single row in a list of GitHub repos.
 *
 * Shows: language color dot, repo name, description (1 line, ellipsized),
 * language name, star count, and a Switch for tracking.
 *
 * Hype-man microcopy on the Switch: instead of generic "On/Off", we show
 * "Tracking" / "Tap to track" so the action language stays encouraging.
 */
import { StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { Spacing } from '@/constants/theme';

// Hand-picked subset of GitHub's language colors. Covers ~80% of repos we'd
// see; for unknowns we fall back to a neutral gray. Don't over-engineer
// this — the language color is decorative, not load-bearing.
const LANG_COLOR: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Java: '#b07219',
  Kotlin: '#A97BFF',
  Swift: '#F05138',
  Go: '#00ADD8',
  Rust: '#dea584',
  C: '#555555',
  'C++': '#f34b7d',
  'C#': '#178600',
  Ruby: '#701516',
  PHP: '#4F5D95',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Shell: '#89e051',
  Dart: '#00B4AB',
  Lua: '#000080',
  Scala: '#c22d40',
  Elixir: '#6e4a7e',
  Haskell: '#5e5086',
};

const NEUTRAL_DOT = '#94a3b8';

function langColor(lang: string | null): string {
  if (!lang) return NEUTRAL_DOT;
  return LANG_COLOR[lang] ?? NEUTRAL_DOT;
}

export interface RepoListItemProps {
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number;
  tracked: boolean;
  onToggle: () => void;
}

export function RepoListItem({
  name,
  fullName,
  description,
  language,
  stars,
  tracked,
  onToggle,
}: RepoListItemProps) {
  return (
    <ThemedView style={styles.row}>
      <View style={styles.left}>
        <View style={[styles.dot, { backgroundColor: langColor(language) }]} />
      </View>
      <View style={styles.middle}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {name}
        </ThemedText>
        {description ? (
          <ThemedText
            type="small"
            style={styles.muted}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {description}
          </ThemedText>
        ) : null}
        <ThemedText type="small" style={styles.muted}>
          {language ?? '—'} · ⭐ {stars}
        </ThemedText>
      </View>
      <View style={styles.right}>
        <Switch
          value={tracked}
          onValueChange={onToggle}
          accessibilityLabel={`${tracked ? 'Untrack' : 'Track'} ${fullName}`}
        />
        <ThemedText type="small" style={styles.toggleLabel}>
          {tracked ? 'Tracking' : 'Track'}
        </ThemedText>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  left: {
    width: 16,
    alignItems: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  middle: {
    flex: 1,
    gap: 2,
  },
  right: {
    alignItems: 'center',
    minWidth: 76,
  },
  muted: {
    opacity: 0.65,
  },
  toggleLabel: {
    marginTop: 2,
    opacity: 0.7,
  },
});
