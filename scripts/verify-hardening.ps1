# Hardening Verification Script (PowerShell) for Project Billing (YC6 / CP6)
# Tests H1 to H6 controls and reports PASS/FAIL.
param(
  [string]$ComposeFile = "docker-compose.yml"
)

$failures = 0

function Report-Check {
  param([string]$Id, [string]$Name, [bool]$Passed, [string]$Detail = "")
  if ($Passed) {
    Write-Host "[PASS] $Id - ${Name}: $Detail" -ForegroundColor Green
  } else {
    Write-Host "[FAIL] $Id - ${Name}: $Detail" -ForegroundColor Red
    $script:failures++
  }
}

function Run-Psql {
  param([string]$User, [string]$Password, [string]$Sql)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = docker compose exec -T -e PGPASSWORD="$Password" postgres psql -h 127.0.0.1 -U "$User" -d billing -c "$Sql" 2>&1 | Out-String
    return $out
  } finally {
    $ErrorActionPreference = $prev
  }
}

Write-Host "===================================================="
Write-Host "     BILLING SYSTEM - HARDENING VERIFICATION (CP6)  "
Write-Host "===================================================="

# Load credentials from .env if present
$envFile = ".env"
$dbAppPass = $env:BILLING_APP_PASSWORD
$dbRoPass = $env:BILLING_READONLY_PASSWORD
$dbPgPass = $env:POSTGRES_PASSWORD

if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)\s*=\s*(.*)$') {
      $k = $matches[1].Trim()
      $v = $matches[2].Trim()
      if ($k -eq "BILLING_APP_PASSWORD" -and -not $dbAppPass) { $dbAppPass = $v }
      if ($k -eq "BILLING_READONLY_PASSWORD" -and -not $dbRoPass) { $dbRoPass = $v }
      if ($k -eq "POSTGRES_PASSWORD" -and -not $dbPgPass) { $dbPgPass = $v }
    }
  }
}

# --- H1: Non-root container runtime ---
try {
  $webId = [string](docker compose exec -T web id 2>$null)
  $webNonRoot = ($webId -match 'uid=1000\(node\)')
  Report-Check "H1.1" "Web container runs as non-root user (node:1000)" $webNonRoot $webId.Trim()

  $pgTop = docker compose top postgres 2>$null
  $pgLines = @($pgTop | Where-Object { $_ -match '^\s*postgres\s+' })
  $allPgNonRoot = ($pgLines.Count -gt 0)
  foreach ($line in $pgLines) {
    if ($line -notmatch '\b999\b') { $allPgNonRoot = $false }
  }
  Report-Check "H1.2" "PostgreSQL server processes run as non-root (UID 999/postgres)" $allPgNonRoot "Processes inspected: $($pgLines.Count)"

  $nginxId = [string](docker compose exec -T nginx id 2>$null)
  $nginxNonRoot = ($nginxId -match 'uid=101')
  Report-Check "H1.3" "Nginx container runs as unprivileged (UID 101)" $nginxNonRoot $nginxId.Trim()

  $grafanaId = [string](docker compose exec -T grafana id 2>$null)
  $grafanaNonRoot = ($grafanaId -match 'uid=472')
  Report-Check "H1.4" "Grafana container runs as non-root (UID 472)" $grafanaNonRoot $grafanaId.Trim()

  $promId = [string](docker compose exec -T prometheus id 2>$null)
  $promNonRoot = ($promId -match 'uid=65534')
  Report-Check "H1.5" "Prometheus container runs as nobody (UID 65534)" $promNonRoot $promId.Trim()

  $lokiUser = [string](docker inspect billing-loki-1 --format '{{.Config.User}}' 2>$null)
  $lokiNonRoot = ($lokiUser.Trim() -eq "10001")
  Report-Check "H1.6" "Loki container configured as non-root (UID 10001)" $lokiNonRoot "User: $($lokiUser.Trim())"

  $cadvisorPriv = [string](docker inspect billing-cadvisor-1 --format '{{.HostConfig.Privileged}}' 2>$null)
  Report-Check "H1.7" "cAdvisor documented privileged exception" ($cadvisorPriv.Trim() -eq "true") "Privileged: $($cadvisorPriv.Trim()) (Documented Exception)"
} catch {
  Report-Check "H1" "Non-root checks" $false $_.Exception.Message
}

# --- H2: Network isolation & membership ---
try {
  $nets = docker network ls --filter "name=billing_" --format "{{.Name}}"
  $all5Exist = ($nets -contains "billing_edge_net" -and $nets -contains "billing_admin_net" -and $nets -contains "billing_app_net" -and $nets -contains "billing_db_net" -and $nets -contains "billing_monitoring_net")
  Report-Check "H2.1" "All 5 dedicated networks exist" $all5Exist "Found: $($nets -join ', ')"

  $edgeInternal = [string](docker network inspect billing_edge_net --format '{{.Internal}}' 2>$null)
  $adminInternal = [string](docker network inspect billing_admin_net --format '{{.Internal}}' 2>$null)
  $appInternal = [string](docker network inspect billing_app_net --format '{{.Internal}}' 2>$null)
  $dbInternal = [string](docker network inspect billing_db_net --format '{{.Internal}}' 2>$null)
  $monInternal = [string](docker network inspect billing_monitoring_net --format '{{.Internal}}' 2>$null)

  $internalFlagsCorrect = ($edgeInternal.Trim() -eq "false" -and $adminInternal.Trim() -eq "false" -and $appInternal.Trim() -eq "true" -and $dbInternal.Trim() -eq "true" -and $monInternal.Trim() -eq "true")
  Report-Check "H2.2" "Network internal flags match design" $internalFlagsCorrect "app_net, db_net, monitoring_net are internal: true"

  $dbContainers = [string](docker network inspect billing_db_net --format '{{range $k, $v := .Containers}}{{$v.Name}} {{end}}' 2>$null)
  $pgInDbNet = $dbContainers -match "billing-postgres-1"
  $ngNotInDbNet = -not ($dbContainers -match "billing-nginx-1")
  Report-Check "H2.3" "Postgres in db_net and Nginx isolated from db_net" ($pgInDbNet -and $ngNotInDbNet) "db_net members: $($dbContainers.Trim())"

  $adminContainers = [string](docker network inspect billing_admin_net --format '{{range $k, $v := .Containers}}{{$v.Name}} {{end}}' 2>$null)
  $noDbInAdmin = -not ($adminContainers -match "billing-postgres-1")
  $noWebInAdmin = -not ($adminContainers -match "billing-web-1")
  Report-Check "H2.4" "Admin network isolated from web and postgres" ($noDbInAdmin -and $noWebInAdmin) "admin_net members: $($adminContainers.Trim())"
} catch {
  Report-Check "H2" "Network isolation checks" $false $_.Exception.Message
}

# --- H3: Credentials & Secrets ---
try {
  $trackedEnv = [string](git ls-files .env 2>$null)
  $envNotTracked = ([string]::IsNullOrWhiteSpace($trackedEnv))
  Report-Check "H3.1" "Secret .env file is NOT tracked by Git" $envNotTracked "git ls-files .env is empty"

  $exampleTracked = [string](git ls-files .env.example 2>$null)
  Report-Check "H3.2" "Template .env.example IS tracked by Git" ($exampleTracked.Trim() -eq ".env.example") "git ls-files .env.example: $($exampleTracked.Trim())"

  $grafanaAuth = [string](curl.exe -s -o nul -w "%{http_code}" -u "admin:admin" http://127.0.0.1:3000/api/org 2>$null)
  Report-Check "H3.3" "Default Grafana credential (admin/admin) is rejected" ($grafanaAuth.Trim() -eq "401") "Status: $($grafanaAuth.Trim())"
} catch {
  Report-Check "H3" "Secret checks" $false $_.Exception.Message
}

# --- H4: Database Least Privilege ---
try {
  # billing_app negative test: DROP TABLE
  $dropOut = Run-Psql "billing_app" $dbAppPass "DROP TABLE payments;"
  $dropBlocked = ($dropOut -match 'ERROR:\s+must be owner of table payments')
  Report-Check "H4.1" "billing_app cannot DROP TABLE" $dropBlocked ($dropOut.Trim() -replace '\s+', ' ')

  # billing_app negative test: UPDATE payments
  $updatePayOut = Run-Psql "billing_app" $dbAppPass "UPDATE payments SET amount = 1;"
  $updatePayBlocked = ($updatePayOut -match 'ERROR:\s+permission denied for table payments')
  Report-Check "H4.2" "billing_app cannot UPDATE payments (append-only enforced)" $updatePayBlocked ($updatePayOut.Trim() -replace '\s+', ' ')

  # billing_app negative test: DELETE payments
  $deletePayOut = Run-Psql "billing_app" $dbAppPass "DELETE FROM payments;"
  $deletePayBlocked = ($deletePayOut -match 'ERROR:\s+permission denied for table payments')
  Report-Check "H4.3" "billing_app cannot DELETE payments" $deletePayBlocked ($deletePayOut.Trim() -replace '\s+', ' ')

  # billing_readonly positive test: SELECT
  $selectOut = Run-Psql "billing_readonly" $dbRoPass "SELECT count(*) FROM invoices;"
  $selectAllowed = ($selectOut -match '\d+\s+\(1 row\)')
  Report-Check "H4.4" "billing_readonly can SELECT invoices" $selectAllowed ($selectOut.Trim() -replace '\s+', ' ')

  # billing_readonly negative test: INSERT
  $insertOut = Run-Psql "billing_readonly" $dbRoPass "INSERT INTO customers (name, email) VALUES ('x','x@x.com');"
  $insertBlocked = ($insertOut -match 'ERROR:\s+permission denied for table customers')
  Report-Check "H4.5" "billing_readonly cannot INSERT into customers" $insertBlocked ($insertOut.Trim() -replace '\s+', ' ')

  # billing_readonly negative test: SELECT users
  $selectUsersOut = Run-Psql "billing_readonly" $dbRoPass "SELECT * FROM users;"
  $selectUsersBlocked = ($selectUsersOut -match 'ERROR:\s+permission denied for table users')
  Report-Check "H4.6" "billing_readonly cannot access users auth table" $selectUsersBlocked ($selectUsersOut.Trim() -replace '\s+', ' ')

  # exporter role check
  $expRoleOut = Run-Psql "postgres" $dbPgPass "SELECT r.rolname, m.rolname AS memberof FROM pg_roles r JOIN pg_auth_members a ON r.oid = a.member JOIN pg_roles m ON a.roleid = m.oid WHERE r.rolname = 'exporter';"
  $expHasPgMonitor = ($expRoleOut -match 'exporter\s+\|\s+pg_monitor')
  Report-Check "H4.7" "exporter role belongs to pg_monitor" $expHasPgMonitor ($expRoleOut.Trim() -replace '\s+', ' ')
} catch {
  Report-Check "H4" "DB least privilege checks" $false $_.Exception.Message
}

# --- H5: Security headers & TLS ---
try {
  $headerOut = (curl.exe -k -s -I https://localhost 2>&1 | Out-String)
  $hasHsts = ($headerOut -match 'Strict-Transport-Security:\s*max-age=86400')
  $hasNosniff = ($headerOut -match 'X-Content-Type-Options:\s*nosniff')
  $hasXfo = ($headerOut -match 'X-Frame-Options:\s*DENY')
  $hasReferrer = ($headerOut -match 'Referrer-Policy:\s*strict-origin-when-cross-origin')
  $hasPermissions = ($headerOut -match 'Permissions-Policy:\s*camera=\(\)')
  $hasCsp = ($headerOut -match 'Content-Security-Policy:\s*default-src')
  $serverTokensOff = ($headerOut -match 'Server:\s*nginx\r?\n')

  Report-Check "H5.1" "All 6 security headers present" ($hasHsts -and $hasNosniff -and $hasXfo -and $hasReferrer -and $hasPermissions -and $hasCsp) "HSTS, nosniff, DENY, Referrer, Permissions, CSP"
  Report-Check "H5.2" "Nginx version token hidden (server_tokens off)" $serverTokensOff "Server header has no version"
} catch {
  Report-Check "H5" "Security header checks" $false $_.Exception.Message
}

# --- H6: Port exposure ---
try {
  $portLines = docker ps --filter "name=billing-" --format "{{.Names}}:::{{.Ports}}"
  $webExposed = $false
  $pgExposed = $false
  $lokiExposed = $false

  foreach ($line in $portLines) {
    $parts = $line -split ':::'
    $name = $parts[0]
    $ports = if ($parts.Length -gt 1) { $parts[1] } else { "" }

    if ($name -eq "billing-web-1" -and $ports -match '->') { $webExposed = $true }
    if ($name -eq "billing-postgres-1" -and $ports -match '->') { $pgExposed = $true }
    if ($name -eq "billing-loki-1" -and $ports -match '->') { $lokiExposed = $true }
  }

  Report-Check "H6.1" "web container internal port 3000 is NOT published" (-not $webExposed) "web port exposure: $webExposed"
  Report-Check "H6.2" "postgres container internal port 5432 is NOT published" (-not $pgExposed) "postgres port exposure: $pgExposed"
  Report-Check "H6.3" "loki container internal port 3100 is NOT published" (-not $lokiExposed) "loki port exposure: $lokiExposed"
} catch {
  Report-Check "H6" "Port exposure checks" $false $_.Exception.Message
}

Write-Host "===================================================="
if ($failures -eq 0) {
  Write-Host "HARDENING VERIFICATION PASSED (All H1-H6 checks OK)" -ForegroundColor Green
  exit 0
} else {
  Write-Host "HARDENING VERIFICATION FAILED ($failures failures)" -ForegroundColor Red
  exit 1
}
