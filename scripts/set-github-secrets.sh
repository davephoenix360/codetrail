#!/bin/bash
# set-github-secrets.sh
#
# Sets the two GitHub OAuth credentials as Firebase Functions secrets.
# The client_secret is captured via `read -s` (never echoed, never in shell
# history) and written to a chmod-600 temp file before being piped to
# `firebase functions:secrets:set`.
#
# Run from /srv/hermes/repos/codetrail on hermesbox.

set -e

# Ensure firebase CLI is on PATH (it's at /home/hermes/.hermes/node/bin)
export PATH="/home/hermes/.hermes/node/bin:$PATH"

echo "=== CodeTrail: Set GitHub OAuth secrets for Cloud Functions ==="
echo ""

# 1. Verify firebase CLI is available
if ! command -v firebase >/dev/null 2>&1; then
  echo "✗ firebase CLI not found in PATH"
  echo "  It should be at /home/hermes/.hermes/node/bin/firebase"
  echo "  Add to PATH: export PATH=\"/home/hermes/.hermes/node/bin:\$PATH\""
  exit 1
fi

# 2. Verify logged in to Firebase
echo "Checking Firebase auth..."
if ! firebase projects:list >/dev/null 2>&1; then
  echo ""
  echo "✗ Not logged in to Firebase."
  echo "  Run this first (in your own shell, opens a browser URL):"
  echo "    firebase login --no-localhost"
  echo ""
  exit 1
fi
ACTIVE_PROJECT=$(firebase use --json 2>/dev/null | python3 -c "import sys, json; print(json.load(sys.stdin).get('current', '?'))" 2>/dev/null || echo "?")
echo "✓ Logged in. Active project: $ACTIVE_PROJECT"
if [ "$ACTIVE_PROJECT" != "codetrail-32cf7" ]; then
  echo ""
  echo "⚠ Active project is '$ACTIVE_PROJECT', not 'codetrail-32cf7'."
  echo "  Set it with: firebase use codetrail-32cf7"
  echo ""
  read -p "Continue anyway? (y/N) " CONTINUE
  if [ "$CONTINUE" != "y" ] && [ "$CONTINUE" != "Y" ]; then
    exit 1
  fi
fi
echo ""

# 3. Set the client_id (public value, not actually a secret — but we keep
#    the same secrets interface for consistency with the Cloud Function)
echo "=== Setting GITHUB_OAUTH_CLIENT_ID ==="
echo "  (value: Ov23liW7FN7MLxY8YH3g — public OAuth app identifier)"
echo -n "Ov23liW7FN7MLxY8YH3g" | firebase functions:secrets:set GITHUB_OAUTH_CLIENT_ID --data-file=-
echo "  ✓ Set"
echo ""

# 4. Set the client_secret (the actual secret)
echo "=== Setting GITHUB_OAUTH_CLIENT_SECRET ==="
echo ""
echo "  Get it from: https://github.com/settings/developers"
echo "  → Click your CodeTrail OAuth app"
echo "  → 'Generate a new client secret' if you haven't saved one yet"
echo "  → Copy the secret (starts with gho_ or ghs_)"
echo ""
read -s -p "  Paste your client_secret: " THE_SECRET
echo

if [ -z "$THE_SECRET" ]; then
  echo ""
  echo "✗ No secret provided, aborting."
  exit 1
fi

echo "  → length: ${#THE_SECRET} chars"
echo "  → prefix: ${THE_SECRET:0:7}..."
echo ""

# 5. Write to a chmod-600 temp file (avoids any heredoc redaction issues)
TMPF=$(mktemp)
chmod 600 "$TMPF"
printf '%s' "$THE_SECRET" > "$TMPF"

firebase functions:secrets:set GITHUB_OAUTH_CLIENT_SECRET --data-file=- < "$TMPF" >/dev/null
echo "  ✓ Set"

rm -f "$TMPF"
unset THE_SECRET
echo ""

# 6. Verify the secrets exist (only print the public client_id, and the
#    length + prefix of the client_secret, NEVER the full secret).
echo "=== Verifying secrets ==="
echo "GITHUB_OAUTH_CLIENT_ID:"
CID=$(firebase functions:secrets:access GITHUB_OAUTH_CLIENT_ID 2>/dev/null || echo "")
if [ -n "$CID" ]; then
  echo "  $CID"
else
  echo "  (could not read — try: firebase functions:secrets:access GITHUB_OAUTH_CLIENT_ID)"
fi

echo ""
echo "GITHUB_OAUTH_CLIENT_SECRET (length + prefix only — never the full value):"
CSEC=$(firebase functions:secrets:access GITHUB_OAUTH_CLIENT_SECRET 2>/dev/null || echo "")
if [ -n "$CSEC" ]; then
  echo "  length: ${#CSEC} chars"
  echo "  prefix: ${CSEC:0:7}..."
  echo "  suffix: ...${CSEC: -4}"
else
  echo "  (could not read — try: firebase functions:secrets:access GITHUB_OAUTH_CLIENT_SECRET)"
fi
echo ""

echo "=== Done ==="
echo ""
echo "Next step: deploy the function"
echo "  firebase deploy --only functions"
echo ""
echo "(If you've never deployed Functions to this project, the first deploy"
echo " will prompt to enable required APIs and create a service account.)"
