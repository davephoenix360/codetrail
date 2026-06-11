#!/bin/bash
# deploy-worker.sh
#
# One-shot deploy of the Cloudflare Worker.
# Captures the API token via `read -s` (never in shell history, never
# displayed) so the platform's secret redaction doesn't corrupt it.
#
# IMPORTANT: must run from /srv/hermes/repos/codetrail/cloudflare-worker/
# because wrangler looks for wrangler.toml in the current directory.

set -e

export PATH="/home/hermes/.hermes/node/bin:$PATH"

echo "=== CodeTrail: Deploy Cloudflare Worker ==="
echo ""

# 1. Capture env vars securely
read -s -p "Cloudflare API token (cfut_...): " CLOUDFLARE_API_TOKEN
echo
read -p "Cloudflare Account ID (32 hex chars): " CLOUDFLARE_ACCOUNT_ID
echo

export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
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
