#!/bin/bash

# Function to kill all background processes (child jobs) when the script exits
cleanup() {
    echo "Stopping all services..."
    kill $(jobs -p)
}

# Trap the EXIT signal (happens on Ctrl+C) to run cleanup
trap cleanup SIGINT EXIT

echo "Starting Laser Chess Architecture..."

# 1. Start Gateway Service (Entry Point -> Port 8000)
echo "[Gateway] Launching..."
(cd services/gateway && node index.js) &

# 2. Start File Service (Frontend Assets -> Port 8001)
echo "[Files] Launching..."
(cd services/files &&  node index.js) &

# 3. Start Engine Service (Game Logic -> Port 8002)
echo "[Engine] Launching..."
(cd services/engine && node index.js) &

# Wait ensures the script stays running so the background services don't close
wait