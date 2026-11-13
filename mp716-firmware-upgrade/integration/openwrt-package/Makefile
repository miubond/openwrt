include $(TOPDIR)/rules.mk

PKG_NAME:=mp716-sysupgrade
PKG_VERSION:=0.5.0
PKG_RELEASE:=1

include $(INCLUDE_DIR)/package.mk

define Package/mp716-sysupgrade
  SECTION:=base
  CATEGORY:=Base system
  TITLE:=MP716 adapter in front of official sysupgrade
endef

define Package/mp716-sysupgrade/description
  Shell adapter for an OpenWrt image built for MP716. It does not make the
  vendor firmware upgradable, and it refuses sysupgrade until platform format
  and recovery are both confirmed. It does not implement mtd writes.
endef

define Package/luci-app-mp716-upgrade
  SECTION:=luci
  CATEGORY:=LuCI
  TITLE:=MP716 upgrade status page
  DEPENDS:=+mp716-sysupgrade +luci-base
endef

define Build/Compile
endef

define Package/mp716-sysupgrade/install
	$(INSTALL_DIR) $(1)/usr/sbin $(1)/etc/mp716-upgrade $(1)/etc/init.d $(1)/usr/share/rpcd/acl.d
	$(INSTALL_BIN) ./files/usr/sbin/mp716-sysupgrade $(1)/usr/sbin/mp716-sysupgrade
	$(INSTALL_CONF) ./files/etc/mp716-upgrade/flash-gate $(1)/etc/mp716-upgrade/flash-gate
	$(INSTALL_CONF) ./files/etc/mp716-upgrade/platform $(1)/etc/mp716-upgrade/platform
	$(INSTALL_BIN) ./files/etc/init.d/mp716-sysupgrade $(1)/etc/init.d/mp716-sysupgrade
	$(INSTALL_DATA) ./files/usr/share/rpcd/acl.d/mp716-upgrade.json $(1)/usr/share/rpcd/acl.d/mp716-upgrade.json
endef

define Package/luci-app-mp716-upgrade/install
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d $(1)/www/luci-static/resources/view
	$(INSTALL_DATA) ./files/usr/share/luci/menu.d/luci-app-mp716-upgrade.json $(1)/usr/share/luci/menu.d/luci-app-mp716-upgrade.json
	$(INSTALL_DATA) ./files/www/luci-static/resources/view/mp716-upgrade.js $(1)/www/luci-static/resources/view/mp716-upgrade.js
endef

$(eval $(call BuildPackage,mp716-sysupgrade))
$(eval $(call BuildPackage,luci-app-mp716-upgrade))
