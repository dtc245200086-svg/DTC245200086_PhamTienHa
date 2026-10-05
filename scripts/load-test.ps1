$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$baseUrl = if ($env:LOAD_TEST_BASE_URL) { $env:LOAD_TEST_BASE_URL.TrimEnd('/') } else { 'https://localhost' }
$iterations = if ($env:LOAD_TEST_ITERATIONS) { [int]$env:LOAD_TEST_ITERATIONS } else { 3 }
$envFile = Join-Path $root '.env'

if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$' -and -not $Matches[1].StartsWith('#')) {
            if (-not (Get-Item "Env:$($Matches[1])" -ErrorAction SilentlyContinue)) {
                [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
            }
        }
    }
}

if (-not $env:ADMIN_PASSWORD) { throw 'ADMIN_PASSWORD must be set in .env or the process environment.' }
if ($iterations -lt 1) { throw 'LOAD_TEST_ITERATIONS must be at least 1.' }

$cookieJar = Join-Path ([IO.Path]::GetTempPath()) ("billing-load-{0}.cookies" -f [guid]::NewGuid())
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

function Invoke-BillingApi {
    param(
        [Parameter(Mandatory)][string]$Path,
        [string]$Method = 'GET',
        [object]$Body,
        [int[]]$ExpectedStatus = @(200)
    )

    $curlArgs = @('-k', '-sS', '--max-time', '20', '-c', $cookieJar, '-b', $cookieJar, '-X', $Method,
        '-H', 'Accept: application/json', '-w', "`n%{http_code}")
    $bodyFile = $null
    if ($null -ne $Body) {
        $json = $Body | ConvertTo-Json -Depth 10 -Compress
        $bodyFile = Join-Path ([IO.Path]::GetTempPath()) ("billing-load-{0}.json" -f [guid]::NewGuid())
        [IO.File]::WriteAllText($bodyFile, $json, [Text.UTF8Encoding]::new($false))
        $curlArgs += @('-H', 'Content-Type: application/json', '--data-binary', "@$bodyFile")
    }

    try {
        $output = & curl.exe @curlArgs "$baseUrl$Path"
        $curlExitCode = $LASTEXITCODE
    } finally {
        if ($bodyFile) { Remove-Item $bodyFile -Force -ErrorAction SilentlyContinue }
    }
    if ($curlExitCode -ne 0) { throw "curl failed for $Method $Path with exit code $curlExitCode." }
    $text = $output -join "`n"
    $lastNewline = $text.LastIndexOf("`n")
    $status = [int]$text.Substring($lastNewline + 1).Trim()
    $responseBody = $text.Substring(0, $lastNewline)
    if ($status -notin $ExpectedStatus) { throw "$Method $Path returned HTTP $status; expected $($ExpectedStatus -join ', ')." }
    if (-not $responseBody) { return $null }
    try { return $responseBody | ConvertFrom-Json } catch { return $responseBody }
}

try {
    for ($index = 1; $index -le $iterations; $index++) {
        try {
            Invoke-BillingApi -Path '/api/auth/login' -Method POST -Body @{ username = 'admin'; password = 'load-test-invalid-password' } -ExpectedStatus @(401, 429) | Out-Null
        } catch { throw "Invalid-login traffic failed: $_" }

        if ($index -eq 1) {
            Invoke-BillingApi -Path '/api/auth/login' -Method POST -Body @{ username = 'admin'; password = $env:ADMIN_PASSWORD } -ExpectedStatus @(200) | Out-Null
            Invoke-BillingApi -Path '/api/auth/me' -ExpectedStatus @(200) | Out-Null
        }

        $name = "YC4 LOAD $stamp $index"
        $customer = Invoke-BillingApi -Path '/api/customers' -Method POST -Body @{
            name = $name
            email = "yc4-load-$stamp-$index@example.test"
            phone = '0900000000'
            address = 'YC4 traffic generation'
            tax_code = 'YC4LOAD'
        } -ExpectedStatus @(201)
        $customerId = $customer.customer.id
        Invoke-BillingApi -Path '/api/customers' -ExpectedStatus @(200) | Out-Null
        Invoke-BillingApi -Path "/api/customers/$customerId" -Method PUT -Body @{
            name = "$name updated"
            email = "yc4-load-$stamp-$index@example.test"
            phone = '0900000001'
            address = 'YC4 traffic generation updated'
            tax_code = 'YC4LOAD'
        } -ExpectedStatus @(200) | Out-Null

        $invoice = Invoke-BillingApi -Path '/api/invoices' -Method POST -Body @{
            customer_id = $customerId
            due_date = '2030-12-31'
            tax_rate = '0.10'
            items = @(@{ description = 'YC4 load item'; quantity = '2'; unit_price = '125000.00' })
        } -ExpectedStatus @(201)
        $invoiceId = $invoice.invoice.id
        Invoke-BillingApi -Path "/api/invoices/$invoiceId/issue" -Method POST -Body @{} -ExpectedStatus @(200) | Out-Null
        Invoke-BillingApi -Path "/api/invoices/$invoiceId/payments" -Method POST -Body @{
            amount = '50000.00'
            method = 'BANK_TRANSFER'
            paid_at = (Get-Date).ToString('yyyy-MM-dd')
            reference = "YC4-LOAD-$stamp-$index"
        } -ExpectedStatus @(201) | Out-Null

        Invoke-BillingApi -Path '/api/yc4-load-test-not-found' -ExpectedStatus @(404) | Out-Null
        Write-Output "Created YC4 LOAD customer, invoice, and payment set $index/$iterations."
    }

    $publicMetrics = & curl.exe -k -sS -o NUL -w '%{http_code}' "$baseUrl/metrics"
    if ($LASTEXITCODE -ne 0 -or $publicMetrics -ne '404') { throw "Public /metrics must return 404; received $publicMetrics." }
    Write-Output "Public /metrics is blocked; generated $iterations real billing traffic sets."
} finally {
    Remove-Item $cookieJar -Force -ErrorAction SilentlyContinue
}