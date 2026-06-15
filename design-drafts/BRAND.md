# CodeTrail Brand & Design System — v1.0

Quick-reference for the design language. The full spec is in
`~/.hermes/skills/creative/codetrail-design/references/`.

## Color at a glance

| Token | Hex | Use |
|---|---|---|
| Page bg | `#0d1117` | Default page background |
| Surface | `#161b22` | Cards, sheets |
| Raised | `#21262d` | Inputs, hover |
| Border | `#30363d` | Hairlines |
| Text | `#e6edf3` | Primary |
| Muted | `#8b949e` | Secondary |
| Accent | `#208AEF` | Primary actions, links |
| Fire 1→2 | `#f78166` → `#db6d28` | Streak number (gradient) |
| Success | `#3fb950` | "On CodeTrail", "shipped today" |
| Danger | `#f85149` | Real errors only |

**Rules:** Dark mode only (MVP). Fire = warm orange, not red.
Red = error only. One accent color (blue).

## Type

- **Inter** for UI / body (weights 400, 500, 600, 700)
- **JetBrains Mono** for dates / commit SHAs (weights 400, 500)
- Display size for streak: 56px / line-height 60
- Body: 16px / line-height 24
- Muted caption: 12-14px

## Spacing & radius

4pt grid. Card radius 8px, modal 12px, chip 6px, avatar 999px.

## Component inventory

8 components cover ~90% of the app — see the
`components.md` reference for HTML+RN snippets:

1. **StreakCard** — big flame + number + weekly chart + grace hint
2. **FeedEntry** — friend avatar + login + commit info + optional badge
3. **FriendRow** — friend list row with on/off CodeTrail badge
4. **EmptyState** — emoji + heading + sub + CTA
5. **PullToRefresh** — hype-man loading text
6. **PrimaryButton** — filled accent, 44pt hit target
7. **SubtleButton** — text-only, secondary actions
8. **Avatar** — circular, 24/36/56px sizes

## Voice (hype-man)

5 rules — see `copy-bank.md` for the full list:

1. **No shame.** Never "you failed," "broken streak," "you missed X days."
2. **No comparison-bait.** Never show a friend's streak count next to yours.
3. **Celebrate small wins.** 1 commit = a celebration.
4. **Reframe negatives as questions or invitations.** "Add a friend" beats
   "You have no friends."
5. **Match the platform.** "Changing The World A Line Of Code At A Time."

## Approved emoji

🔥 🫠 🌱 ✨ 🎉 🚀 💪 👀 🙏 😅

## Design drafts in this folder

- `repos-redesign.html` — main /repos screen (4 states: ready,
  loading, empty, error)
- `friends-redesign.html` — /friends screen (4 states)

Open in any browser. The "View state" panel in the corner
toggles between states. No build step, no server required.

## How to use the design skill

```bash
# Load the skill (in any Hermes session):
skill_view(name="codetrail-design")

# Then ask for a design:
"redesign the streak card with a celebratory animation"
"show me 3 options for the add-friend screen"
"apply the design system update to the /repos screen"
```

The skill handles: token lookup, component snippets, voice
guidance, HTML draft generation, and the React Native
translation table for reapplication.

## Output paths

- Drafts: `/srv/hermes/repos/codetrail/design-drafts/`
- Brand: `/srv/hermes/repos/codetrail/design-drafts/BRAND.md` (this file)
- Skill: `~/.hermes/skills/creative/codetrail-design/`
- Applied tokens: `src/constants/theme.ts`
- Applied components: `src/components/`
