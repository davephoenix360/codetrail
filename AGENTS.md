# CodeTrail — OpenCode Agent Context

This file is read by OpenCode automatically when started in this directory. It tells the coding agent how to behave in this repo.

## What This Project Is

CodeTrail is a mobile accountability app for coding learners to track their GitHub side projects with a supportive "hype-man" approach (vs Duolingo's guilt-trippy streaks). Tagline: "The hype-man for your coding projects."

## Stack

- Expo SDK 54, React Native, TypeScript
- Expo Router (file-based routing under `src/app/`)
- Firebase: Auth + Firestore (`src/lib/firebase.ts`, `firestore.rules`)
- `@react-native-firebase/app@^25` + `expo-notifications@~0.32.17`
- Cloudflare Worker (TypeScript) for GitHub OAuth proxy + push notification scheduler
- EAS Build (development profile, `eas.json`)

## Architecture Rules

### Dependency Management

**Always use `npx expo install <pkg>` for any Expo-native module.** Never `npm install <pkg>` (the latter pulls future-SDK carets and breaks builds at runtime).

**After every `npx expo install`, audit transitive deps:**
```bash
npm ls <pkg>          # check what got hoisted
```
Pin anything that got hoisted to a future SDK version.

**Pinned Expo SDK 54 versions (do NOT bump):**
- `expo-device@~8.0.10`
- `expo-notifications@~0.32.17`
- `expo-font@~14.0.12`
- `expo-asset`, `expo-modules-core`
- `@react-native-firebase/app@^25.1.0`

### Lazy-Require Pattern

SDK 53+ removes Expo-native modules from Expo Go at import time. For any code that runs in both Expo Go and dev builds:

```ts
let Notifications: any;
try {
  Notifications = require('expo-notifications');
} catch (e) {
  // Expo Go — feature unavailable
}
```

### Firebase Config

Use `expo.android.googleServicesFile` in `app.json` (NOT the plugin array config — that's outdated):
```json
"android": {
  "googleServicesFile": "./google-services.json"
}
```

### OAuth

GitHub OAuth apps require HTTPS callback URLs (not custom schemes). The Worker at `codetrail-oauth.davediepreye05.workers.dev/callback` is the HTTPS bridge; it 302-redirects to `codetrail://auth/callback` deep link. Do not change `REDIRECT_URI` to a custom scheme directly — break the Worker bridge.

### Cloudflare Workers (cloudflare-worker/, cloudflare-worker-notifications/)

- Use direct `fetch` against upstream APIs (NOT `@google-cloud/*` SDKs — Workers bundler incompat)
- Use `jose` for JWT, not `jsonwebtoken` (Workers bundler incompat)
- Don't add `expo-server-sdk` — its `require("node:assert")` and `require("node:zlib")` break the Workers bundler (error 10021). Use direct Expo Push API calls instead.

## DO

- Use `npx tsc --noEmit` for typecheck
- Use `npx expo lint` for linting
- Write tests next to source as `*.test.ts` (when adding tests)
- Use server timestamps for any time-sensitive data (`serverTimestamp()` from `firebase/firestore`)
- Keep functions small and focused

## DON'T

- Don't run `eas build` directly — let user trigger
- Don't push to GitHub without explicit user approval
- Don't modify `firestore.rules` without testing locally first
- Don't bump Expo SDK version without checking all native modules
- Don't add new top-level dependencies without checking if it's already in the dep tree
- Don't use `makeRedirectUri` for OAuth callbacks (GitHub rejects custom schemes)

## File Layout

```
codetrail/
├── app.json                   # Expo config + EAS project ID
├── eas.json                   # Build profiles
├── package.json               # Pinned deps (SDK 54 versions)
├── google-services.json       # Firebase Android config (committed)
├── firestore.rules            # Firestore security rules
├── src/
│   ├── app/                   # Expo Router screens
│   │   ├── index.tsx          # Root / splash
│   │   ├── sign-in-with-github.tsx
│   │   ├── auth/callback.tsx
│   │   ├── repos.tsx          # Tracked repos + bulk-track CTA
│   │   └── settings/          # Settings hub + notifications prefs
│   ├── lib/
│   │   ├── firebase.ts        # Firebase init + persistence
│   │   ├── notifications.ts   # Push reg + handlers (lazy-require)
│   │   ├── notification-prefs.ts
│   │   ├── account-types.ts   # TypeScript shapes
│   │   └── streak.ts          # Streak calculation
│   └── components/            # Reusable UI
├── assets/images/             # Brand assets (notification-icon.png)
├── cloudflare-worker/         # OAuth Worker (HTTP)
└── cloudflare-worker-notifications/  # 2.7 push scheduler Worker (in flight)
```

## Common Commands

```bash
# Dev
npx expo start --tunnel       # Start Metro with ngrok tunnel
npx tsc --noEmit              # Typecheck
npx expo lint                 # Lint

# Build (USER TRIGGERS)
eas build --profile development --platform android

# Deploy OAuth Worker
cd cloudflare-worker && npx wrangler deploy

# Deploy 2.7 Worker
cd cloudflare-worker-notifications && npx wrangler deploy
```

## Anti-Patterns (learned the hard way)

1. **`npm install` for Expo-native packages** → version mismatch → `Failed resolution of: Lexpo/modules/kotlin/types/AnyTypeCache` at runtime
2. **Forget transitive deps** → `expo-font@56.0.7` hoisted as transitive dep → crashes at runtime
3. **Plugin array config for google-services.json** → old pattern, doesn't work in SDK 54
4. **`makeRedirectUri` for OAuth** → GitHub OAuth apps reject custom-scheme URLs
5. **Skip Firebase Android app registration in Console** → `Default FirebaseApp is not initialized in this process` error

## Current Status (2026-07-03)

- Phase 2.7 push notifications: **paused** for orchestrator migration
- Build #6 APK is the latest working APK
- Last blocker: FCM V1 service account JSON upload to Expo project dashboard (5 min user task)

See `Hermes/CodeTrail 2.7 - Handoff Notes.md` in the vault for full resume context.