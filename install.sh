#!/bin/sh
# install.sh — deploy luci-app-starlink directly to the router via scp+ssh.
#
# Usage (from this directory, on your dev machine):
#   sh install.sh [router_ip]
#
# Default router IP: 192.168.1.1
# Requires: ssh root@<router> passwordless login (or will prompt).

set -e

ROUTER="${1:-192.168.1.1}"
SRC="$(cd "$(dirname "$0")" && pwd)/root"

echo "===================================================="
echo " luci-app-starlink installer"
echo " Target: root@${ROUTER}"
echo "===================================================="
echo ""

# Verify source tree
for f in \
    usr/libexec/rpcd/luci.starlink \
    usr/share/luci/menu.d/luci-app-starlink.json \
    usr/share/rpcd/acl.d/luci-app-starlink.json \
    usr/bin/starlink-setup \
    www/luci-static/resources/view/starlink/status.js
do
    if [ ! -f "${SRC}/${f}" ]; then
        echo "ERROR: missing ${SRC}/${f}"
        exit 1
    fi
done

echo "[1/4] Creating remote directories..."
ssh "root@${ROUTER}" \
    "mkdir -p \
        /usr/bin \
        /usr/libexec/rpcd \
        /usr/share/luci/menu.d \
        /usr/share/rpcd/acl.d \
        /www/luci-static/resources/view/starlink"

echo "[2/4] Copying files..."

# rpcd backend — must be executable
scp -O "${SRC}/usr/libexec/rpcd/luci.starlink" \
       "root@${ROUTER}:/usr/libexec/rpcd/luci.starlink"
ssh "root@${ROUTER}" "chmod 755 /usr/libexec/rpcd/luci.starlink"

# Setup script — must be executable
scp -O "${SRC}/usr/bin/starlink-setup" \
       "root@${ROUTER}:/usr/bin/starlink-setup"
ssh "root@${ROUTER}" "chmod 755 /usr/bin/starlink-setup"

# Menu entry
scp -O "${SRC}/usr/share/luci/menu.d/luci-app-starlink.json" \
       "root@${ROUTER}:/usr/share/luci/menu.d/luci-app-starlink.json"

# ACL
scp -O "${SRC}/usr/share/rpcd/acl.d/luci-app-starlink.json" \
       "root@${ROUTER}:/usr/share/rpcd/acl.d/luci-app-starlink.json"

# JS view — use overlay path so writes survive overlayfs correctly
ssh "root@${ROUTER}" \
    "mkdir -p /overlay/upper/www/luci-static/resources/view/starlink"
scp -O "${SRC}/www/luci-static/resources/view/starlink/status.js" \
       "root@${ROUTER}:/overlay/upper/www/luci-static/resources/view/starlink/status.js"

echo "[3/4] Restarting services..."
ssh "root@${ROUTER}" "
    /etc/init.d/rpcd restart   2>/dev/null && echo '  rpcd      OK' || echo '  rpcd      FAILED'
    rm -rf /tmp/luci-modulecache /tmp/luci-indexcache 2>/dev/null; true
    /etc/init.d/uhttpd restart 2>/dev/null && echo '  uhttpd    OK' || echo '  uhttpd    FAILED'
"

echo "[4/4] Verifying install..."
ssh "root@${ROUTER}" "
    echo ''
    echo '--- rpcd backend ---'
    /usr/libexec/rpcd/luci.starlink list && echo ''
    echo '--- JS view ---'
    ls -lh /www/luci-static/resources/view/starlink/status.js 2>/dev/null \
        || ls -lh /overlay/upper/www/luci-static/resources/view/starlink/status.js
    echo ''
    echo '--- grpcurl (optional, for dish telemetry) ---'
    command -v grpcurl && grpcurl --version 2>&1 || echo '  not installed'
"

echo ""
echo "===================================================="
echo " Done."
echo " Open: http://${ROUTER}/cgi-bin/luci/admin/network/starlink"
echo ""
echo " For dish telemetry, install grpcurl (linux/arm64):"
echo "   https://github.com/fullstorydev/grpcurl/releases"
echo "   scp -O grpcurl root@${ROUTER}:/usr/bin/grpcurl"
echo "   ssh root@${ROUTER} chmod +x /usr/bin/grpcurl"
echo "===================================================="
