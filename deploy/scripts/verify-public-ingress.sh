#!/usr/bin/env bash
set -euo pipefail

PUBLIC_IP="${PUBLIC_IP:?PUBLIC_IP is required}"
DOMAIN="${DOMAIN:?DOMAIN is required}"
URL="http://${PUBLIC_IP}:3005/livez"

if ! command -v python3 >/dev/null 2>&1; then
  printf 'DEPENDENCY_FAIL python3 is required for TCP verification\n' >&2
  exit 1
fi

printf 'Checking direct TCP access is blocked at %s:3005...\n' "$PUBLIC_IP"
if python3 - "$PUBLIC_IP" <<'PY'
import socket
import sys

address = sys.argv[1]
try:
    with socket.create_connection((address, 3005), timeout=5):
        print('DIRECT_TCP_3005_REACHABLE')
        sys.exit(0)
except (ConnectionRefusedError, TimeoutError) as exc:
    print(f'DIRECT_TCP_3005_BLOCKED {exc}')
    sys.exit(1)
except OSError as exc:
    print(f'DIRECT_TCP_3005_PROBE_ERROR {exc}', file=sys.stderr)
    sys.exit(2)
PY
then
  TCP_PROBE_STATUS=0
else
  TCP_PROBE_STATUS=$?
fi
case "$TCP_PROBE_STATUS" in
  0)
  printf 'DIRECT_TCP_3005_FAIL public TCP port 3005 is reachable; release blocker\n' >&2
  exit 1
  ;;
  1)
  ;;
  *)
  printf 'DIRECT_TCP_3005_PROBE_FAIL unable to establish a trustworthy negative TCP result\n' >&2
  exit 1
  ;;
esac

printf 'DIRECT_TCP_3005_OK public TCP port 3005 is blocked\n'

printf 'Checking direct public Express access is blocked at %s...\n' "$URL"
if curl --noproxy '*' --silent --show-error --connect-timeout 5 --max-time 10 "$URL" >/dev/null 2>&1; then
  printf 'DIRECT_PORT_3005_FAIL public port 3005 is reachable; release blocker\n' >&2
  exit 1
fi

printf 'DIRECT_HTTP_3005_OK public HTTP port 3005 is blocked\n'

printf 'Checking HTTP to HTTPS redirect for %s...\n' "$DOMAIN"
HEADERS_FILE="$(mktemp)"
HTTP_STATUS="$(curl --noproxy '*' --silent --show-error --output /dev/null --dump-header "$HEADERS_FILE" --write-out '%{http_code}' --connect-timeout 5 --max-time 10 -H "Host: $DOMAIN" "http://${PUBLIC_IP}/")" || {
  rm -f "$HEADERS_FILE"
  printf 'HTTP_REDIRECT_FAIL unable to verify HTTP port 80 for %s\n' "$DOMAIN" >&2
  exit 1
}
REDIRECT_LOCATION="$(awk 'tolower($1) == "location:" { sub(/^[^:]*:[[:space:]]*/, ""); gsub(/\r/, ""); print; exit }' "$HEADERS_FILE")"
rm -f "$HEADERS_FILE"
if [ "$HTTP_STATUS" != '301' ] || [ "$REDIRECT_LOCATION" != "https://${DOMAIN}/" ]; then
  printf 'HTTP_REDIRECT_FAIL expected 301 to https://%s/, got HTTP %s Location %s\n' "$DOMAIN" "$HTTP_STATUS" "$REDIRECT_LOCATION" >&2
  exit 1
fi
printf 'HTTP_REDIRECT_OK 301 to https://%s/\n' "$DOMAIN"
