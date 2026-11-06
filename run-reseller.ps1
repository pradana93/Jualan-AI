#!/usr/bin/env pwsh

$ErrorActionPreference = "Stop"

Write-Host "🚀 9Router Reseller: One-Click Local Setup" -ForegroundColor Cyan

# 1. Ensure .env exists
if (-not (Test-Path ".env")) {
    Write-Host "Creating .env from example..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
}

# 2. Add minimal reseller config to .env if missing
$config = @(
    "RESELLER_ENABLED=true",
    "RESELLER_SESSION_SECRET=$( [System.Guid]::NewGuid().ToString() )",
    "RESELLER_ADMIN_EMAIL=admin@example.com",
    "RESELLER_ADMIN_PASSWORD=admin"
)

foreach ($line in $config) {
    if (-not (Select-String -Path ".env" -Pattern $line.Split('=')[0])) {
        Add-Content -Path ".env" -Value $line
    }
}

# 3. Start local development server
Write-Host "Starting 9Router on http://localhost:20127 ..." -ForegroundColor Green
npm run dev
