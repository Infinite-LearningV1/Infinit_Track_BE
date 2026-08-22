#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:?DOMAIN is required}"
EXPECTED_IP="${EXPECTED_IP:?EXPECTED_IP is required}"
LOCAL_LIVEZ_URL="${LOCAL_LIVEZ_URL:-http://127.0.0.1:3005/livez}"
LOCAL_READINESS_URL="${LOCAL_READINESS_URL:-http://127.0.0.1:3005/health}"
PUBLIC_API_BASE_URL="${PUBLIC_API_BASE_URL:-https://${DOMAIN}}"
PUBLIC_LIVEZ_URL="${PUBLIC_LIVEZ_URL:-${PUBLIC_API_BASE_URL}/livez}"
PUBLIC_READINESS_URL="${PUBLIC_READINESS_URL:-${PUBLIC_API_BASE_URL}/health}"

if ! command -v python3 >/dev/null 2>&1; then
  printf 'DEPENDENCY_FAIL python3 is required for JSON readiness verification\n' >&2
  exit 1
fi

check_json_endpoint() {
  local url="$1"
  local label="$2"
  local mode="$3"
  local response_file
  local status

  response_file="$(mktemp)"

  if ! status="$(curl --silent --show-error --output "$response_file" --write-out '%{http_code}' "$url")"; then
    rm -f "$response_file"
    printf '%s_FAIL curl request failed for %s\n' "$label" "$url" >&2
    exit 1
  fi

  python3 - "$response_file" "$status" "$label" "$url" "$mode" <<'PY'
import json
import sys

response_file, status_code, label, url, mode = sys.argv[1:]
status_code = int(status_code)

with open(response_file, 'r', encoding='utf-8') as handle:
    raw_body = handle.read()

try:
    data = json.loads(raw_body)
except json.JSONDecodeError as exc:
    print(f"{label}_FAIL invalid JSON from {url}: {exc}", file=sys.stderr)
    print(raw_body, file=sys.stderr)
    sys.exit(1)

if status_code != 200:
    print(f"{label}_FAIL unexpected HTTP {status_code} from {url}", file=sys.stderr)
    print(json.dumps(data, ensure_ascii=False), file=sys.stderr)
    sys.exit(1)

if data.get('status') != 'OK':
    print(f"{label}_FAIL unexpected status field from {url}", file=sys.stderr)
    print(json.dumps(data, ensure_ascii=False), file=sys.stderr)
    sys.exit(1)

if mode == 'readiness':
    if data.get('ready') is not True:
        print(f"{label}_FAIL readiness flag is not true for {url}", file=sys.stderr)
        print(json.dumps(data, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
    if not isinstance(data.get('components'), dict):
        print(f"{label}_FAIL readiness components missing for {url}", file=sys.stderr)
        print(json.dumps(data, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
    if not isinstance(data.get('missing'), list):
        print(f"{label}_FAIL readiness missing array absent for {url}", file=sys.stderr)
        print(json.dumps(data, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

print(json.dumps(data, ensure_ascii=False))
print(f"{label}_OK")
PY

  rm -f "$response_file"
}

check_blocked_endpoint() {
  local url="$1"
  local label="$2"
  local response_file
  local status

  response_file="$(mktemp)"

  if ! status="$(curl --silent --show-error --output "$response_file" --write-out '%{http_code}' "$url")"; then
    rm -f "$response_file"
    printf '%s_FAIL curl request failed for %s\n' "$label" "$url" >&2
    exit 1
  fi

  case "$status" in
    401|403)
      printf '%s_OK blocked anonymous access with HTTP %s\n' "$label" "$status"
      ;;
    *)
      printf '%s_FAIL expected HTTP 401/403 from %s, got %s\n' "$label" "$url" "$status" >&2
      cat "$response_file" >&2
      rm -f "$response_file"
      exit 1
      ;;
  esac

  rm -f "$response_file"
}

check_removed_post_route() {
  local url="$1"
  local label="$2"
  local response_file
  local status

  response_file="$(mktemp)"

  if ! status="$(curl --silent --show-error --output "$response_file" --write-out '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$url")"; then
    rm -f "$response_file"
    printf '%s_FAIL curl request failed for %s\n' "$label" "$url" >&2
    exit 1
  fi

  if [ "$status" != '404' ]; then
    printf '%s_FAIL expected HTTP 404 from %s, got %s\n' "$label" "$url" "$status" >&2
    cat "$response_file" >&2
    rm -f "$response_file"
    exit 1
  fi

  printf '%s_OK removed route returns HTTP 404\n' "$label"
  rm -f "$response_file"
}

printf 'Checking DNS for %s...\n' "$DOMAIN"
RESOLVED_IPS="$(python3 - "$DOMAIN" <<'PY'
import socket
import sys

domain = sys.argv[1]

try:
    infos = socket.getaddrinfo(domain, None, socket.AF_INET, socket.SOCK_STREAM)
except socket.gaierror as exc:
    print(f"DNS_FAIL lookup failed for {domain}: {exc}", file=sys.stderr)
    sys.exit(1)

addresses = sorted({info[4][0] for info in infos})
if not addresses:
    print(f"DNS_FAIL no IPv4 addresses resolved for {domain}", file=sys.stderr)
    sys.exit(1)

print(' '.join(addresses))
PY
)"
printf 'Resolved IPv4: %s\n' "$RESOLVED_IPS"
case " $RESOLVED_IPS " in
  *" $EXPECTED_IP "*) printf 'DNS_OK\n' ;;
  *) printf 'DNS_FAIL expected %s\n' "$EXPECTED_IP" >&2; exit 1 ;;
esac

if command -v docker >/dev/null 2>&1; then
  printf 'Checking Docker container status...\n'
  docker ps --filter name=infinit-track-app --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
fi

printf 'Checking local backend liveness at %s...\n' "$LOCAL_LIVEZ_URL"
check_json_endpoint "$LOCAL_LIVEZ_URL" 'LOCAL_LIVEZ' 'liveness'

printf 'Checking local backend readiness at %s...\n' "$LOCAL_READINESS_URL"
check_json_endpoint "$LOCAL_READINESS_URL" 'LOCAL_READINESS' 'readiness'

if command -v nginx >/dev/null 2>&1; then
  printf 'Checking Nginx config...\n'
  sudo nginx -t
  printf 'NGINX_CONFIG_OK\n'
fi

if ! command -v ss >/dev/null 2>&1; then
  printf 'LISTENER_FAIL ss is required to verify the loopback bind\n' >&2
  exit 1
fi

printf 'Checking backend listener is loopback-only on port 3005...\n'
LISTENERS="$(ss -ltnH 'sport = :3005' 2>/dev/null || true)"
if [ -z "$LISTENERS" ]; then
  printf 'LISTENER_FAIL no listener found on port 3005\n' >&2
  exit 1
fi
INVALID_LISTENERS="$(printf '%s\n' "$LISTENERS" | awk '$4 !~ /^127\.0\.0\.1:3005$/ { print }')"
if [ -n "$INVALID_LISTENERS" ]; then
  printf 'LISTENER_FAIL every port 3005 listener must be exactly 127.0.0.1:3005\n%s\n' "$LISTENERS" >&2
  exit 1
fi
LOOPBACK_LISTENER_COUNT="$(printf '%s\n' "$LISTENERS" | awk '$4 == "127.0.0.1:3005" { count += 1 } END { print count + 0 }')"
if [ "$LOOPBACK_LISTENER_COUNT" -lt 1 ]; then
  printf 'LISTENER_FAIL expected 127.0.0.1:3005 listener\n%s\n' "$LISTENERS" >&2
  exit 1
fi
printf 'LISTENER_OK 127.0.0.1:3005\n'

printf 'Checking public HTTPS liveness at %s...\n' "$PUBLIC_LIVEZ_URL"
check_json_endpoint "$PUBLIC_LIVEZ_URL" 'PUBLIC_LIVEZ' 'liveness'

printf 'Checking public HTTPS readiness at %s...\n' "$PUBLIC_READINESS_URL"
check_json_endpoint "$PUBLIC_READINESS_URL" 'PUBLIC_READINESS' 'readiness'

printf 'Checking public docs surface is blocked for anonymous callers...\n'
check_blocked_endpoint "${PUBLIC_API_BASE_URL}/docs/" 'PUBLIC_DOCS'

printf 'Checking public raw OpenAPI contract is blocked for anonymous callers...\n'
check_blocked_endpoint "${PUBLIC_API_BASE_URL}/docs/openapi.yaml" 'PUBLIC_OPENAPI'

printf 'Checking representative protected routes reject anonymous callers...\n'
check_blocked_endpoint "${PUBLIC_API_BASE_URL}/api/auth/me" 'PUBLIC_AUTH_ME'
check_blocked_endpoint "${PUBLIC_API_BASE_URL}/api/bookings/history" 'PUBLIC_BOOKINGS_HISTORY'
check_blocked_endpoint "${PUBLIC_API_BASE_URL}/api/wfa/recommendations" 'PUBLIC_WFA_RECOMMENDATIONS'
check_blocked_endpoint "${PUBLIC_API_BASE_URL}/api/summary/reports" 'PUBLIC_SUMMARY_REPORTS'

printf 'Checking removed public auth register surface stays closed...\n'
check_removed_post_route "${PUBLIC_API_BASE_URL}/api/auth/register" 'PUBLIC_AUTH_REGISTER'
