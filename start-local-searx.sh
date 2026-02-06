#!/bin/bash
# Script to start the local SearXNG instance

# Ensure we are in the project root or adjust paths accordingly
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEARX_DIR="$PROJECT_DIR/searxng"
VENV_DIR="$PROJECT_DIR/searxng-venv"

# Check if venv exists
if [ ! -d "$VENV_DIR" ]; then
    echo "Virtual environment not found at $VENV_DIR"
    exit 1
fi

# Activate venv
source "$VENV_DIR/bin/activate"

# Navigate to searxng directory so it finds its local configs properly
cd "$SEARX_DIR"

echo "Starting SearXNG on port 8080..."
# Run the webapp
python -m searx.webapp
