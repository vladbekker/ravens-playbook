#!/bin/sh
# Publishes marlbororavens.com by hand (Cloudflare also does this on its own after every push to GitHub).
set -e
cd "$(dirname "$0")"
npx wrangler deploy
