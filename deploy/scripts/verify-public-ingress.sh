#!/usr/bin/env bash
set -euo pipefail

PUBLIC_IP="${PUBLIC_IP:?PUBLIC_IP is required}"
URL="http://${PUBLIC_IP}:3005/livez"

printf 'Checking direct public Express access is blocked at %s...\n' "$URL"
if curl --silent --show-error --connect-timeout 5 --max-time 10 "$URL" >/dev/null 2>&1; then
  printf 'DIRECT_PORT_3005_FAIL public port 3005 is reachable; release blocker\n' >&2
  exit 1
fi

printf 'DIRECT_PORT_3005_OK public port 3005 is blocked\n'
