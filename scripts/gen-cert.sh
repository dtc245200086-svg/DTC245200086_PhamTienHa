#!/usr/bin/env sh
set -eu

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
certificate_directory="$script_directory/../nginx/certs"
key_path="$certificate_directory/server.key"
certificate_path="$certificate_directory/server.crt"

if ! command -v openssl >/dev/null 2>&1; then
    printf '%s\n' 'OpenSSL is required to generate the self-signed certificate.' >&2
    exit 1
fi

umask 077
mkdir -p "$certificate_directory"
openssl req -x509 -nodes -newkey rsa:2048 -sha256 -days 365 \
    -keyout "$key_path" -out "$certificate_path" -subj '/CN=localhost' \
    -addext 'subjectAltName=DNS:localhost,DNS:billing.local'
chmod 644 "$key_path"

printf 'Created self-signed certificate: %s\n' "$certificate_path"
printf 'Created private key (ignored by Git): %s\n' "$key_path"