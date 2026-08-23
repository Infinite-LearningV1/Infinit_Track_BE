#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-}"
IMAGE_TAG="${2:-}"

if [[ -z "$ENV_FILE" || ! -f "$ENV_FILE" ]]; then
  echo "Environment file does not exist: $ENV_FILE" >&2
  exit 1
fi

if [[ ! "$IMAGE_TAG" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Backend image tag must be a 40-character lowercase Git SHA." >&2
  exit 1
fi

TEMP_FILE="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
trap 'rm -f "$TEMP_FILE"' EXIT

cp -p "$ENV_FILE" "$TEMP_FILE"
awk -v image_tag="$IMAGE_TAG" '
  BEGIN { persisted = 0 }
  /^BACKEND_IMAGE_TAG=/ {
    if (!persisted) {
      print "BACKEND_IMAGE_TAG=" image_tag
      persisted = 1
    }
    next
  }
  { print }
  END {
    if (!persisted) {
      print "BACKEND_IMAGE_TAG=" image_tag
    }
  }
' "$ENV_FILE" > "$TEMP_FILE"

mv "$TEMP_FILE" "$ENV_FILE"
trap - EXIT

grep -qx "BACKEND_IMAGE_TAG=${IMAGE_TAG}" "$ENV_FILE"
