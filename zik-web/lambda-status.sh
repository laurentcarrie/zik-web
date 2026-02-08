#!/bin/bash
# Check if band-songbook Lambda is currently running

API_URL="${API_URL:-http://localhost:8080}"

response=$(curl -s "$API_URL/api/lambda-status")

running=$(echo "$response" | jq -r '.running')
duration=$(echo "$response" | jq -r '.duration_secs // 0')
timestamp=$(echo "$response" | jq -r '.timestamp // "N/A"')

if [ "$running" = "true" ]; then
    echo "🔄 Lambda is RUNNING (${duration}s elapsed)"
    echo "   Started: $timestamp"
else
    echo "✅ Lambda is IDLE"
    echo "   Last run: $timestamp (${duration}s duration)"
fi
