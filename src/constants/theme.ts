/**
 * CodeTrail design tokens — see design-drafts/BRAND.md and the
 * `codetrail-design` skill (`~/.hermes/skills/creative/codetrail-design/`)
 * for the full spec. Everything UI should read from these tokens, not
 * hardcoded colors or sizes.
 *
 * Dark-mode only. The MVP ships dark; light is a v2.0 follow-up.
 * Reuse the existing `Spacing` export shape so older code keeps
 * compiling; add the new groups alongside.
 */

import '@/global.css';

import { Platform } from 'react-native';

// =====================================================================
//  Color
// =====================================================================

/**
 * The single dark palette. Components that want a specific tone read
 * from this object — e.g. `Colors.surface` for a card, `Colors.text`
 * for primary text, `Colors.accent` for primary actions.
 *
 * Light mode values are still exported (for the future) but the
 * ThemedView / ThemedText defaults are dark-only. To opt-in to light,
 * pass `lightColor` / `darkColor` props to those components.
 */
export const Colors = {
  light: {
    text: '#0d1117',
    background: '#ffffff',
    surface: '#f6f8fa',
    raised: '#eef1f4',
    border: '#d0d7de',
    textSecondary: '#57606a',
  },
  dark: {
    // Surfaces
    bg: '#0d1117',
    surface: '#161b22',
    raised: '#21262d',
    border: '#30363d',
    borderStrong: '#484f58',
    overlay: 'rgba(0,0,0,0.6)',

    // Text
    text: '#e6edf3',
    muted: '#8b949e',
    faint: '#6e7681',

    // Accent (primary action, brand)
    accent: '#208AEF',
    accentHover: '#1f7ad6',
    accentSoft: 'rgba(32,138,239,0.12)',

    // Streak / fire
    fire1: '#f78166',
    fire2: '#db6d28',
    fireSoft: 'rgba(247,129,102,0.16)',

    // Status
    success: '#3fb950',
    successSoft: 'rgba(63,185,80,0.12)',
    warning: '#d29922',
    warningSoft: 'rgba(210,153,34,0.10)',
    danger: '#f85149',
    dangerSoft: 'rgba(248,81,73,0.10)',

    // Weekly chart bars (GitHub-style green scale)
    barEmpty: '#161b22',
    bar1: '#0e4429',
    bar2: '#006d32',
    bar3: '#26a641',
    bar4: '#39d353',
    barStreak: '#4d8de3',
    barToday: '#208AEF',
  },
} as const;

export type ThemeColor = keyof typeof Colors.dark;

// =====================================================================
//  Typography
// =====================================================================

/**
 * Font stacks. Custom Inter / JetBrains Mono loads are deferred to a
 * follow-up; for now we rely on platform defaults (San Francisco on
 * iOS, Roboto on Android). The `mono` stack is the only place where
 * the system font matches what the design calls for.
 */
export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

/**
 * Type scale. Use `Type.body`, `Type.small`, etc. for consistent
 * sizing. The `display` slot is reserved for the streak number.
 */
export const Type = {
  display: { fontSize: 56, lineHeight: 60, fontWeight: '700' as const, letterSpacing: -1.2 },
  h1: { fontSize: 32, lineHeight: 40, fontWeight: '700' as const, letterSpacing: -0.4 },
  h2: { fontSize: 24, lineHeight: 32, fontWeight: '600' as const, letterSpacing: -0.2 },
  h3: { fontSize: 20, lineHeight: 28, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '500' as const },
  bodyBold: { fontSize: 16, lineHeight: 24, fontWeight: '700' as const },
  small: { fontSize: 14, lineHeight: 20, fontWeight: '500' as const },
  smallBold: { fontSize: 14, lineHeight: 20, fontWeight: '700' as const },
  tiny: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
  mono: { fontSize: 14, lineHeight: 20, fontWeight: '500' as const, fontFamily: Fonts?.mono ?? 'monospace' },
} as const;

export type TypeVariant = keyof typeof Type;

// =====================================================================
//  Spacing — 4pt grid
// =====================================================================

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 12,
  three2: 16, // legacy alias
  four: 16,
  five: 24,
  six: 32,
  seven: 48,
  eight: 64,
} as const;

// =====================================================================
//  Radius
// =====================================================================

export const Radius = {
  chip: 6,
  card: 8,
  modal: 12,
  pill: 999,
} as const;

// =====================================================================
//  Motion
// =====================================================================

export const Motion = {
  fast: 150,
  default: 200,
  slow: 300,
  celebrate: 400,
} as const;

// =====================================================================
//  Layout primitives (used by BottomTabInset etc.)
// =====================================================================

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
