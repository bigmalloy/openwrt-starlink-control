# luci-app-starlink — OpenWrt package Makefile
# Build with: make package/luci-app-starlink/compile V=s
# Or use install.sh for direct deployment without a full buildroot.

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-starlink
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_MAINTAINER:=bigmalloy
PKG_LICENSE:=MIT

LUCI_TITLE:=Starlink Status Dashboard
LUCI_DESCRIPTION:=LuCI dashboard for Starlink dish telemetry (gRPC), IPv6 \
	connectivity, network quality, and router configuration status. \
	Targets GL-iNet Beryl AX (MT3000) / OpenWrt 25.x.
LUCI_DEPENDS:=+rpcd +luci-base +jsonfilter
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

define Package/$(PKG_NAME)/install
	# rpcd backend
	$(INSTALL_DIR)  $(1)/usr/libexec/rpcd
	$(INSTALL_BIN)  ./root/usr/libexec/rpcd/luci.starlink \
	                $(1)/usr/libexec/rpcd/luci.starlink

	# LuCI menu entry
	$(INSTALL_DIR)  $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-starlink.json \
	                $(1)/usr/share/luci/menu.d/luci-app-starlink.json

	# rpcd ACL
	$(INSTALL_DIR)  $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-starlink.json \
	                $(1)/usr/share/rpcd/acl.d/luci-app-starlink.json

	# JS view
	$(INSTALL_DIR)  $(1)/www/luci-static/resources/view/starlink
	$(INSTALL_DATA) ./root/www/luci-static/resources/view/starlink/status.js \
	                $(1)/www/luci-static/resources/view/starlink/status.js
endef

$(eval $(call BuildPackage,$(PKG_NAME)))
