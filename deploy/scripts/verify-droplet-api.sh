#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-api.infinite-track.tech}"
EXPECTED_IP="${EXPECTED_IP:-168.144.33.33}"
LOCAL_HEALTH_URL="${LOCAL_HEALTH_URL:-http://127.0.0.1:3005/health}"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-https://${DOMAIN}/health}"

printf 'Checking DNS for %s...\n' "$DOMAIN"
RESOLVED_IPS="$(getent ahostsv4 "$DOMAIN" | awk '{print $1}' | sort -u | tr '\n' ' ')"
printf 'Resolved IPv4: %s\n' "$RESOLVED_IPS"
case " $RESOLVED_IPS " in
  *" $EXPECTED_IP "*) printf 'DNS_OK\n' ;;
  *) printf 'DNS_FAIL expected %s\n' "$EXPECTED_IP" >&2; exit 1 ;;
esac

if command -v docker >/dev/null 2>&1; then
  printf 'Checking Docker container status...\n'
  docker ps --filter name=infinit-track-app --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
fi

printf 'Checking local backend health at %s...\n' "$LOCAL_HEALTH_URL"
curl --fail --silent --show-error "$LOCAL_HEALTH_URL"
printf '\nLOCAL_HEALTH_OK\n'

if command -v nginx >/dev/null 2>&1; then
  printf 'Checking Nginx config...\n'
  sudo nginx -t
  printf 'NGINX_CONFIG_OK\n'
fi

printf 'Checking public HTTPS health at %s...\n' "$PUBLIC_HEALTH_URL"
curl --fail --silent --show-error "$PUBLIC_HEALTH_URL"
printf '\nPUBLIC_HEALTH_OK\n'
