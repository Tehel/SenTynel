#!/bin/sh
set -e

IMAGE="sentinel"
REMOTE="ubuntu@92.243.27.149"
REMOTE_DIR="~/sentinel"
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
