#!/bin/bash

# Extract song info from song.yml files in nested directories
# Usage: ./extract-songs.sh <directory> [output.yml]

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <directory> [output.yml]"
    echo "  directory  - Directory to search for song.yml files"
    echo "  output.yml - Output file (default: songs.yml)"
    exit 1
fi

SEARCH_DIR="$1"
OUTPUT_FILE="${2:-songs.yml}"

if [ ! -d "$SEARCH_DIR" ]; then
    echo "Error: Directory '$SEARCH_DIR' does not exist"
    exit 1
fi

# Check if yq is installed
if ! command -v yq &> /dev/null; then
    echo "Error: yq is not installed. Install with: brew install yq"
    exit 1
fi

# Initialize empty songs array
echo "songs: []" > "$OUTPUT_FILE"

# Find all song.yml files and extract data
find "$SEARCH_DIR" -name "song.yml" -type f | sort | while read -r file; do
    title=$(yq '.info.title // ""' "$file")
    author=$(yq '.info.author // ""' "$file")
    tempo=$(yq '.info.tempo // ""' "$file")

    # Only add if we found at least a title
    if [ -n "$title" ] && [ "$title" != "null" ] && [ "$title" != "" ]; then
        # Build the song object and append to the array using yq
        yq -i ".songs += [{\"title\": \"$title\", \"author\": \"$author\", \"tempo\": $tempo, \"source\": \"$file\"}]" "$OUTPUT_FILE"
    fi
done

# Count results
count=$(yq '.songs | length' "$OUTPUT_FILE")
echo "Extracted $count songs to $OUTPUT_FILE"
