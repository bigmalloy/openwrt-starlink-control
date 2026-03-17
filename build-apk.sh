#!/bin/sh
# build-apk.sh — builds luci-app-starlink_<ver>_all.apk
# No SDK needed: pure tar+gzip, APK v2 format (control + data streams).

set -e

PKG_NAME="luci-app-starlink"
PKG_VER="1.0.0-r6"
PKG_ARCH="all"
PKG_DESC="LuCI Starlink Status Dashboard"
PKG_URL="https://github.com/bigmalloy/starlink-openwrt"
PKG_DEPENDS="rpcd luci-base jsonfilter"
BUILD_DATE=$(date +%s)
PACKAGER="bigmalloy"

SRC="$(cd "$(dirname "$0")/root" && pwd)"
OUT="$(cd "$(dirname "$0")" && pwd)/${PKG_NAME}_${PKG_VER}_${PKG_ARCH}.apk"
WORK=$(mktemp -d)

trap 'rm -rf "$WORK"' EXIT

echo "Building ${PKG_NAME}_${PKG_VER}_${PKG_ARCH}.apk ..."

# ── Stage package files ───────────────────────────────────────────────────────

PKG="$WORK/data"
mkdir -p \
    "$PKG/usr/bin" \
    "$PKG/usr/libexec/rpcd" \
    "$PKG/usr/share/luci/menu.d" \
    "$PKG/usr/share/rpcd/acl.d" \
    "$PKG/www/luci-static/resources/view/starlink"

install -m 755 "$SRC/usr/libexec/rpcd/luci.starlink" \
               "$PKG/usr/libexec/rpcd/luci.starlink"
install -m 755 "$(dirname "$0")/install-grpcurl.sh" \
               "$PKG/usr/bin/install-grpcurl"
install -m 755 "$SRC/usr/bin/starlink-setup" \
               "$PKG/usr/bin/starlink-setup"
install -m 644 "$SRC/usr/share/luci/menu.d/luci-app-starlink.json" \
               "$PKG/usr/share/luci/menu.d/luci-app-starlink.json"
install -m 644 "$SRC/usr/share/rpcd/acl.d/luci-app-starlink.json" \
               "$PKG/usr/share/rpcd/acl.d/luci-app-starlink.json"
install -m 644 "$SRC/www/luci-static/resources/view/starlink/status.js" \
               "$PKG/www/luci-static/resources/view/starlink/status.js"

# ── Installed size ────────────────────────────────────────────────────────────

SIZE=$(du -sb "$PKG" | awk '{print $1}')

# ── .PKGINFO ──────────────────────────────────────────────────────────────────

cat > "$WORK/.PKGINFO" <<EOF
pkgname = ${PKG_NAME}
pkgver = ${PKG_VER}
arch = ${PKG_ARCH}
size = ${SIZE}
pkgdesc = ${PKG_DESC}
url = ${PKG_URL}
builddate = ${BUILD_DATE}
packager = ${PACKAGER}
EOF
for dep in $PKG_DEPENDS; do
    printf 'depend = %s\n' "$dep" >> "$WORK/.PKGINFO"
done

# ── .post-install ─────────────────────────────────────────────────────────────

cat > "$WORK/.post-install" <<'SCRIPT'
#!/bin/sh
/etc/init.d/rpcd restart 2>/dev/null || true
rm -rf /tmp/luci-modulecache /tmp/luci-indexcache 2>/dev/null || true
/etc/init.d/uhttpd restart 2>/dev/null || true
SCRIPT
chmod 755 "$WORK/.post-install"

# ── control.tar.gz ────────────────────────────────────────────────────────────

(cd "$WORK" && tar -czf "$WORK/control.tar.gz" .PKGINFO .post-install)

# ── data.tar.gz ───────────────────────────────────────────────────────────────

(cd "$PKG" && tar -czf "$WORK/data.tar.gz" .)

# ── Concatenate → .apk ───────────────────────────────────────────────────────

cat "$WORK/control.tar.gz" "$WORK/data.tar.gz" > "$OUT"

SIZE_APK=$(du -sh "$OUT" | awk '{print $1}')
echo "Done: $(basename "$OUT")  (${SIZE_APK})"
echo ""
echo "Install on router:"
echo "  scp -O $(basename "$OUT") root@192.168.1.1:/tmp/"
echo "  ssh root@192.168.1.1 'apk add --allow-untrusted /tmp/$(basename "$OUT")'"
