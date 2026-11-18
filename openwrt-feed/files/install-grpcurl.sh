#!/bin/sh
# install-grpcurl — install starlink-dish (and remove legacy grpcurl)
#
# Called by APK postinst, or run manually on the router:
#   /usr/bin/install-grpcurl
#
# Order of preference:
#   1. Binary bundled in the APK (/usr/libexec/starlink-dish-aarch64) — no network needed
#   2. Download from GitHub (retried) — fallback for non-bundled cases

DISH_PATH="/usr/bin/starlink-dish"
BUNDLED="/usr/libexec/starlink-dish-aarch64"
DISH_RELEASE="https://github.com/bigmalloy/starlink-panel/releases/latest/download/starlink-dish"
ARCH=$(uname -m)

[ -x /usr/bin/grpcurl ] && { echo "Removing grpcurl..."; rm -f /usr/bin/grpcurl; }

if [ "$ARCH" != "aarch64" ]; then
    echo "starlink-dish: pre-built binary only available for aarch64 (this is $ARCH); skipping."
    exit 0
fi

# 1. Bundled copy (always refresh so upgrades update the binary)
if [ -f "$BUNDLED" ]; then
    if cp "$BUNDLED" "${DISH_PATH}.tmp" && chmod 755 "${DISH_PATH}.tmp" && mv "${DISH_PATH}.tmp" "$DISH_PATH"; then
        echo "Installed bundled starlink-dish to $DISH_PATH"
        exit 0
    fi
    rm -f "${DISH_PATH}.tmp"
    echo "Warning: could not install bundled starlink-dish, trying download..." >&2
fi

[ -x "$DISH_PATH" ] && { echo "starlink-dish already installed at $DISH_PATH."; exit 0; }

# 2. Download with retries
i=1
while [ "$i" -le 5 ]; do
    echo "Downloading starlink-dish (attempt $i/5)..."
    if wget -T 20 -O "${DISH_PATH}.tmp" "$DISH_RELEASE" && [ -s "${DISH_PATH}.tmp" ]; then
        chmod 755 "${DISH_PATH}.tmp" && mv "${DISH_PATH}.tmp" "$DISH_PATH"
        echo "Installed: $DISH_PATH"
        exit 0
    fi
    rm -f "${DISH_PATH}.tmp"
    i=$((i + 1))
    sleep 5
done

echo "ERROR: starlink-dish download failed. Check WAN connectivity and that" >&2
echo "       ca-bundle + libustream-mbedtls are installed, then re-run /usr/bin/install-grpcurl." >&2
exit 1
