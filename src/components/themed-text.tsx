/**
 * ThemedText — auto-themed text using react-native's built-in useColorScheme.
 * Supports a `type` variant for the brand type scale and optional
 * `lightColor` / `darkColor` overrides. The `type` values map 1:1 to
 * the `Type` constants in `@/constants/theme`, plus a few legacy
 * aliases (`'default'`, `'title'`, `'subtitle'`, `'link'`, `'code'`)
 * that the older codebase still passes.
 */
import { Platform, StyleSheet, Text, type TextProps, useColorScheme } from 'react-native';

import { Colors, Fonts, Type } from '@/constants/theme';

export type ThemedTextType = keyof typeof Type | 'default' | 'title' | 'subtitle' | 'link' | 'linkPrimary' | 'code';

export type ThemedTextProps = TextProps & {
  type?: ThemedTextType;
  lightColor?: string;
  darkColor?: string;
};

export function ThemedText({ style, type = 'body', lightColor, darkColor, ...rest }: ThemedTextProps) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const color = (isDark ? darkColor : lightColor) ?? colors.text;

  return (
    <Text
      style={[
        { color },
        type === 'display' && { ...Type.display, color: isDark ? Colors.dark.fire1 : colors.text },
        type === 'h1' && Type.h1,
        type === 'h2' && Type.h2,
        type === 'h3' && Type.h3,
        type === 'body' && Type.body,
        type === 'bodyBold' && Type.bodyBold,
        type === 'small' && Type.small,
        type === 'smallBold' && Type.smallBold,
        type === 'tiny' && Type.tiny,
        type === 'mono' && Type.mono,
        // Legacy aliases — older call sites still use these names.
        type === 'title' && Type.h1,
        type === 'subtitle' && Type.h2,
        type === 'default' && Type.body,
        type === 'link' && { ...Type.small, color: isDark ? Colors.dark.accent : colors.text },
        type === 'linkPrimary' && { ...Type.small, color: isDark ? Colors.dark.accent : colors.text },
        type === 'code' && {
          fontFamily: Fonts?.mono ?? 'monospace',
          fontWeight: Platform.select({ android: '700' }) ?? '500',
          fontSize: 12,
        },
        style,
      ]}
      {...rest}
    />
  );
}
