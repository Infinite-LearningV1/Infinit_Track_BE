#!/bin/bash

# 📚 Infinite Track Backend - API Documentation Test
# This script tests the API documentation and validates endpoints

set -e

# Configuration
API_BASE="http://localhost:3005"
DOCS_ENDPOINT="$API_BASE/docs"
HEALTH_ENDPOINT="$API_BASE/health"
OPENAPI_SPEC="$API_BASE/docs/openapi.yaml"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() { echo -e "${BLUE}=== $1 ===${NC}"; }
print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_error() { echo -e "${RED}❌ $1${NC}"; }
print_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }

echo "📚 Infinite Track Backend - API Documentation Test"
echo "=================================================="
echo "Testing API documentation endpoints and functionality"
echo ""

# Test 1: Health Check
print_header "HEALTH CHECK"
print_info "Testing health endpoint..."

if curl -s -f "$HEALTH_ENDPOINT" > /dev/null; then
    HEALTH_RESPONSE=$(curl -s "$HEALTH_ENDPOINT")
    if echo "$HEALTH_RESPONSE" | grep -q '"status":"OK"'; then
        print_success "Health endpoint is working correctly"
        echo "  Response: $(echo $HEALTH_RESPONSE | jq -r '.status') at $(echo $HEALTH_RESPONSE | jq -r '.timestamp')"
    else
        print_warning "Health endpoint responding but unexpected format"
    fi
else
    print_error "Health endpoint is not accessible"
    echo "  Make sure the server is running on $API_BASE"
    exit 1
fi

# Test 2: Swagger UI Documentation
print_header "SWAGGER UI DOCUMENTATION"
print_info "Testing Swagger UI endpoint..."

if curl -s -f "$DOCS_ENDPOINT" > /dev/null; then
    DOCS_CONTENT=$(curl -s "$DOCS_ENDPOINT")
    if echo "$DOCS_CONTENT" | grep -q "swagger-ui"; then
        print_success "Swagger UI is accessible and loading"
        print_info "Access documentation at: $DOCS_ENDPOINT"
    else
        print_warning "Docs endpoint accessible but may not be Swagger UI"
    fi
else
    print_error "Swagger UI documentation is not accessible"
    print_info "Check if swagger-ui-express is properly configured"
fi

# Test 3: OpenAPI Specification
print_header "OPENAPI SPECIFICATION"
print_info "Testing OpenAPI specification file..."

# Check if openapi.yaml exists locally
if [ -f "docs/openapi.yaml" ]; then
    print_success "OpenAPI specification file exists locally"
    
    # Validate YAML syntax
    if command -v python3 &> /dev/null; then
        if python3 -c "import yaml; yaml.safe_load(open('docs/openapi.yaml'))" 2>/dev/null; then
            print_success "OpenAPI YAML syntax is valid"
        else
            print_error "OpenAPI YAML syntax is invalid"
        fi
    else
        print_info "Python3 not available, skipping YAML validation"
    fi
    
    # Check for required sections
    if grep -q "openapi: 3.0" docs/openapi.yaml; then
        print_success "OpenAPI 3.0 specification detected"
    else
        print_warning "OpenAPI version not found or incorrect"
    fi
    
    if grep -q "paths:" docs/openapi.yaml; then
        ENDPOINT_COUNT=$(grep -c "^  /" docs/openapi.yaml || echo "0")
        print_success "API endpoints documented: $ENDPOINT_COUNT endpoints"
    else
        print_error "No API paths found in specification"
    fi
    
    if grep -q "components:" docs/openapi.yaml; then
        print_success "Components/schemas section found"
    else
        print_warning "No components/schemas section found"
    fi
    
else
    print_error "OpenAPI specification file not found at docs/openapi.yaml"
fi

# Test 4: API Endpoint Validation
print_header "API ENDPOINT VALIDATION"
print_info "Testing core API endpoints..."

# Test auth endpoints (should be accessible without auth)
print_info "Testing authentication endpoints..."

# Test login endpoint (should return validation error without data)
LOGIN_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/api/auth/login" -H "Content-Type: application/json" || echo "failed")

case "$LOGIN_RESPONSE" in
    400|422)
        print_success "Login endpoint accessible (validation error expected)"
        ;;
    200)
        print_warning "Login endpoint returned 200 (unexpected without credentials)"
        ;;
    *)
        print_error "Login endpoint failed (HTTP $LOGIN_RESPONSE)"
        ;;
esac

# Test protected endpoints (should return 401 without auth)
print_info "Testing protected endpoints..."

PROTECTED_ENDPOINTS=(
    "/api/attendance/history"
    "/api/users"
    "/api/bookings"
    "/api/wfa/recommendations"
)

for endpoint in "${PROTECTED_ENDPOINTS[@]}"; do
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE$endpoint" || echo "failed")
    
    if [ "$RESPONSE" = "401" ]; then
        print_success "Protected endpoint $endpoint correctly requires authentication"
    elif [ "$RESPONSE" = "400" ]; then
        print_warning "Protected endpoint $endpoint returned 400 (may require query parameters)"
    else
        print_warning "Protected endpoint $endpoint returned HTTP $RESPONSE"
    fi
done

# Test 5: Documentation Content Validation
print_header "DOCUMENTATION CONTENT VALIDATION"
print_info "Validating documentation completeness..."

if [ -f "docs/openapi.yaml" ]; then
    # Check for important endpoints
    REQUIRED_ENDPOINTS=(
        "/api/auth/login"
        "/api/attendance/check-in"
        "/api/attendance/checkout"
        "/api/bookings"
        "/api/wfa/recommendations"
        "/api/settings/operational"
        "/health"
    )
    
    MISSING_ENDPOINTS=()
    for endpoint in "${REQUIRED_ENDPOINTS[@]}"; do
        if grep -q "$endpoint:" docs/openapi.yaml; then
            print_success "Required endpoint documented: $endpoint"
        else
            MISSING_ENDPOINTS+=("$endpoint")
            print_error "Missing endpoint: $endpoint"
        fi
    done
    
    if [ ${#MISSING_ENDPOINTS[@]} -eq 0 ]; then
        print_success "All required endpoints are documented"
    else
        print_error "${#MISSING_ENDPOINTS[@]} required endpoints are missing"
    fi
    
    # Check for important components
    REQUIRED_COMPONENTS=(
        "User"
        "Attendance"
        "Booking"
        "WFARecommendation"
        "OperationalSettings"
    )
    
    MISSING_COMPONENTS=()
    for component in "${REQUIRED_COMPONENTS[@]}"; do
        if grep -q "$component:" docs/openapi.yaml; then
            print_success "Required component documented: $component"
        else
            MISSING_COMPONENTS+=("$component")
            print_error "Missing component: $component"
        fi
    done
    
    if [ ${#MISSING_COMPONENTS[@]} -eq 0 ]; then
        print_success "All required components are documented"
    else
        print_error "${#MISSING_COMPONENTS[@]} required components are missing"
    fi
    
    # Check for security schemes
    if grep -q "bearerAuth:" docs/openapi.yaml; then
        print_success "Bearer authentication scheme documented"
    else
        print_error "Bearer authentication scheme not found"
    fi
    
    # Check for examples
    EXAMPLE_COUNT=$(grep -c "example:" docs/openapi.yaml || echo "0")
    if [ "$EXAMPLE_COUNT" -gt "50" ]; then
        print_success "Documentation includes comprehensive examples ($EXAMPLE_COUNT examples)"
    elif [ "$EXAMPLE_COUNT" -gt "20" ]; then
        print_warning "Documentation includes some examples ($EXAMPLE_COUNT examples)"
    else
        print_error "Documentation lacks sufficient examples ($EXAMPLE_COUNT examples)"
    fi
fi

# Test 6: Additional Documentation Files
print_header "ADDITIONAL DOCUMENTATION"
print_info "Checking for additional documentation files..."

ADDITIONAL_DOCS=(
    "docs/API_DOCUMENTATION.md"
    "docs/PRODUCTION_GO_LIVE_GUIDE.md"
    "docs/MANUAL_JOB_TRIGGER_API.md"
    "README.md"
)

for doc in "${ADDITIONAL_DOCS[@]}"; do
    if [ -f "$doc" ]; then
        print_success "Additional documentation found: $doc"
    else
        print_warning "Additional documentation missing: $doc"
    fi
done

# Test 7: Interactive Testing
print_header "INTERACTIVE TESTING GUIDE"
print_info "Manual testing recommendations..."

echo "📝 MANUAL TESTING STEPS:"
echo ""
echo "1. 🌐 Open Swagger UI in browser:"
echo "   $DOCS_ENDPOINT"
echo ""
echo "2. 🔐 Test Authentication:"
echo "   - Use 'Try it out' on POST /api/auth/login"
echo "   - Copy JWT token from response"
echo "   - Click 'Authorize' button and paste token"
echo ""
echo "3. 📱 Test Core Endpoints:"
echo "   - GET /api/auth/me (should return your user data)"
echo "   - GET /api/attendance/history (should return attendance data)"
echo "   - GET /api/roles (should return available roles)"
echo ""
echo "4. 🧪 Test Advanced Features:"
echo "   - GET /api/wfa/recommendations (with lat/lng parameters)"
echo "   - GET /api/settings/operational (Admin/Management only)"
echo "   - GET /api/discipline/config (Admin/Management only)"
echo ""

# Summary
print_header "TEST SUMMARY"

TOTAL_TESTS=7
PASSED_TESTS=0

# Count passed tests (simplified)
if curl -s -f "$HEALTH_ENDPOINT" > /dev/null; then ((PASSED_TESTS++)); fi
if curl -s -f "$DOCS_ENDPOINT" > /dev/null; then ((PASSED_TESTS++)); fi
if [ -f "docs/openapi.yaml" ]; then ((PASSED_TESTS++)); fi
if [ "$LOGIN_RESPONSE" = "400" ] || [ "$LOGIN_RESPONSE" = "422" ]; then ((PASSED_TESTS++)); fi
if [ ${#MISSING_ENDPOINTS[@]} -eq 0 ]; then ((PASSED_TESTS++)); fi
if [ ${#MISSING_COMPONENTS[@]} -eq 0 ]; then ((PASSED_TESTS++)); fi
if [ -f "docs/API_DOCUMENTATION.md" ]; then ((PASSED_TESTS++)); fi

PASS_PERCENTAGE=$((PASSED_TESTS * 100 / TOTAL_TESTS))

echo ""
echo "🎯 DOCUMENTATION TEST RESULTS: $PASSED_TESTS/$TOTAL_TESTS tests passed ($PASS_PERCENTAGE%)"

if [ "$PASS_PERCENTAGE" -ge 85 ]; then
    print_success "API Documentation is EXCELLENT ✨"
    echo ""
    echo "🚀 READY FOR:"
    echo "  ✅ Development team usage"
    echo "  ✅ Frontend integration"
    echo "  ✅ Third-party integrations"
    echo "  ✅ Production deployment"
elif [ "$PASS_PERCENTAGE" -ge 70 ]; then
    print_warning "API Documentation is GOOD but needs minor improvements"
else
    print_error "API Documentation needs significant improvements"
fi

echo ""
print_info "📚 ACCESS YOUR API DOCUMENTATION:"
echo "  🌐 Interactive: $DOCS_ENDPOINT"
echo "  📄 Markdown: docs/API_DOCUMENTATION.md"
echo "  📋 OpenAPI: docs/openapi.yaml"
echo ""

echo "Documentation test completed at $(date)"
