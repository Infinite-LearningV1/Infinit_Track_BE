#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DOMAIN="${DOMAIN:-localhost}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/infinite-track/backend}"
LOCAL_BASE_URL="${LOCAL_BASE_URL:-http://127.0.0.1:3005}"

build_default_public_base_url() {
    case "$DOMAIN" in
        localhost*|127.0.0.1*)
            printf 'http://%s' "$DOMAIN"
            ;;
        *)
            printf 'https://%s' "$DOMAIN"
            ;;
    esac
}

PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-$(build_default_public_base_url)}"
API_BASE="${API_BASE:-${PUBLIC_BASE_URL}/api}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

print_success() { echo -e "${GREEN}OK${NC} $1"; }
print_warning() { echo -e "${YELLOW}WARN${NC} $1"; }
print_error() { echo -e "${RED}ERROR${NC} $1"; }
print_info() { echo -e "${BLUE}INFO${NC} $1"; }

check_curl() {
    if ! command -v curl >/dev/null 2>&1; then
        print_error "curl is required but not installed"
        exit 1
    fi
}

check_python() {
    if ! command -v python3 >/dev/null 2>&1; then
        print_error "python3 is required for JSON contract verification"
        exit 1
    fi
}

check_http_contract() {
    local url="$1"
    local label="$2"
    local mode="$3"
    local response_file
    local status
    local body

    response_file="$(mktemp)"

    if ! status="$(curl --silent --show-error --output "$response_file" --write-out '%{http_code}' "$url")"; then
        rm -f "$response_file"
        print_error "$label request failed for $url"
        return 1
    fi

    if ! body="$(python3 - "$response_file" "$status" "$label" "$mode" <<'PY'
import json
import sys

response_file, status_code, label, mode = sys.argv[1:]
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
    print_info "$body"
}

test_local_liveness() {
    print_info "Testing local liveness endpoint..."
    check_http_contract "${LOCAL_BASE_URL}/livez" "Local liveness" "liveness"
}

test_local_readiness() {
    print_info "Testing local readiness endpoint..."
    check_http_contract "${LOCAL_BASE_URL}/health" "Local readiness" "readiness"
}

test_public_liveness() {
    print_info "Testing public liveness endpoint..."
    check_http_contract "${PUBLIC_BASE_URL}/livez" "Public liveness" "liveness"
}

test_public_readiness() {
    print_info "Testing public readiness endpoint..."
    check_http_contract "${PUBLIC_BASE_URL}/health" "Public readiness" "readiness"
}

test_api_documentation() {
    print_info "Testing API documentation access control..."

    local response
    response="$(curl -s -o /dev/null -w "%{http_code}" "${PUBLIC_BASE_URL}/docs/")"

    if [ "$response" = "401" ] || [ "$response" = "403" ]; then
        print_success "API documentation blocks anonymous access with HTTP $response"
        return 0
    fi

    print_error "Expected API documentation to block anonymous access with HTTP 401/403, got HTTP $response"
    return 1
}

test_auth_endpoint() {
    print_info "Testing auth endpoint..."

    local response
    response="$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API_BASE}/auth/login" -H "Content-Type: application/json" -d '{}')"

    if [ "$response" = "400" ] || [ "$response" = "401" ] || [ "$response" = "422" ]; then
        print_success "Auth endpoint rejects invalid payload as expected"
        return 0
    fi

    print_error "Auth endpoint returned unexpected HTTP $response"
    return 1
}

test_admin_operational_endpoints() {
    if [ -z "$ADMIN_TOKEN" ]; then
        print_warning "Skipping admin operational endpoint tests because no admin token was provided"
        return 0
    fi

    print_info "Testing read-only admin operational endpoints..."

    local endpoint
    local response
    local failures=0
    local admin_endpoints=(
        "/settings/operational"
        "/attendance/auto-checkout-settings"
        "/attendance/smart-config"
        "/attendance/enhanced-auto-checkout-settings"
        "/attendance/today-locations"
    )

    for endpoint in "${admin_endpoints[@]}"; do
        response="$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}${endpoint}" -H "Authorization: Bearer ${ADMIN_TOKEN}")"

        if [ "$response" = "200" ]; then
            print_success "Admin endpoint ${endpoint} returned 200"
        elif [ "$response" = "401" ] || [ "$response" = "403" ]; then
            print_error "Admin endpoint ${endpoint} rejected credentials with HTTP $response"
            failures=$((failures + 1))
        else
            print_error "Admin endpoint ${endpoint} returned unexpected HTTP $response"
            failures=$((failures + 1))
        fi
    done

    if [ "$failures" -gt 0 ]; then
        return 1
    fi

    return 0
}

test_container_runtime() {
    print_info "Testing Docker Compose runtime state..."

    if ! command -v docker >/dev/null 2>&1; then
        print_error "Docker CLI is not available on this host"
        return 1
    fi

    if [ ! -f "${DEPLOY_PATH}/docker-compose.yml" ]; then
        print_error "docker-compose.yml not found at ${DEPLOY_PATH}"
        return 1
    fi

    if ! docker compose -f "${DEPLOY_PATH}/docker-compose.yml" ps app; then
        print_error "Failed to inspect Docker Compose app service"
        return 1
    fi

    if ! docker inspect infinit-track-app >/dev/null 2>&1; then
        print_error "Container infinit-track-app is not visible from this host"
        return 1
    fi

    local container_status
    local health_status
    container_status="$(docker inspect --format '{{.State.Status}}' infinit-track-app)"
    health_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' infinit-track-app)"

    if [ "$container_status" = "running" ]; then
        print_success "Container infinit-track-app is running"
    else
        print_error "Container infinit-track-app is ${container_status}"
        return 1
    fi

    if [ "$health_status" = "healthy" ]; then
        print_success "Container health state is ${health_status}"
        return 0
    fi

    if [ "$health_status" = "none" ]; then
        print_error "Container healthcheck is missing"
        return 1
    fi

    print_error "Container health state is ${health_status}"
    return 1
}

test_ssl() {
    case "$PUBLIC_BASE_URL" in
        http://localhost*|http://127.0.0.1*)
            print_info "Skipping SSL test for local base URL"
            return 0
            ;;
    esac

    print_info "Testing public HTTPS connectivity..."

    local response
    response="$(curl -s -o /dev/null -w "%{http_code}" "${PUBLIC_BASE_URL}/livez" 2>/dev/null || echo "failed")"

    if [ "$response" = "200" ]; then
        print_success "HTTPS endpoint is reachable"
        return 0
    fi

    print_error "HTTPS connectivity check failed"
    return 1
}

test_performance() {
    print_info "Running basic response time check..."

    local start_time
    local end_time
    local response_time

    start_time="$(date +%s%N)"
    curl -s "${PUBLIC_BASE_URL}/livez" >/dev/null
    end_time="$(date +%s%N)"
    response_time=$(( (end_time - start_time) / 1000000 ))

    if [ "$response_time" -lt 500 ]; then
        print_success "Response time good: ${response_time}ms"
    elif [ "$response_time" -lt 1000 ]; then
        print_warning "Response time acceptable: ${response_time}ms"
    else
        print_error "Response time slow: ${response_time}ms"
        return 1
    fi
}

run_tests() {
    echo "Infinite Track Backend - Production Verification"
    echo "==============================================="
    echo "Local base URL : ${LOCAL_BASE_URL}"
    echo "Public base URL: ${PUBLIC_BASE_URL}"
    echo "Deploy path    : ${DEPLOY_PATH}"
    echo ""

    local failed_tests=0

    test_local_liveness || failed_tests=$((failed_tests + 1))
    test_local_readiness || failed_tests=$((failed_tests + 1))
    test_public_liveness || failed_tests=$((failed_tests + 1))
    test_public_readiness || failed_tests=$((failed_tests + 1))
    test_api_documentation || failed_tests=$((failed_tests + 1))
    test_container_runtime || failed_tests=$((failed_tests + 1))
    test_performance || failed_tests=$((failed_tests + 1))

    test_auth_endpoint || failed_tests=$((failed_tests + 1))
    test_ssl || failed_tests=$((failed_tests + 1))
    test_admin_operational_endpoints || failed_tests=$((failed_tests + 1))

    echo ""
    echo "Summary"
    echo "======="

    if [ "$failed_tests" -eq 0 ]; then
        print_success "All critical verification checks passed"
        return 0
    fi

    print_error "$failed_tests critical verification checks failed"
    return 1
}

show_help() {
    echo "Infinite Track Backend - Production Verification Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -d, --domain DOMAIN            Set public domain or host (default: localhost)"
    echo "  -l, --local-base-url URL       Set local loopback base URL (default: http://127.0.0.1:3005)"
    echo "  -u, --public-base-url URL      Set public base URL (default: derived from domain)"
    echo "  -p, --deploy-path PATH         Set droplet deploy path (default: /opt/infinite-track/backend)"
    echo "  -t, --token TOKEN              Set admin JWT token for authenticated checks"
    echo "  -h, --help                     Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0"
    echo "  $0 -d api.example.com"
    echo "  $0 -u https://api.example.com -p /opt/infinite-track/backend"
    echo ""
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--domain)
            DOMAIN="$2"
            PUBLIC_BASE_URL="$(build_default_public_base_url)"
            API_BASE="${PUBLIC_BASE_URL}/api"
            shift 2
            ;;
        -l|--local-base-url)
            LOCAL_BASE_URL="$2"
            shift 2
            ;;
        -u|--public-base-url)
            PUBLIC_BASE_URL="$2"
            API_BASE="${PUBLIC_BASE_URL}/api"
            shift 2
            ;;
        -p|--deploy-path)
            DEPLOY_PATH="$2"
            shift 2
            ;;
        -t|--token)
            ADMIN_TOKEN="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

check_curl
check_python
run_tests
