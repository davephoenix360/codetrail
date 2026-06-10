# Project: CodeTrail *(codename — pick a real name later)*

> **One-liner:** A mobile app that turns your GitHub repos into a Duolingo-style learning streak. Pick projects to track, ship daily progress, see your friends' projects, get help when stuck.
>
> **Status:** Idea-stage, no repo yet, no research done before today. This doc is the first write-up.
>
> **Last touched:** 2026-06-10

## The pitch

For self-taught engineers, bootcamp students, and CS undergrads working on side projects: shipping is the hardest part. GitHub's contribution graph is the only accountability tool most people have, and it has no friends, no help, no celebration, no lessons-learned.

**CodeTrail** = sign in with GitHub → pick the repos you're learning on → get a daily streak for shipping → see what your friends are shipping → ask for help when stuck → earn XP, badges, and project "levels."

## Goal

- **Primary:** Build a mobile app that helps coding learners stay accountable to side projects, with a social/help layer that's missing from existing tools.
- **Stretch:** Make it the default "second brain for shipping" for CS students at UAlberta and beyond.

## Decisions (locked 2026-06-10)

| Decision | Choice | Rationale |
|---|---|---|
| **Name** | **CodeTrail** (working) | Memorable, intuitive, 2-syllable. Alternatives in `CodeTrail - Naming Alternatives.md`. |
| **Streak rule** | **1+ commit per day = streak** | Binary, easy to understand, no judgment on "what counts." |
| **Repos** | **Public only for MVP** | Simplifies OAuth scopes + privacy model. Private repos = v2.0. |
| **Multi-account** | **One primary, link N additional GitHub accounts** | Many devs have personal + school + work. Aggregated across all linked. |
| **Voice & tone** | **Supportive, encouraging, hype-man. NOT guilt-trippy.** | Critical product differentiator. See the Voice & Tone section below. |

## Voice & tone (the hype-man, NOT the guilt-tripper)

> **This is the most important product decision in the brief.**
>
> Duolingo famously guilt-trips users with the green owl's "YOU'LL LOSE YOUR STREAK!!!" notifications. It works for engagement but it's exhausting. **CodeTrail is the opposite.** The app should feel like a supportive friend who genuinely wants you to ship — not a productivity bully.

### What we ARE

- **Hype-man:** "Big ship! 🎉 7-day streak unlocked — you cooked today."
- **Compassionate:** "Tough day? Streak freeze used. No judgment. Pick it up tomorrow."
- **Curious:** "What did you work on today? Tell your friends."
- **Proud (in your corner):** "You've shipped 14 days in a row. That's not luck — that's you showing up."
- **Realistic about life:** "Finals week? Toggle 'low-power mode' and we'll chill on the notifications."

### What we are NOT

- ❌ **Guilt-tripping:** No "Your streak is in DANGER!" or red countdown timers.
- ❌ **Shame:** No "You didn't ship yesterday" or sad-owl energy.
- ❌ **Punitive:** No locking features behind streaks. Streak freezes are free, not paywalled.
- ❌ **Doom:** No "Days since last commit: 14" displayed prominently.
- ❌ **Comparison-bait:** No "Tino shipped 3x more than you this week" leaderboards. (Aggregate progress is fine; one-upmanship is not.)

### Sample notification copy

| Trigger | ❌ Duolingo-style | ✅ CodeTrail-style |
|---|---|---|
| Streak about to end (4 hrs left, no commit) | "Your 14-day streak is in DANGER! Don't lose it now!" | "Friendly nudge: your streak rolls over in 4 hours. No pressure — life happens. 🌱" |
| Streak broken | "💀 You lost your 23-day streak. That's sad." | "Streak's at 0. We all hit resets. The next one starts the moment you ship. 💪" |
| New personal best | "🏆 New record!" | "🔥 30-day streak! You didn't just show up, you made it a habit. Tell someone you love." |
| Friend ships something big | (no equivalent) | "Tino just shipped the first cut of `tino-notes` v2. Big move. Drop a 🎉 on their feed?" |
| Streak freeze used | (paid feature in Duolingo) | "Streak freeze saved your run. You get 1/week. Use it when life is real. ❤️" |
| Returning after a break | (you've lost all progress) | "Welcome back. Your projects missed you. Pick one to nudge back to life." |

### How this shapes the product

- **No "streak about to end" countdown timers.** A gentle reminder at 4 hours is the most aggressive we get.
- **Streak freezes are always free, always 1/week.** Not a monetization lever.
- **Returning users (after 7+ days off) get a "welcome back" flow, not a "you failed" report.**
- **Friend feed is opt-in, with a "low-noise" mode by default.** No FOMO design.
- **Onboarding explicitly says: "This app is on your side. We will never shame you. We will, however, hype you."**
- **Copy review is a checklist item on every PR.** Maintain a "Voice & tone" doc with the do/don't list above as the single source of truth.

## Status

- [x] Idea articulated (today)
- [x] Competitive landscape researched (today)
- [x] Tech stack recommendation drafted (today)
- [ ] Project name picked
- [ ] GitHub repo created
- [ ] MVP scope frozen
- [ ] First commit
- [ ] First TestFlight / Play internal build
- [ ] First 10 beta testers

## Why this, why now — and the honest concerns

### Why it could work

1. **The lesson-focused space is taken** (Coddy.tech: 4M+ users), but **the project-progress + social space is wide open.** No app combines GitHub-streak tracking with peer help in a mobile-first, Duolingo-style UX.
2. **You (Diepreye) are the user.** SWE student at UAlberta, building side projects, juggling BESA + Dayforce + job search. You feel the pain firsthand. This is the right kind of project to dogfood.
3. **Tech is finally cheap to ship.** Expo + Firebase + GitHub OAuth = 6-8 weeks for a real MVP, solo, in 2026.

### Honest concerns (flag these before committing)

1. **Bandwidth is the #1 risk.** BESA VP Academics + Dayforce DevOps internship + school + job search is a full plate. A mobile-app side project realistically eats 8-15 hrs/week. Be ruthless with MVP scope.
2. **The lesson space is crowded and Coddy has distribution.** If your MVP drifts toward "teach me Python," you lose. Stay in the lane: "track what I ship, see what friends ship, get help."
3. **GitHub's contribution graph already does the streak part.** The differentiator MUST be the social/help layer. If that layer is weak, the app is a worse GitHub.
4. **Monetization is unclear.** Streak apps rarely monetize well. Don't promise yourself a business; promise yourself a portfolio piece + maybe a small community.

## Competitive landscape

| App | What it does | Why it's different from CodeTrail |
|---|---|---|
| **Coddy.tech** (4M+ users) | Duolingo-style **lessons** in Python/JS/etc. Gamified. | Lessons, not projects. No GitHub integration. No social. |
| **Git Streak Tracker** | Push notifications for your GitHub streak. Solo. | Solo, no social, no project framing, no help. |
| **Habitica** | Gamified habit tracker with RPG combat. | General-purpose, no GitHub, dated UX. |
| **Commit.dev** | Pairs you with an **accountability partner**. | 1-on-1 partner model, not "see all your friends' projects." |
| **NekoLog** (Redditor's WIP) | Gamified GitHub streak + XP. Solo. | Solo, no social, no project framing. Early stage. |
| **Beeminder** | Commitment contracts (you pay $$ if you fail). | Generic, payment-driven, no coding-specific UX. |

**The gap CodeTrail fills:** "See what my friends are shipping, get help when I'm stuck, keep my streak alive on a specific *project* I'm trying to finish" — none of the above do this in a mobile-first, Duolingo-style way.

## MVP scope (9 features, ship in 6-8 weeks)

1. **GitHub OAuth sign-in (primary account)**
2. **Linked accounts** — Settings → add/remove GitHub accounts, set primary. Aggregated stats across all linked accounts. (Diepreye's case: personal `davephoenix360` + school `DIEPREYECD` + work.)
3. **Pick your tracked repos** — toggle which repos count toward your streak
4. **Personal dashboard** — current streak, weekly commits, XP, "level" per project
5. **Friend system** — add friends by GitHub username, see their activity
6. **Activity feed** — "Tino shipped 3 commits to `tino-notes` today"
7. **Daily push notification** — friendly nudge in hype-man voice, never guilt-trippy
8. **Streak freeze** (1/week) — the supportive classic, lets you skip a day without breaking the streak
9. **Help request** — tap a button on a project, post a short "stuck on X" to your friends (this is the moat; build it well)

**Cut from MVP (v2.0):** leaderboards, badges, AI-generated summaries, "study groups," resource library, in-app messaging beyond help requests, public profile pages, private-repo support.

## Tech stack recommendation (2026)

| Layer | Choice | Why |
|---|---|---|
| **Mobile** | React Native + Expo SDK 54+ | Fastest path to a cross-platform MVP. You have JS/TS background, not Dart. Expo's EAS Build handles iOS + Android without Mac+Windows juggling. |
| **Language** | TypeScript | Type safety on the client; pairs with the rest of your stack |
| **State** | Zustand + TanStack Query | Light, modern, plays well with Expo. No Redux ceremony. |
| **Backend / DB** | Firebase (Auth + Firestore + Cloud Functions + FCM) | Fastest to MVP. Free tier covers the first few thousand users. Cloud Functions for any server-side GitHub proxy logic. |
| **Auth** | GitHub OAuth (via Firebase Auth's GitHub provider) | No need to build auth from scratch. Stores the GitHub access token. |
| **GitHub data** | GitHub REST API called from Cloud Functions (not the client) | Avoids leaking the OAuth token + lets you cache. 5,000 req/hr authenticated. |
| **Push notifications** | Expo Push + FCM | One API for both iOS and Android. |
| **Hosting (later)** | Firebase Hosting or Vercel (if you add a web companion) | Doesn't matter for MVP — there's no web yet. |
| **Analytics** | PostHog (self-host on hermesbox, or free tier) | Privacy-friendly, tracks streak events, no cookie banner. |

**Why not Flutter?** Bigger market share (46% vs 35% for RN), better performance, but you don't have Dart experience and Expo's CNG (continuous native generation) in 2026 has closed most of the "but native modules" gap. Faster to MVP with what you know.

**Why not Supabase?** Supabase is SQL-first and great for relational data. But for this MVP, the data is mostly denormalized (user → repos → daily stats, friends → activity). Firestore's NoSQL fits better. Supabase wins if you build a "study groups" or "teams" feature with complex joins later.

**Why not "pure client-side, no backend"?** You'd hit GitHub's 60 req/hr unauthenticated rate limit instantly. Even authenticated client-side is risky (token leakage, no caching). A thin Cloud Functions proxy is the right call.

## Phased roadmap

### Phase 0 — Repo + skeleton (Week 1)
- Create the GitHub repo (probably under `davephoenix360` since this is your personal brand)
- Set up Expo + TypeScript + Firebase
- Hello-world login → dashboard screen → log "signed in" event
- **Done =** a build that runs on your phone and says "Hi, Diepreye" after GitHub sign-in

### Phase 1 — MVP (Weeks 2-7)
- 8 features above, in order
- Internal TestFlight + Play internal track by end of week 6
- First 5-10 beta testers by week 8 (UAlberta friends, BESA team)

### Phase 2 — v1.0 (Weeks 8-12)
- Polish, bug fixes, App Store + Play Store submission
- Help-request feature promoted to first-class
- Onboarding flow (video, sample friends)
- Landing page (optional, hosted on Vercel)

### Phase 3 — v2.0 (Months 4+)
- "Study groups" (cohort-based)
- AI-generated weekly "what you shipped" summaries
- Resource library ("how to ship a side project" guides)
- Public profile pages (shareable streak stats)

## Next actions (concrete, this week)

1. **✅ Picked: CodeTrail** *(name locked 2026-06-10)*. Alternatives in `CodeTrail - Naming Alternatives.md` for future reference.
2. **Create the GitHub repo** under `davephoenix360/codetrail` (waiting on `gh auth login` from Diepreye — see GitHub Auth section).
3. **Set up the Expo project** (`npx create-expo-app codetrail --template default-typescript`).
4. **Wire up Firebase + GitHub OAuth** in a 2-hour spike — verify the auth flow works end-to-end on your phone.
5. **✅ Locked: streak rule** = 1+ commit per day, aggregated across all linked GitHub accounts.

## Open questions (decide before coding)

- **Monetization:** Free forever? Freemium (X friends for free, unlimited paid)? Subscription? Don't decide yet, but have a default. Default leaning: **free forever, no monetization in MVP**. (Premium features in v2.0 only.)
- **Platform priority:** iOS first, Android first, or truly both? (Expo makes this almost free, but design assets are 2× the work.) Default leaning: **truly both** (Expo's CNG handles the heavy lifting).
- **Data model for "help":** Public requests (like a feed)? Private DMs? Both? Pick one for MVP. Default leaning: **public request, posted to a small group of friends** (Twitter-DM-style audience, not a public timeline).
- **✅ Locked: public repos only** for MVP. Private repos = v2.0 with broader OAuth scope.
- **Internationalization:** UAlberta audience = mostly English. Nigeria audience (your reach) = English. Skip i18n for MVP. ✅ Locked.

## Setup prerequisites (need before any code)

1. **GitHub auth for `gh` CLI** — the `gh` CLI is installed on hermesbox but not authenticated. Diepreye runs `gh auth login` once (browser flow, ~60s). This unlocks: `gh repo create`, future PR/issue workflow, `gh api` for scripting. **If you'd rather use a token:** generate a PAT at https://github.com/settings/tokens (scopes: `repo`, `workflow`) and provide via the `secret-handoff` pattern — Hermes can `echo $TOKEN | gh auth login --with-token` from there.
2. **Firebase project** — Diepreye creates a free-tier project at https://console.firebase.google.com. The Android + iOS apps get registered there. ~10 minutes.
3. **GitHub OAuth App** — Diepreye creates an OAuth App at https://github.com/settings/applications/new (Authorization callback URL: `https://auth.expo.io/<your-expo-slug>` for dev, plus a custom scheme for production). The Client ID + Secret go into the Firebase GitHub auth provider config. ~5 minutes.
4. **EAS (Expo Application Services) account** — free tier is enough for MVP. `npx eas login` from the Expo project. ~2 minutes.

## Links

- [[README]] — Projects folder conventions
- [[../../Templates/Project Note Template]] — Template this note was based on
- [[CodeTrail - Naming Alternatives]] — Alt name options

## Notes

- **Why I called it "CodeTrail" in the doc:** it captures both "trail of commits" and "trail of progress." Trivially renameable.
- **Why I put this in `Projects/` and not `Areas/`:** `Areas/` is for ongoing life areas (BESA, Job Search, Personal). `Projects/` is for build-something-with-a-start-and-end items. This fits.
- **Honest meta:** A solo mobile app is a 3-6 month project, not a weekend. If BESA / Dayforce / job search is hot, park this. Re-read this doc in August and decide.
- **The hype-man tone is the moat.** If we get one thing right, get this right. Every notification copy, every error message, every empty state — all hype-man, all supportive. This is the differentiator from Coddy, from Habitica, from every other guilt-trip-streak app.

## Decisions log

| Date | Decision | By | Rationale |
|---|---|---|---|
| 2026-06-10 | Name = CodeTrail (working) | Diepreye | Memorable, intuitive, 2-syllable. Alternatives saved separately. |
| 2026-06-10 | Streak rule = 1+ commit/day | Diepreye | Binary, no judgment on "what counts." |
| 2026-06-10 | Public repos only for MVP | Diepreye | Simpler OAuth, no privacy model needed. |
| 2026-06-10 | Multi-account: one primary, N linked | Diepreye | Real user case (personal + school + work). Aggregated stats. |
| 2026-06-10 | Voice & tone: hype-man, supportive | Diepreye | Key differentiator from guilt-trip streak apps. Codified in Voice & Tone section. |
| 2026-06-10 | Default leanings: free forever, both platforms, public help requests | Hermes | Sensible defaults; user can override. |
