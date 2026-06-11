/**
 * ThemedText — auto-themed text using react-native's built-in useColorScheme.
 * Supports a `type` variant for our heading hierarchy and optional
 * `lightColor` / `darkColor` overrides.
 */
import { Platform, StyleSheet, Text, type TextProps, useColorScheme } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  lightColor?: string;
  darkColor?: string;
};

export function ThemedText({ style, type = 'default', lightColor, darkColor, ...rest }: ThemedTextProps) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const color = (isDark ? darkColor : lightColor) ?? colors.text;

  return (
    <Text
      style={[
        { color },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  small: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  smallBold: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  default: { fontSize: 16, lineHeight: 24, fontWeight: '500' },
  title: { fontSize: 48, fontWeight: '600', lineHeight: 52 },
  subtitle: { fontSize: 32, lineHeight: 44, fontWeight: '600' },
  link: { lineHeight: 30, fontSize: 14 },
  linkPrimary: { lineHeight: 30, fontSize: 14, color: '#3c87f7' },
  code: {
    fontFamily: Fonts?.mono ?? 'monospace',
    fontWeight: Platform.select({ android: '700' }) ?? '500',
    fontSize: 12,
  },
});
