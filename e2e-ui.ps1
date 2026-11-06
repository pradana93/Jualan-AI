$ErrorActionPreference = 'Continue'
$base = 'http://localhost:20128'

# 1. Login page renders
$lp = Invoke-WebRequest -Uri "$base/reseller/login" -UseBasicParsing -TimeoutSec 30
"LOGIN PAGE: $($lp.StatusCode)  hasForm=$($lp.Content -match 'Sign In')"

# 2. Dashboard page renders
$dp = Invoke-WebRequest -Uri "$base/reseller" -UseBasicParsing -TimeoutSec 30
"DASH PAGE:  $($dp.StatusCode)  hasShell=$($dp.Content -match '9Router Reseller')"

# 3. Unauthenticated API is rejected
try {
  $r = Invoke-WebRequest -Uri "$base/api/reseller/keys" -UseBasicParsing -TimeoutSec 30
  "KEYS (anon): $($r.StatusCode)  body=$($r.Content)"
} catch {
  "KEYS (anon): HTTP $($_.Exception.Response.StatusCode.value__)"
}

# 4. Login as the seeded customer
$loginBody = @{ email='test@example.com'; password='supersecret123' } | ConvertTo-Json
try {
  $login = Invoke-WebRequest -Uri "$base/api/reseller/auth/login" -Method POST -Body $loginBody -ContentType 'application/json' -UseBasicParsing -TimeoutSec 30 -SessionVariable sess
  "LOGIN: $($login.StatusCode)"

  $me = Invoke-WebRequest -Uri "$base/api/reseller/auth/me" -UseBasicParsing -TimeoutSec 30 -WebSession $sess
  $meJson = $me.Content | ConvertFrom-Json
  "ME: user=$($meJson.user.email) role=$($meJson.user.role) balance=$($meJson.user.balanceCp)cp currency=$($meJson.config.currency) cpPerUnit=$($meJson.config.cpPerUnit)"

  $keys = Invoke-WebRequest -Uri "$base/api/reseller/keys" -UseBasicParsing -TimeoutSec 30 -WebSession $sess
  $k = $keys.Content | ConvertFrom-Json
  "KEYS: count=$($k.keys.Count) first=$($k.keys[0].keyMasked)"

  $models = Invoke-WebRequest -Uri "$base/api/reseller/models" -UseBasicParsing -TimeoutSec 30 -WebSession $sess
  $m = $models.Content | ConvertFrom-Json
  "MODELS: count=$($m.models.Count)"
  if ($m.models.Count -gt 0) {
    $m0 = $m.models[0]
    "  first: model=$($m0.model) name=$($m0.name) in=$($m0.inputCpPerM) out=$($m0.outputCpPerM)"
  }

  $usage = Invoke-WebRequest -Uri "$base/api/reseller/usage" -UseBasicParsing -TimeoutSec 30 -WebSession $sess
  $u = $usage.Content | ConvertFrom-Json
  "USAGE: requests=$($u.summary.requests) spendCp=$($u.summary.spendCp) rows=$($u.usage.Count)"
} catch {
  "ERR: $($_.Exception.Message)"
  if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message }
}
