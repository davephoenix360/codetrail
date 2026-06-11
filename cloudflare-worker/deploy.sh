#!/bin/bash
# deploy-worker.sh
#
# One-shot deploy of the Cloudflare Worker.
#
# First run: prompts for the Cloudflare API token + Account ID, then
# saves them to ~/.codetrail.env (chmod 600) so subsequent runs can
# auto-load. To re-prompt (e.g., to rotate the token), delete that
# file and re-run.
#
# IMPORTANT: must run from /srv/hermes/repos/codetrail/cloudflare-worker/
# because wrangler looks for wrangler.toml in the current directory.
#
# Usage:
#   bash cloudflare-worker/deploy.sh

set -e

ENV_FILE="$HOME/.codetrail.env"
export PATH="/home/hermes/.hermes/node/bin:$PATH"

echo "=== CodeTrail: Deploy Cloudflare Worker ==="
echo ""

# 1. Load credentials — either from the env file or by prompting once.
if [ -f "$ENV_FILE" ]; then
  echo "Loading credentials from $ENV_FILE"
  # shellcheck disable=SC1090
  source "$ENV_FILE"
else
  echo "First-time setup: enter your Cloudflare credentials."
  echo "These will be saved to $ENV_FILE (chmod 600) so you don't have to re-enter them."
  echo ""
  read -s -p "Cloudflare API token (cfut_...): " CLOUDFLARE_API_TOKEN
  echo
  read -p "Cloudflare Account ID (32 hex chars): " CLOUDFLARE_ACCOUNT_ID
  echo

  # Persist to a private env file. We write the token via a temp file to
  # avoid any command-line redaction, then concatenate.
  ENV_FILE_TMP="$(mktemp)"
  {
    echo "# Cloudflare credentials for the CodeTrail OAuth worker."
    echo "# Used by cloudflare-worker/deploy.sh."
    echo "# Created $(date -I). To rotate: edit and re-run, or delete this file."
    echo "export CLOUDFLARE_API_TOKEN='$CLOUDFLARE_API_TOKEN'"
    echo "export CLOUDFLARE_ACCOUNT_ID='$CLOUDFLARE_ACCOUNT_ID'"
  } > "$ENV_FILE_TMP"
  mv "$ENV_FILE_TMP" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "✓ Saved to $ENV_FILE (chmod 600)"
fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  echo "✗ Missing credentials in $ENV_FILE — delete it to re-prompt"
  exit 1
fi

# Re-export in case the sourced file used different casing
export CLOUDFLARE_API_TOKEN
export CLOUDFLARE_ACCOUNT_ID
echo "✓ env vars set (token length: ${#CLOUDFLARE_API_TOKEN} chars)"
echo ""

# 2. Verify auth works
echo "=== Verifying auth ==="
wrangler whoami 2>&1 | head -5
echo ""

# 3. Sanity check: confirm we're in the right directory
#    (wrangler uses the wrangler.toml in the current directory, not the parent)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPECTED_DIR="/srv/hermes/repos/codetrail/cloudflare-worker"
if [ "$SCRIPT_DIR" != "$EXPECTED_DIR" ]; then
  echo "✗ Script is in $SCRIPT_DIR, expected $EXPECTED_DIR"
  echo "  Please save this script in the cloudflare-worker/ directory."
  exit 1
fi
if [ ! -f "wrangler.toml" ]; then
  echo "✗ No wrangler.toml in current directory"
  exit 1
fi
echo "✓ In $(pwd) with wrangler.toml present"
echo ""

# 4. Deploy
echo "=== Deploying worker ==="
# Use --config to explicitly point at our wrangler.toml. This prevents
# wrangler from picking up a stale wrangler.jsonc from a parent directory
# (e.g. the project root) — which is exactly the bug that put us in this
# situation the first time.
wrangler deploy --config "$(pwd)/wrangler.toml" 2>&1 | tail -20

# 5. Cleanup: unset the env vars so they don't linger in the shell session
unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
echo ""
echo "✓ env vars cleared from session"
