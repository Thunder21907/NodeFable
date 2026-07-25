#!/bin/bash

# Exit on any error
set -e

# 1. Activate virtual environment
if [ -f venv/bin/activate ]; then
    echo "Activating virtual environment..."
    source venv/bin/activate
else
    echo "Error: Virtual environment (venv) not found. Please run 'python3 -m venv venv' first."
    exit 1
fi

# 2. Start the FastAPI server in the background
# We use port 8005 to avoid common conflicts with other services
echo "Starting FastAPI server on http://localhost:8005..."
uvicorn backend.main:app --host 127.0.0.1 --port 8005 &
UVICORN_PID=$!

# 3. Wait for the server to start up
echo "Waiting for server to initialize (approx. 3 seconds)..."
sleep 3

# 4. Attempt to open the browser automatically
echo "Opening editor at http://localhost:8005/editor..."
if command -v xdg-open >/dev/null 2>&1; then
    xdg-open http://localhost:8005/editor || echo "Could not open browser via xdg-open."
elif command -v open >/dev/null 2>&1; then
    open http://localhost:8005/editor || echo "Could not open browser via 'open'."
else
    echo "Automatic browser opening is not supported. Please visit http://localhost:8005/editor manually."
fi

# 5. Handle shutdown gracefully when the user presses Ctrl+C (SIGINT)
trap 'echo -e "\nShutting down server..."; kill $UVICORN_PID; exit' INT SIGTERM

# Wait for uvicorn to finish running in the background
wait
