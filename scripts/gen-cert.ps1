$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$certificateDirectory = Join-Path $repositoryRoot 'nginx\certs'
$opensslCommand = Get-Command openssl -ErrorAction SilentlyContinue
$opensslPath = if ($opensslCommand) { $opensslCommand.Source } else { $null }

if (-not $opensslPath) {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Git\usr\bin\openssl.exe'),
        'C:\Program Files\Git\usr\bin\openssl.exe',
        'C:\Program Files\OpenSSL-Win64\bin\openssl.exe'
    )
    $opensslPath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not $opensslPath) {
    throw 'OpenSSL was not found. Install OpenSSL or Git for Windows.'
}

New-Item -ItemType Directory -Path $certificateDirectory -Force | Out-Null
$keyPath = Join-Path $certificateDirectory 'server.key'
$certificatePath = Join-Path $certificateDirectory 'server.crt'

& $opensslPath req -x509 -nodes -newkey rsa:2048 -sha256 -days 365 `
    -keyout $keyPath -out $certificatePath -subj '/CN=localhost' `
    -addext 'subjectAltName=DNS:localhost,DNS:billing.local'
if ($LASTEXITCODE -ne 0) {
    throw 'OpenSSL failed to generate the self-signed certificate.'
}

Write-Output "Created self-signed certificate: $certificatePath"
Write-Output "Created private key (ignored by Git): $keyPath"