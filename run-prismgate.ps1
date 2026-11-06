#!/usr/bin/env pwsh
# PrismGate engine launcher - isolated instance on port 20129.
#
# Never touches the stock 9router process on port 20128.
#
#   .\run-prismgate.ps1            # start (production build)
#   .\run-prismgate.ps1 -Dev       # start in dev mode
#   .\run-prismgate.ps1 -Build     # rebuild first, then start
#
# Requires .env.prismgate (see that file for the full config).

param(
    [switch]$Dev,
    [switch]$Build,
    [int]$Port = 20129
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# Load .env.prismgate into the process environment.
$envFile = Join-Path $root ".env.prismgate"
if (-not (Test-Path $envFile)) {
    throw "Missing .env.prismgate. Copy .env.example and fill in the reseller settings."
}
Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line) { return }
    if ($line.StartsWith("#")) { return }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { return }
    $key = $line.Substring(0, $idx).Trim()
    $val = $line.Substring($idx + 1)
    Set-Item -Path ("env:" + $key) -Value $val
}

if ($Port -ne 20129) { $env:PORT = [string]$Port }

# Guard: never hijack the stock 9router instance.
if ($env:PORT -eq "20128") {
    throw "Refusing to bind 20128 - that is the stock 9router instance."
}

# Guard: refuse to start if something already holds the port.
$busy = Get-NetTCPConnection -LocalPort ([int]$env:PORT) -State Listen -ErrorAction SilentlyContinue
if ($busy) {
    $ownerPid = $busy.OwningProcess | Select-Object -First 1
    $owner = (Get-CimInstance Win32_Process -Filter ("ProcessId=" + $ownerPid) -ErrorAction SilentlyContinue).CommandLine
    Write-Host ("Port " + $env:PORT + " is already in use (PID " + $ownerPid + ").") -ForegroundColor Red
    if ($owner) { Write-Host ("  " + $owner) -ForegroundColor DarkGray }
    throw "Port in use."
}

$dbLabel = "local SQLite"
if ($env:RESELLER_DATABASE_URL) { $dbLabel = "Supabase (postgres)" }

Write-Host "PrismGate engine" -ForegroundColor Magenta
Write-Host ("  port     : " + $env:PORT)
Write-Host ("  data dir : " + $env:DATA_DIR)
Write-Host ("  database : " + $dbLabel)
Write-Host ""

Push-Location $root
try {
    if ($Dev) {
        Write-Host "Starting in DEV mode..." -ForegroundColor Cyan
        npx next dev --port $env:PORT
    } else {
        $hasBuild = Test-Path (Join-Path $root ".next\BUILD_ID")
        if ($Build -or -not $hasBuild) {
            Write-Host "Building..." -ForegroundColor Cyan
            npm run build
            if ($LASTEXITCODE -ne 0) { throw "Build failed" }
        }
        Write-Host "Starting in PRODUCTION mode..." -ForegroundColor Cyan
        # Standalone output must run from .next/standalone so relative paths
        # (server.js, public/, .next/static) resolve. custom-server.js there
        # wraps Next's HTTP server to derive the real client IP.
        $standaloneDir = Join-Path $root ".next\standalone"
        if (-not (Test-Path (Join-Path $standaloneDir "server.js"))) {
            throw "Standalone build missing. Run: npm run build"
        }
        Push-Location $standaloneDir
        try {
            node custom-server.js
        } finally {
            Pop-Location
        }
    }
} finally {
    Pop-Location
}
