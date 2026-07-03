# codetrail-notifications

Cloudflare Worker scheduler for CodeTrail Phase 2.7 hype-man push notifications.

**Status:** Scaffold (not yet deployed).

## What it does

Runs on an hourly cron trigger. For each user with notification settings:

1. Evaluates eligibility for 4 notification types (daily check-in, streak milestone, streak broken, welcome back)
2. Batches all eligible messages and sends via Expo Push API
3. Marks each sent notification's `lastSentAt` in Firestore (idempotency)
4. Clears invalid push tokens (DeviceNotRegistered responses)

## Why a separate Worker

The existing `codetrail-oauth` worker is HTTP-only and has a different
secret rotation cadence. This Worker is cron-only, talks to Firestore
+ Expo (not GitHub), and has a longer-lived service account. Separation
of concerns → independent deploy, independent secrets.

## Architecture

See `Hermes/CodeTrail - 2.7 Notifications - Server Design.md` in the
Obsidian vault for the full design doc.

## Setup

```bash
cd cloudflare-worker-notifications
npm install
npx wrangler login   # if not already logged in

# Create the Firebase service account:
#   Firebase Console → Project Settings → Service Accounts → Generate new private key
#   Save the JSON, then:
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
# (paste the entire JSON)

# Test locally with a synthetic cron tick:
npx wrangler dev --test-scheduled
# (then in another shell:)
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"

# Deploy:
npx wrangler deploy
```

## Required Firestore rules update

The Worker uses a service account — it bypasses rules entirely. But the
client (Settings UI) writes to `users/{uid}/settings/notifications`,
which needs:

```
match /users/{uid}/settings/notifications {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

## First deploy checklist

- [ ] Create Firebase service account JSON, save to 1Password "nextep" vault
- [ ] Run `wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON` with the JSON
- [ ] Deploy Firestore rules update
- [ ] Deploy Worker: `wrangler deploy`
- [ ] Soft-launch: enable for own account first
- [ ] Verify each notification type fires by inspecting `wrangler tail` and phone

## Open questions (from design doc)

1. Streak broken timing: morning or check-in time?
2. Low-noise mode: pause everything or daily digest at 8pm?
3. Re-engagement cap: stop sending broken/welcome-back after 30 days of no response?
4. A/B test infra: receipts only, or full analytics integration?
5. Time zone change handling: accept 24h slop on TZ changes?
