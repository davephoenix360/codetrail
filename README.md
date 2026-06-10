# CodeTrail

> A mobile app that helps coding learners stay accountable to their side projects — with a friendly hype-man approach, not the guilt-trippy streak-shame of Duolingo.

**Status:** Scaffolding complete (2026-06-10). Expo SDK 56 + TypeScript + Expo Router, 596 packages installed. Next: Firebase + GitHub OAuth auth spike.

## The pitch

Sign in with GitHub → pick the repos you're learning on → ship daily progress → see your friends' projects → get help when stuck → earn XP, badges, and project "levels." The app is your supportive corner, not a productivity bully.

## Tech stack

- **Mobile:** React Native + Expo SDK 56 + TypeScript (Expo Router, New Architecture, reactCompiler, typedRoutes — all on)
- **Backend:** Firebase (Auth + Firestore + Cloud Functions + FCM)
- **Auth:** GitHub OAuth (via Firebase)
- **GitHub data:** GitHub REST API, proxied through Cloud Functions (avoids token leakage, enables caching)
- **Push:** Expo Push + FCM

## Quick start

```bash
npm install          # one-time
npx expo start       # dev server, scan QR with Expo Go
```

To run on a real device or build for the stores, install EAS CLI: `npm install -g eas-cli` and run `eas login`.

## Development

```bash
npm start            # Expo dev server
npm run android      # open in Android emulator
npm run ios          # open in iOS simulator (macOS only)
npm run web          # open in browser
npm run lint         # ESLint
npx tsc --noEmit     # type-check
```

## Repo layout

```
codetrail/
├── app.json                 # Expo config (name, slug, bundle IDs)
├── package.json
├── tsconfig.json            # extends expo/tsconfig.base, @/* → src/* paths
├── assets/                  # icons, splash, favicon
├── scripts/
│   └── reset-project.js     # wipes the example content from src/
├── src/
│   ├── app/                 # Expo Router (file-based routing)
│   │   ├── _layout.tsx      # root layout
│   │   ├── index.tsx        # home screen
│   │   └── explore.tsx      # second screen
│   ├── components/          # shared UI (ThemedText, ThemedView, etc.)
│   ├── hooks/               # useColorScheme, useTheme
│   ├── constants/           # theme tokens
│   └── global.css           # web-only styles
├── BRIEF.md                 # full project brief
├── NAMING.md                # name alternatives
└── .gitignore
```

## Voice & tone

CodeTrail is the **hype-man, not the guilt-tripper.** Every notification, every error message, every empty state — supportive, encouraging, in your corner. Never "your streak is in DANGER!" Never sad-owl energy.

See [`BRIEF.md`](./BRIEF.md) for the full Voice & Tone section with sample copy.

## Full project brief

The canonical project brief is in the Obsidian vault at `Projects/CodeTrail - Project Brief.md`. A copy is committed here as [`BRIEF.md`](./BRIEF.md) for repo-context.

## License

MIT © 2026 Diepreye Charles-Daniel

