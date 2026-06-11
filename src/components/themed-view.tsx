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
  const backgroundColor = (isDark ? darkColor : lightColor) ?? colors.background;

  return <View style={[{ backgroundColor }, style]} {...otherProps} />;
}
