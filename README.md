# CodeTrail

> A mobile app that helps coding learners stay accountable to their side projects — with a friendly hype-man approach, not the guilt-trippy streak-shame of Duolingo.

**Status:** Pre-MVP. Repo created 2026-06-10. No code yet.

## The pitch

Sign in with GitHub → pick the repos you're learning on → ship daily progress → see your friends' projects → get help when stuck → earn XP, badges, and project "levels." The app is your supportive corner, not a productivity bully.

## Tech stack

- **Mobile:** React Native + Expo SDK 54+ + TypeScript
- **Backend:** Firebase (Auth + Firestore + Cloud Functions + FCM)
- **Auth:** GitHub OAuth (via Firebase)
- **GitHub data:** GitHub REST API, proxied through Cloud Functions (avoids token leakage, enables caching)
- **Push:** Expo Push + FCM

## Development setup

```bash
# 1. Install deps
npm install

# 2. Start the dev server
npx expo start

# 3. Open in Expo Go (scan QR) or in a simulator
```

## Repo layout

```
codetrail/
├── app/                   # Expo Router screens
├── src/
│   ├── components/        # Reusable UI
│   ├── lib/               # Helpers (GitHub client, date utils, etc.)
│   ├── stores/            # Zustand state
│   └── types/             # TypeScript types
├── functions/             # Firebase Cloud Functions (GitHub proxy, etc.)
├── assets/                # Images, fonts
├── app.config.ts          # Expo config
└── package.json
```

## Voice & tone

CodeTrail is the **hype-man, not the guilt-tripper.** Every notification, every error message, every empty state — supportive, encouraging, in your corner. Never "your streak is in DANGER!" Never sad-owl energy.

See the [project brief in the vault](https://github.com/davephoenix360/codetrail/blob/main/BRIEF.md) for the full Voice & Tone section with sample copy.

## Full project brief

The canonical project brief lives in the Obsidian vault at `Projects/CodeTrail - Project Brief.md`. A copy is committed here as [`BRIEF.md`](./BRIEF.md) for repo-context.

## License

MIT © 2026 Diepreye Charles-Daniel
