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

APP_URL="${APP_URL:-http://localhost:${PORT:-3000}}"

echo "Infinite Track Backend - Health Check"
echo "======================================"
echo "Timestamp: $(date)"
echo "URL: $APP_URL"
echo ""

# 1. API Health
print_header "API HEALTH"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$APP_URL/health" 2>/dev/null)
if [ "$RESPONSE" = "200" ]; then
    print_success "API is healthy (HTTP $RESPONSE)"
else
    print_error "API is not responding (HTTP $RESPONSE)"
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
echo "Health check complete."