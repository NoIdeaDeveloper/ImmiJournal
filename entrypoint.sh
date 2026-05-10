#!/bin/bash
set -e

PUID=${PUID:-99}
PGID=${PGID:-100}

# Validate that PUID and PGID are numeric to prevent groupadd/useradd errors
if ! [[ "$PUID" =~ ^[0-9]+$ ]]; then
    echo "ERROR: PUID must be a numeric value, got: '$PUID'" >&2
    exit 1
fi
if ! [[ "$PGID" =~ ^[0-9]+$ ]]; then
    echo "ERROR: PGID must be a numeric value, got: '$PGID'" >&2
    exit 1
fi

echo "Starting ImmiJournal with PUID=${PUID}, PGID=${PGID}"

# Create group with specified GID if it doesn't exist, otherwise update existing
if ! getent group appuser > /dev/null 2>&1; then
    groupadd -g "$PGID" appuser
else
    groupmod -o -g "$PGID" appuser
fi

# Create user with specified UID if it doesn't exist, otherwise update existing
if ! getent passwd appuser > /dev/null 2>&1; then
    useradd -u "$PUID" -g "$PGID" -M -s /bin/false appuser
else
    usermod -o -u "$PUID" -g "$PGID" appuser
fi

# Ensure /data is owned by the configured user
chown -R appuser:appuser /data

exec gosu appuser uvicorn backend.main:app --host 0.0.0.0 --port 8000 --log-level debug --access-log --use-colors
