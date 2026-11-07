#!/bin/bash
set -euo pipefail
umask 077

SOURCE=${XTO_DEPLOY_SOURCE:-/tmp/xto-src}
ROOT=${XTO_DEPLOY_ROOT:-/opt/xto-pizza}
NETWORK=${XTO_DOCKER_NETWORK:-bridge}
HEALTH_URL=${XTO_HEALTH_URL:-https://xtopizza.in/healthz}
BACKUPS=${XTO_BACKUP_ROOT:-/opt/xto-backups}
STAMP=$(date +%Y%m%d-%H%M%S)
ROLLBACK="xto-app-rollback-$STAMP"
IMAGE="xto-app:release-$STAMP"

test -f "$SOURCE/server.js"
test -f "$SOURCE/petpooja.js"
test -f "$SOURCE/auth.js"
docker network inspect "$NETWORK" >/dev/null
docker inspect xto-app >/dev/null
test -f "$ROOT/data/menu.json"
mkdir -p "$BACKUPS"
tar -czf "$BACKUPS/code-$STAMP.tar.gz" -C "$ROOT" server.js petpooja.js auth.js Dockerfile scripts
rsync -a --delete --exclude data --exclude persist-images --exclude _keys --exclude .git --exclude "*.env" --exclude "*.env.*" "$SOURCE/" "$ROOT/"
mkdir -p "$ROOT/persist-images"
cp -R "$SOURCE/public/images/." "$ROOT/persist-images/"
cd "$ROOT"
docker build -q -t "$IMAGE" .
docker run --rm --network none "$IMAGE" node --check server.js
docker run --rm --network none "$IMAGE" node --check petpooja.js
docker run --rm --network none "$IMAGE" node --check auth.js

ENV_FILES=()
for CONFIG in cashfree.env petpooja.env auth.env; do
  if [ -f "$ROOT/$CONFIG" ]; then ENV_FILES+=(--env-file "$ROOT/$CONFIG"); fi
done

restore() {
  docker rm -f xto-app >/dev/null 2>&1 || true
  docker rename "$ROLLBACK" xto-app
  docker start xto-app >/dev/null
  printf "Deployment failed; previous container restored.\n" >&2
}

docker rename xto-app "$ROLLBACK"
docker stop --time 30 "$ROLLBACK" >/dev/null
if ! docker run -d --name xto-app --restart unless-stopped --network "$NETWORK" -p 127.0.0.1:7788:7788 "${ENV_FILES[@]}" -v "$ROOT/data:/app/data" -v "$ROOT/persist-images:/app/public/images" "$IMAGE"; then
  restore
  exit 1
fi

HEALTHY=0
for ATTEMPT in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:7788/healthz >/dev/null; then HEALTHY=1; break; fi
  sleep 1
done
if [ "$HEALTHY" != 1 ] || ! curl -fsS --max-time 15 "$HEALTH_URL" >/dev/null; then
  restore
  exit 1
fi
docker update --restart=no "$ROLLBACK" >/dev/null
printf "Deployment verified locally and at %s. Rollback container: %s\n" "$HEALTH_URL" "$ROLLBACK"
