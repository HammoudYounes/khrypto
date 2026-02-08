#!/bin/bash

# Configuration
CONTAINER_NAME="khrypto"
DB_NAME="khrypto"
COLLECTION_NAME="users"

echo "🧹 Clearing all users from ${DB_NAME}.${COLLECTION_NAME}..."

# Execute the delete command inside the Docker container
docker exec -it $CONTAINER_NAME mongosh $DB_NAME --quiet --eval "db.${COLLECTION_NAME}.deleteMany({})"

if [ $? -eq 0 ]; then
    echo "✅ Success: Collection cleared."
else
    echo "❌ Error: Failed to clear collection. Is the container running?"
fi