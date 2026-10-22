#!/bin/bash
# XTO Pizza deploy (run ON the VPS as root). Code-only sync: never touches
# data/ (orders, offers, menu edits) or persist-images/ (uploaded photos).
set -e
rsync -a --delete --exclude data --exclude persist-images --exclude _keys --exclude cashfree.env /tmp/xto-src/ /opt/xto-pizza/
# the menu catalog travels with deploys; db.json (orders) never does
mkdir -p /opt/xto-pizza/data
cp /tmp/xto-src/data/menu.json /opt/xto-pizza/data/menu.json
# menu catalog already copied above; fresh build images into the persisted volume
mkdir -p /opt/xto-pizza/persist-images/ai /opt/xto-pizza/persist-images/pdfmenu
cp -rf /tmp/xto-src/public/images/. /opt/xto-pizza/persist-images/ || true
cd /opt/xto-pizza
docker build -q -t xto-app .
docker rm -f xto-app >/dev/null
ENVF=""; [ -f /opt/xto-pizza/cashfree.env ] && ENVF="--env-file /opt/xto-pizza/cashfree.env"
docker run -d --name xto-app --restart unless-stopped --network voxalio_default $ENVF \
  -v /opt/xto-pizza/data:/app/data -v /opt/xto-pizza/persist-images:/app/public/images xto-app
sleep 2
curl -sk -o /dev/null -w "health: %{http_code}\n" https://xto.43.166.175.196.sslip.io/healthz
