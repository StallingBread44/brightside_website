#!/bin/bash
# Helper script to start a local development server to bypass CORS module restrictions
cd "$(dirname "$0")"

echo "Starting local web server on port 8000..."
echo "Press Ctrl+C to stop the server."

# Try to open the browser automatically
if command -v open > /dev/null; then
    # Give the server a moment to start before opening the browser
    (sleep 1 && open "http://localhost:8000/game.html") &
fi

python3 -m http.server 8000
