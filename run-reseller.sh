#!/bin/bash

set -e

echo "🚀 9Router Reseller: One-Click Local Setup"

# 1. Ensure .env exists
if [ ! -f .env ]; then
    echo "Creating .env from example..."
    cp .env.example .env
fi

# 2. Add minimal reseller config to .env if missing
for line in "RESELLER_ENABLED=true" "RESELLER_ADMIN_EMAIL=admin@example.com" "RESELLER_ADMIN_PASSWORD=admin"; do
    KEY=$(echo "$line" | cut -d= -f1)
    if ! grep -q "^$KEY=" .env; then
        echo "$line" >> .env
    fi
done
if ! grep -q "^RESELLER_SESSION_SECRET=" .env; then
    echo "RESELLER_SESSION_SECRET=$(openssl rand -hex 32)" >> .env
fi

# 3. Start local development server
echo "Starting 9Router on http://localhost:20127 ..."
npm run dev
