#!/bin/bash
set -e

REPO_DIR="/opt/texas-poker"
SERVICE_NAME="texas-poker"
BRANCH="main"
ENV_FILE="$REPO_DIR/server/.env"
DATA_DIR="$REPO_DIR/data"

echo "=========================================="
echo "  Texas Poker - Deploy Script"
echo "=========================================="

cd "$REPO_DIR"

echo ""
echo "[1/6] Pulling latest code from GitHub..."
git fetch origin "$BRANCH"
LOCAL_HASH=$(git rev-parse HEAD)
REMOTE_HASH=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL_HASH" = "$REMOTE_HASH" ]; then
    echo "  Already up to date. No changes to deploy."
    echo "  Use --force to redeploy anyway."
    if [ "$1" != "--force" ]; then
        exit 0
    fi
    echo "  --force flag detected, redeploying..."
fi

if [ -f "$ENV_FILE" ]; then
    ENV_BACKUP=$(cat "$ENV_FILE")
fi

git reset --hard "origin/$BRANCH"
echo "  Updated to: $(git log --oneline -1)"

if [ -n "$ENV_BACKUP" ]; then
    echo "$ENV_BACKUP" > "$ENV_FILE"
fi

mkdir -p "$DATA_DIR"

echo ""
echo "[2/6] Building server..."
cd "$REPO_DIR/server"
npm install
npx tsc
npm prune --omit=dev
echo "  Done."

echo ""
echo "[3/6] Building client..."
cd "$REPO_DIR/client"
npm install
NODE_OPTIONS="--max-old-space-size=512" npm run build
echo "  Done."

echo ""
echo "[4/6] Deploying web files..."
rm -rf "$REPO_DIR/web"
cp -r "$REPO_DIR/client/dist" "$REPO_DIR/web"
echo "  Done."

echo ""
echo "[5/6] Updating configs..."
if [ -f "$REPO_DIR/deploy/nginx/texas-poker" ]; then
    cp "$REPO_DIR/deploy/nginx/texas-poker" /etc/nginx/sites-available/texas-poker
    nginx -t && systemctl reload nginx
    echo "  Nginx config updated."
fi
if [ -f "$REPO_DIR/deploy/systemd/texas-poker.service" ]; then
    cp "$REPO_DIR/deploy/systemd/texas-poker.service" /etc/systemd/system/texas-poker.service
    systemctl daemon-reload
    echo "  Systemd service updated."
fi

echo ""
echo "[6/6] Restarting service..."
systemctl restart "$SERVICE_NAME"
sleep 2

if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "  Service started successfully."
else
    echo "  ERROR: Service failed to start!"
    systemctl status "$SERVICE_NAME" --no-pager
    exit 1
fi

echo ""
echo "=========================================="
echo "  Deploy complete!"
echo "  Version: $(git log --oneline -1)"
echo "  Time: $(date)"
echo "=========================================="
