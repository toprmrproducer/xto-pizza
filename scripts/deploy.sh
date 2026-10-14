#!/bin/bash
# XTO Pizza deploy (run ON the VPS as root). Code-only sync: never touches
# data/ (orders, offers, menu edits) or persist-images/ (uploaded photos).
set -e
rsync -a --delete --exclude data --exclude persist-images --exclude _keys /tmp/xto-src/ /opt/xto-pizza/
# menu catalog updates travel with the repo, orders do not
cp /tmp/xto-src/data/menu.json /opt/xto-pizza/data/menu.json
# fresh build images into the persisted volume
mkdir -p /opt/xto-pizza/persist-images/ai /opt/xto-pizza/persist-images/pdfmenu
cp -rf /tmp/xto-src/public/images/ai/. /opt/xto-pizza/persist-images/ai/ || true
cp -rf /tmp/xto-src/public/images/pdfmenu/. /opt/xto-pizza/persist-images/pdfmenu/ || true
cd /opt/xto-pizza
docker build -q -t xto-app .
docker rm -f xto-app >/dev/null
docker run -d --name xto-app --restart unless-stopped --network voxalio_default \
  -v /opt/xto-pizza/data:/app/data -v /opt/xto-pizza/persist-images:/app/public/images xto-app
sleep 2
curl -sk -o /dev/null -w "health: %{http_code}\n" https://xto.43.166.175.196.sslip.io/healthz
