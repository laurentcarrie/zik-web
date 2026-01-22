#!/bin/bash

# Get a song from the database by title and author
# Usage: ./get-song.sh <title> [author]

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <title> [author]"
    echo "  title  - Song title (required)"
    echo "  author - Artist name (optional)"
    exit 1
fi

TITLE="$1"
AUTHOR="${2:-}"

API_URL="https://zik-laurent.netlify.app/api/songs"

# Fetch all songs and filter by title (and optionally author)
if [ -n "$AUTHOR" ]; then
    curl -k -s "$API_URL" | jq -r --arg t "$TITLE" --arg a "$AUTHOR" \
        '.songs[] | select(.title == $t and .artist == $a)'
else
    curl -k -s "$API_URL" | jq -r --arg t "$TITLE" \
        '.songs[] | select(.title == $t)'
fi
