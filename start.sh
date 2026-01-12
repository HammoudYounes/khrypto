#!/bin/bash

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed."
    exit 1
fi

# Function to cleanup background processes on exit
cleanup() {
    echo "Stopping all services..."
    pkill -P $$
    exit
}

# Trap SIGINT and SIGTERM arguments
trap cleanup SIGINT SIGTERM EXIT

echo "=========================================="
echo "    Starting PS8 Microservices Project    "
echo "=========================================="

# Start Gateway Service
echo "[Gateway] Checking dependencies..."
(
    cd services/gateway
    if [ ! -d "node_modules" ]; then
        echo "[Gateway] Installing dependencies..."
        npm install --silent
    fi
    echo "[Gateway] Starting service on port 8000..."
    node index.js
) &

# Start Files Service
echo "[Files] Checking dependencies..."
(
    cd services/files
    if [ ! -d "node_modules" ]; then
        echo "[Files] Installing dependencies..."
        npm install --silent
    fi
    echo "[Files] Starting service on port 8001..."
    node index.js
) &

# Wait for all background processes
wait
