#!/bin/bash

# Infinite Track Backend - Health Check
# Works with Docker and Kubernetes environments

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() { echo -e "${BLUE}=== $1 ===${NC}"; }
print_success() { echo -e "${GREEN}[OK] $1${NC}"; }
print_warning() { echo -e "${YELLOW}[WARN] $1${NC}"; }
print_error() { echo -e "${RED}[FAIL] $1${NC}"; }

APP_URL="${APP_URL:-http://localhost:${PORT:-3005}}"
LIVEZ_URL="${LIVEZ_URL:-${APP_URL}/livez}"
READINESS_URL="${READINESS_URL:-${APP_URL}/health}"
CRITICAL_FAILURES=0
HTTP_PROBE_DEPS_READY=true

record_failure() {
    CRITICAL_FAILURES=$((CRITICAL_FAILURES + 1))
}

ensure_http_probe_dependencies() {
    if ! command -v curl &> /dev/null; then
        print_error "curl is required to run health probes"
        HTTP_PROBE_DEPS_READY=false
    fi

    if ! command -v python3 &> /dev/null; then
        print_error "python3 is required to validate health JSON contracts"
        HTTP_PROBE_DEPS_READY=false
    fi

    if [ "$HTTP_PROBE_DEPS_READY" = false ]; then
        record_failure
        return 1
    fi

    return 0
}

check_http_contract() {
    local url="$1"
    local label="$2"
    local mode="$3"
    local response_file
    local status
    local body

    response_file="$(mktemp)"

    if ! status="$(curl --silent --show-error --output "$response_file" --write-out "%{http_code}" "$url")"; then
        rm -f "$response_file"
        print_error "$label probe failed for $url"
        return 1
    fi

    if ! body="$(python3 - "$response_file" "$status" "$mode" <<'PY'
import json
import sys

response_file, status_code, mode = sys.argv[1:]
status_code = int(status_code)

with open(response_file, 'r', encoding='utf-8') as handle:
    raw_body = handle.read()

try:
    data = json.loads(raw_body)
except json.JSONDecodeError as exc:
    print(f"invalid JSON: {exc}", file=sys.stderr)
    print(raw_body, file=sys.stderr)
    sys.exit(1)

if status_code != 200:
    print(f"unexpected HTTP {status_code}", file=sys.stderr)
    print(json.dumps(data, ensure_ascii=False), file=sys.stderr)
    sys.exit(1)

if data.get('status') != 'OK':
    print("unexpected status field", file=sys.stderr)
    print(json.dumps(data, ensure_ascii=False), file=sys.stderr)
    sys.exit(1)

if mode == 'readiness':
    if data.get('ready') is not True:
        print("readiness flag is not true", file=sys.stderr)
        print(json.dumps(data, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
    if not isinstance(data.get('components'), dict):
        print("readiness components missing", file=sys.stderr)
        print(json.dumps(data, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
    if not isinstance(data.get('missing'), list):
        print("readiness missing array absent", file=sys.stderr)
        print(json.dumps(data, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

print(json.dumps(data, ensure_ascii=False))
PY
)"; then
        rm -f "$response_file"
        print_error "$label returned an invalid health contract"
        return 1
    fi

    rm -f "$response_file"
    print_success "$label passed"
    echo "  $body"
    return 0
}

echo "Infinite Track Backend - Health Check"
echo "======================================"
echo "Timestamp: $(date)"
echo "URL: $APP_URL"
echo ""

# 1. API Health
print_header "API HEALTH"
if ensure_http_probe_dependencies; then
    if ! check_http_contract "$LIVEZ_URL" "API liveness" "liveness"; then
        record_failure
    fi

    if ! check_http_contract "$READINESS_URL" "API readiness" "readiness"; then
        record_failure
    fi
fi

# 2. Environment Detection
print_header "ENVIRONMENT"
if [ -f "/.dockerenv" ]; then
    print_success "Running inside Docker container"
elif [ -n "$KUBERNETES_SERVICE_HOST" ]; then
    print_success "Running inside Kubernetes"
    echo "  Namespace: ${POD_NAMESPACE:-unknown}"
    echo "  Pod: ${HOSTNAME:-unknown}"
else
    print_warning "Running on host (not containerized)"
fi

# 3. System Resources
print_header "SYSTEM RESOURCES"

# Memory
if command -v free &> /dev/null; then
    MEM_TOTAL=$(free -m | awk '/Mem:/ {print $2}')
    MEM_USED=$(free -m | awk '/Mem:/ {print $3}')
    MEM_PERCENT=$((MEM_USED * 100 / MEM_TOTAL))
    if [ "$MEM_PERCENT" -lt 80 ]; then
        print_success "Memory: ${MEM_USED}MB / ${MEM_TOTAL}MB (${MEM_PERCENT}%)"
    else
        print_warning "Memory: ${MEM_USED}MB / ${MEM_TOTAL}MB (${MEM_PERCENT}%)"
    fi
fi

# Disk
if command -v df &> /dev/null; then
    DISK_PERCENT=$(df -h / 2>/dev/null | awk 'NR==2 {gsub("%",""); print $5}')
    if [ -n "$DISK_PERCENT" ] && [ "$DISK_PERCENT" -lt 80 ]; then
        print_success "Disk usage: ${DISK_PERCENT}%"
    elif [ -n "$DISK_PERCENT" ]; then
        print_warning "Disk usage: ${DISK_PERCENT}%"
    fi
fi

# 4. Docker (if available)
if command -v docker &> /dev/null; then
    print_header "DOCKER CONTAINERS"
    docker ps --filter "name=infinit-track" --format "  {{.Names}}: {{.Status}}" 2>/dev/null
fi

# 5. Kubernetes (if kubectl available)
if command -v kubectl &> /dev/null; then
    print_header "KUBERNETES PODS"
    kubectl get pods -n infinit-track --no-headers 2>/dev/null | while read -r line; do
        echo "  $line"
    done
fi

echo ""
if [ "$CRITICAL_FAILURES" -gt 0 ]; then
    print_error "Health check failed with ${CRITICAL_FAILURES} critical issue(s)."
    exit 1
fi

echo "Health check complete."