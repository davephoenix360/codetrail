/**
 * Checkbox — a small, native-looking checkbox with no external dep.
 *
 * React Native ships with Switch but no Checkbox. `expo-checkbox` is the
 * official wrapper, but it's a 100KB+ dep for what is 30 lines of code.
 * This implementation renders a 22×22 box with a checkmark when value=true.
 *
 * Accessibility: announce as a checkbox role, with a state hint via the label.
 */
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from './themed-text';
import { Spacing } from '@/constants/theme';

export interface CheckboxProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
}

export function Checkbox({
  value,
  onValueChange,
  label,
  disabled = false,
  accessibilityLabel,
  style,
}: CheckboxProps) {
  return (
    <Pressable
      onPress={() => !disabled && onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        styles.row,
        disabled && styles.disabled,
        style,
      ]}
    >
      <View
        style={[
          styles.box,
          value ? styles.boxChecked : styles.boxUnchecked,
        ]}
      >
        {value ? <View style={styles.checkmark} /> : null}
      </View>
      {label ? (
        <ThemedText type="small" style={styles.label}>
          {label}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

const BOX_SIZE = 22;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  disabled: {
    opacity: 0.4,
  },
  box: {
    width: BOX_SIZE,
    height: BOX_SIZE,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxUnchecked: {
    borderColor: '#9ca3af',
    backgroundColor: 'transparent',
  },
  boxChecked: {
    borderColor: '#3c87f7',
    backgroundColor: '#3c87f7',
  },
  checkmark: {
    width: 6,
    height: 11,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#ffffff',
    transform: [{ rotate: '45deg' }, { translateY: -1 }],
  },
  label: {
    flexShrink: 1,
  },
});
