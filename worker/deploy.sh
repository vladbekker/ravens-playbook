#!/bin/sh
# Publishes marlbororavens.com: copies the page and the backup playbook next to the Worker, then deploys it to Cloudflare.
set -e
cd "$(dirname "$0")"
mkdir -p public
cp ../index.html ../playbook.json public/
npx wrangler deploy
