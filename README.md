# CodeTrail

> A mobile app that helps coding learners stay accountable to their side projects — with a friendly hype-man approach, not the guilt-trippy streak-shame of Duolingo.

**Status:** Repo picker complete (2026-06-11). GitHub sign-in working → home screen auto-redirects to `/repos` → user can browse their public repos and toggle tracking. Tracked repos persist in Firestore. Next: personal dashboard (streak + weekly commits).

## The pitch

Sign in with GitHub → pick the repos you're learning on → ship daily progress → see your friends' projects → get help when stuck → earn XP, badges, and project "levels." The app is your supportive corner, not a productivity bully.

## Tech stack

- **Mobile:** React Native + Expo SDK 54 + TypeScript (Expo Router, New Architecture, reactCompiler, typedRoutes — all on)
- **Backend:** Firebase (Auth + Firestore + FCM)
- **Auth:** GitHub OAuth → Firebase Auth, with the `client_secret` proxied through a Cloudflare Worker (free tier, no Blaze needed)
- **GitHub data:** GitHub REST API, proxied through the same Cloudflare Worker (avoids token leakage, enables caching)
- **Push:** Expo Push + FCM

## Quick start

```bash
npm install          # one-time
npx expo start       # dev server, scan QR with Expo Go
```

To run on a real device or build for the stores, install EAS CLI: `npm install -g eas-cli` and run `eas login`.

## Setup for a fresh checkout (collaborator runbook)

The repo is intentionally git-ignored: `.env`, the Cloudflare Worker secrets, the GitHub OAuth app, and the Firebase project. Each of those is **per-developer**. The runbook below gets a new collaborator from `git clone` to a working app on their phone in ~20 minutes.

### 1. App config

```bash
cp .env.example .env
# Fill in the Firebase web-app config + GitHub OAuth client_id + worker URL
# (sections 2 and 3 below produce these values).
```

### 2. Firebase

1. Create a new project at <https://console.firebase.google.com> (free Spark plan is fine).
2. Project settings → General → **Add app → Web**. Copy the config object into `.env`.
3. **Authentication → Sign-in method → GitHub.** Enable it, then create a GitHub OAuth app (step 3) and paste its client_id/client_secret back here.
4. **Authentication → Settings → Authorized domains.** Add `localhost` (for `npx expo start --web`) and your worker domain from step 4.

### 3. GitHub OAuth app

1. <https://github.com/settings/developers> → **New OAuth App**.
2. **Authorization callback URL**: this is the one piece that depends on your environment — see the table below. `expo-linking` generates the right `redirect_uri` for the current runtime (dev vs. production) automatically; your GitHub app just needs to allow both.

| Environment | GitHub callback URL to register |
| --- | --- |
| Dev (Expo Go) | `exp://<your-lan-ip>:<metro-port>` — e.g. `exp://192.168.1.50:8081`. The trailing `/--/auth/callback` path is **not** registered; GitHub matches the full URL but the `exp://host:port` prefix is what counts for the OAuth app config. |
| Dev (Tailscale) | Same as above, but with your Tailscale IP, e.g. `exp://100.64.1.2:8081`. |
| Production (standalone build) | `codetrail://auth/callback` (matches the `scheme: "codetrail"` in `app.json`). |

3. Copy the **client ID** into `.env` as `EXPO_PUBLIC_GITHUB_OAUTH_CLIENT_ID`. Keep the client secret for step 4.

### 4. Cloudflare Worker (GitHub → Firebase token exchanger + GitHub API proxy)

The worker holds the GitHub client secret, exchanges the OAuth `code` for an access token, and proxies GitHub API calls (so the access token never leaves our infra).

```bash
cd cloudflare-worker
npm install
npx wrangler login
npx wrangler secret put GITHUB_OAUTH_CLIENT_ID      # paste the client_id
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET  # paste the client_secret
npx wrangler deploy
# Copy the printed *.workers.dev URL into .env as EXPO_PUBLIC_CODETRAIL_EXCHANGE_URL
```

The worker's code (`cloudflare-worker/src/`) is the only place the client_secret ever lives. The app never sees it.

The worker exposes three endpoints:
- `POST /` — exchange an OAuth code for an access token
- `POST /user` — get the authenticated GitHub user's profile
- `POST /user/repos` — list the authenticated user's public repos (sorted by most recently updated)

All three are called by the app via `src/lib/github-api.ts` (which adds the access token from `useAuth`).

### 5. Firestore (one-time, per Firebase project)

1. In the [Firebase Console](https://console.firebase.google.com), go to Firestore Database → Rules.
2. Copy the contents of `firestore.rules` from this repo and paste it in.
3. Publish.

The rules deny everything by default, then allow each user to read/write their own `users/{uid}` doc and `users/{uid}/trackedRepos/{repoId}` subcollection. No public reads, no cross-user access, no admin SDK in the client.

### 6. Run it

```bash
npx expo start
# Scan the QR with Expo Go on your phone
```

Sign in with GitHub — you should land on `/repos`. If you have public repos on GitHub, tap "Browse your projects" to see them and toggle tracking on the ones you want. Sign out and back in to confirm your tracked repos persist.

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
├── app.json                 # Expo config (name, slug, bundle IDs, scheme)
├── package.json
├── tsconfig.json            # extends expo/tsconfig.base, @/* → src/* paths
├── .env.example             # template for the per-developer .env
├── assets/                  # icons (iOS, Android, web, splash)
├── cloudflare-worker/       # GitHub → access-token exchanger + GitHub API proxy
│   ├── src/index.ts
│   ├── wrangler.toml
│   └── deploy.sh
├── firestore.rules          # Firestore security rules (deploy to Firebase Console)
├── firestore.indexes.json
├── src/
│   ├── app/                 # Expo Router (file-based routing)
│   │   ├── _layout.tsx      # root layout
│   │   ├── index.tsx        # landing screen (sign-in OR redirect to /repos)
│   │   ├── repos.tsx        # main authenticated screen
│   │   └── auth/callback.tsx  # OAuth deep-link handler
│   ├── components/          # shared UI (SignInWithGitHub, RepoListItem, RepoPicker, ThemedText, ThemedView)
│   ├── hooks/               # useAuth (Firebase auth state + GitHub token)
│   ├── lib/                 # firebase.ts, auth-callback.ts, github-api.ts, github-token-store.ts, firebase-repos.ts
│   ├── constants/           # theme tokens
│   └── global.css           # web-only font CSS variables
├── BRIEF.md                 # full project brief
└── .gitignore
```

## Voice & tone

CodeTrail is the **hype-man, not the guilt-tripper.** Every notification, every error message, every empty state — supportive, encouraging, in your corner. Never "your streak is in DANGER!" Never sad-owl energy.

See [`BRIEF.md`](./BRIEF.md) for the full Voice & Tone section with sample copy.

## Full project brief

The canonical project brief is in the Obsidian vault at `Projects/CodeTrail - Project Brief.md`. A copy is committed here as [`BRIEF.md`](./BRIEF.md) for repo-context.

## License

MIT © 2026 Diepreye Charles-Daniel

