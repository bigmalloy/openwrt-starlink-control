#!/bin/sh
# install-grpcurl — install starlink-dish and remove grpcurl if present
#
# Called automatically by APK postinst, or run manually on the router:
#   /usr/bin/install-grpcurl

set -e

ARCH=$(uname -m)
DISH_PATH="/usr/bin/starlink-dish"
DISH_RELEASE="https://github.com/bigmalloy/starlink-panel/releases/latest/download/starlink-dish"

# ── remove grpcurl if present ─────────────────────────────────────────────────

if [ -x /usr/bin/grpcurl ]; then
    echo "Removing grpcurl..."
    rm -f /usr/bin/grpcurl
fi

# ── already installed? ────────────────────────────────────────────────────────

if [ -x "$DISH_PATH" ]; then
    echo "starlink-dish already installed at $DISH_PATH."
    exit 0
fi

# ── install starlink-dish ─────────────────────────────────────────────────────

case "$ARCH" in
    aarch64) ;;
    *)
        echo "starlink-dish: pre-built binary only available for aarch64 (this is $ARCH); skipping."
        exit 0
        ;;
esac

echo "Downloading starlink-dish..."
if wget -q -O "${DISH_PATH}.tmp" "$DISH_RELEASE" 2>/dev/null; then
    mv "${DISH_PATH}.tmp" "$DISH_PATH"
    chmod +x "$DISH_PATH"
    echo "Installed: $DISH_PATH"
else
    rm -f "${DISH_PATH}.tmp"
    echo "Warning: starlink-dish download failed. Run /usr/bin/install-grpcurl manually."
    exit 1
fi
