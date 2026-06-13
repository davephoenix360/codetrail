/**
 * ThemedView — auto-themed View that picks background color from the system
 * color scheme. Supports optional `lightColor` / `darkColor` overrides.
 */
import { useColorScheme, View, type ViewProps } from 'react-native';

import { Colors } from '@/constants/theme';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
};

export function ThemedView({ style, lightColor, darkColor, ...otherProps }: ThemedViewProps) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const backgroundColor = (isDark ? darkColor : lightColor) ?? (isDark ? (colors as any).bg : (colors as any).background);

  return <View style={[{ backgroundColor }, style]} {...otherProps} />;
}
