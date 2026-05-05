#!/bin/bash

# 🧪 Infinite Track Backend - Production Testing Script
# This script tests all critical functionality in production

set -e

# Configuration
DOMAIN="localhost:3005"  # Change to your production domain
ADMIN_TOKEN=""  # Set your admin JWT token
API_BASE="http://$DOMAIN/api"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_error() { echo -e "${RED}❌ $1${NC}"; }
print_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }

# Function to check if curl is available
check_curl() {
    if ! command -v curl &> /dev/null; then
        print_error "curl is required but not installed"
        exit 1
    fi
}

# Function to make API request
api_request() {
    local method=$1
    local endpoint=$2
    local data=$3
    local curl_args=(-s -X "$method" "$API_BASE$endpoint")

    if [ -n "$ADMIN_TOKEN" ]; then
        curl_args+=(-H "Authorization: Bearer $ADMIN_TOKEN")
    fi

    if [ -n "$data" ]; then
        curl_args+=(-H "Content-Type: application/json" -d "$data")
    fi

    curl "${curl_args[@]}"
}

# Test health endpoint
test_health() {
    print_info "Testing health endpoint..."
    
    local response=$(curl -s -o /dev/null -w "%{http_code}" "http://$DOMAIN/health")
    
    if [ "$response" = "200" ]; then
        print_success "Health check passed"
        return 0
    else
        print_error "Health check failed (HTTP $response)"
        return 1
    fi
}

# Test basic API endpoints
test_basic_endpoints() {
    print_info "Testing basic API endpoints..."
    
    # Test root endpoint
    local response=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/")
    if [ "$response" = "200" ] || [ "$response" = "404" ]; then
        print_success "API base endpoint accessible"
    else
        print_error "API base endpoint failed (HTTP $response)"
    fi
    
    # Test authentication endpoint
    response=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/auth/login" -H "Content-Type: application/json" -d "{}")
    if [ "$response" = "400" ] || [ "$response" = "422" ]; then
        print_success "Auth endpoint accessible (expected validation error)"
    else
        print_warning "Auth endpoint returned HTTP $response"
    fi
}

# Test read-only admin operational endpoints (requires admin token)
test_admin_operational_endpoints() {
    if [ -z "$ADMIN_TOKEN" ]; then
        print_warning "Skipping admin operational endpoint tests (no admin token provided)"
        return 0
    fi

    print_info "Testing read-only admin operational endpoints..."

    ADMIN_ENDPOINTS=(
        "/settings/operational"
        "/attendance/auto-checkout-settings"
        "/attendance/smart-config"
        "/attendance/enhanced-auto-checkout-settings"
        "/attendance/today-locations"
    )

    for endpoint in "${ADMIN_ENDPOINTS[@]}"; do
        local response=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE$endpoint" -H "Authorization: Bearer $ADMIN_TOKEN")

        if [ "$response" = "200" ]; then
            print_success "Admin endpoint $endpoint working"
        elif [ "$response" = "401" ] || [ "$response" = "403" ]; then
            print_warning "Admin endpoint $endpoint rejected credentials (HTTP $response)"
        else
            print_warning "Admin endpoint $endpoint returned HTTP $response"
        fi
    done
}

# Test database connectivity
test_database() {
    print_info "Testing database connectivity..."
    
    # Test attendance endpoint (basic DB read)
    local response=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/attendance")
    
    if [ "$response" = "200" ] || [ "$response" = "401" ]; then
        print_success "Database connectivity working (attendance endpoint accessible)"
    else
        print_error "Database connectivity issues (HTTP $response)"
    fi
}

# Test PM2 status
test_pm2_status() {
    print_info "Testing PM2 status..."
    
    if command -v pm2 &> /dev/null; then
        local pm2_status=$(pm2 jlist 2>/dev/null | jq -r '.[0].pm2_env.status' 2>/dev/null || echo "unknown")
        
        if [ "$pm2_status" = "online" ]; then
            print_success "PM2 process is online"
        else
            print_warning "PM2 status: $pm2_status"
        fi
        
        # Check for recent restarts
        local restarts=$(pm2 jlist 2>/dev/null | jq -r '.[0].pm2_env.restart_time' 2>/dev/null || echo "0")
        if [ "$restarts" -lt "5" ]; then
            print_success "PM2 restart count is healthy ($restarts restarts)"
        else
            print_warning "High PM2 restart count: $restarts"
        fi
    else
        print_warning "PM2 not available for testing"
    fi
}

# Test log files
test_logs() {
    print_info "Testing log files..."
    
    # Check if log directory exists
    if [ -d "logs" ]; then
        print_success "Log directory exists"
        
        # Check for recent logs
        local recent_logs=$(find logs -name "*.log" -mtime -1 | wc -l)
        if [ "$recent_logs" -gt "0" ]; then
            print_success "Recent log files found ($recent_logs files)"
        else
            print_warning "No recent log files found"
        fi
        
        # Check for errors in recent logs
        local error_count=$(find logs -name "*.log" -mtime -1 -exec grep -i "error" {} \; 2>/dev/null | wc -l)
        if [ "$error_count" -eq "0" ]; then
            print_success "No errors in recent logs"
        else
            print_warning "Found $error_count error entries in recent logs"
        fi
    else
        print_warning "Log directory not found"
    fi
}

# Test SSL/HTTPS (if applicable)
test_ssl() {
    if [[ $DOMAIN == *"localhost"* ]] || [[ $DOMAIN == *"127.0.0.1"* ]]; then
        print_info "Skipping SSL test (localhost deployment)"
        return 0
    fi
    
    print_info "Testing SSL certificate..."
    
    local ssl_response=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/health" 2>/dev/null || echo "failed")
    
    if [ "$ssl_response" = "200" ]; then
        print_success "SSL certificate working"
    else
        print_warning "SSL test failed or HTTPS not configured"
    fi
}

# Performance test
test_performance() {
    print_info "Running basic performance test..."
    
    local start_time=$(date +%s%N)
    curl -s "http://$DOMAIN/health" > /dev/null
    local end_time=$(date +%s%N)
    
    local response_time=$(( (end_time - start_time) / 1000000 ))
    
    if [ "$response_time" -lt "500" ]; then
        print_success "Response time good: ${response_time}ms"
    elif [ "$response_time" -lt "1000" ]; then
        print_warning "Response time acceptable: ${response_time}ms"
    else
        print_error "Response time slow: ${response_time}ms"
    fi
}

# Main test function
run_tests() {
    echo "🧪 Infinite Track Backend - Production Testing"
    echo "=============================================="
    echo "Testing domain: $DOMAIN"
    echo ""
    
    local failed_tests=0
    
    # Core functionality tests
    test_health || ((failed_tests++))
    test_basic_endpoints || ((failed_tests++))
    test_database || ((failed_tests++))
    
    # System tests
    test_pm2_status
    test_logs
    test_performance
    
    # Security tests
    test_ssl
    
    # Admin functionality tests
    test_admin_operational_endpoints
    
    echo ""
    echo "🎯 Test Summary"
    echo "==============="
    
    if [ "$failed_tests" -eq "0" ]; then
        print_success "All critical tests passed! 🎉"
        echo ""
        print_info "Production system appears to be working correctly"
        print_info "Monitor logs and performance for ongoing stability"
    else
        print_error "$failed_tests critical tests failed"
        echo ""
        print_info "Please review failed tests and fix issues before going live"
    fi
    
    echo ""
    print_info "Additional manual tests recommended:"
    echo "  - Load testing with realistic traffic"
    echo "  - Full user workflow testing"
    echo "  - Database backup/restore testing"
    echo "  - Failover scenario testing"
}

# Help function
show_help() {
    echo "🧪 Infinite Track Backend - Production Testing Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -d, --domain DOMAIN    Set the domain to test (default: localhost:3005)"
    echo "  -t, --token TOKEN      Set admin JWT token for authenticated tests"
    echo "  -h, --help            Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                                    # Test localhost"
    echo "  $0 -d your-domain.com               # Test production domain"
    echo "  $0 -d localhost:3005 -t eyJ...      # Test with admin token"
    echo ""
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--domain)
            DOMAIN="$2"
            API_BASE="http://$DOMAIN/api"
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

# Main execution
check_curl
run_tests
