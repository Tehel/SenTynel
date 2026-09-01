#!/bin/sh
set -e

# Deployment target is private: it lives in .env at the repo root, which is
# gitignored. Copy .env.example to .env and fill it in. Nothing in this file
# may name a host, a login or a path on the remote.
ENV_FILE="$(dirname "$0")/../.env"
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

IMAGE="${DEPLOY_IMAGE:-sentinel}"
REMOTE="${DEPLOY_REMOTE:?set DEPLOY_REMOTE in .env (see .env.example)}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-~/sentinel}"
ARCHIVE="/tmp/${IMAGE}.tar.gz"

echo "Saving image..."
docker save "$IMAGE" | gzip > "$ARCHIVE"
echo "Saved to $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

echo "Transferring to $REMOTE..."
scp "$ARCHIVE" "${REMOTE}:~/"

echo "Loading image on remote..."
ssh "$REMOTE" "docker load < ~/${IMAGE}.tar.gz && rm ~/${IMAGE}.tar.gz"

echo "Restarting compose stack on remote..."
ssh "$REMOTE" "cd ${REMOTE_DIR} && docker-compose down && docker-compose up -d"

rm "$ARCHIVE"
echo "Done."
