include $(TOPDIR)/rules.mk

PKG_NAME:=mp716-firmware-upgrade
PKG_VERSION:=0.4.0
PKG_RELEASE:=1

include $(INCLUDE_DIR)/package.mk

define Package/mp716-firmware-upgrade
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=MP716 signed upgrade worker and CGI
  DEPENDS:=
endef

define Package/mp716-firmware-upgrade/description
  Offline-built upgrade worker. The package does not install allow-flash-upgrade,
  does not modify HUAYI CGI, and ships auth.mode as deny.
endef

define Package/mp716-firmware-upgrade/install
	$(INSTALL_DIR) $(1)/usr/sbin $(1)/www/cgi-bin $(1)/etc/mp716-upgrade $(1)/tmp
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/mp716-upgraded $(1)/usr/sbin/mp716-upgraded
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/mp716-upgrade.cgi $(1)/www/cgi-bin/mp716-upgrade.cgi
	$(INSTALL_CONF) ./files/auth.mode $(1)/etc/mp716-upgrade/auth.mode
endef

$(eval $(call BuildPackage,mp716-firmware-upgrade))
