include $(TOPDIR)/rules.mk

PKG_NAME:=mp716-sysupgrade
PKG_VERSION:=0.5.0
PKG_RELEASE:=1
MP716_SOURCE_DIR ?= $(abspath $(CURDIR)/../..)
MP716_IMAGE_PROFILE ?=
PKG_FILE_DEPENDS:=$(MP716_SOURCE_DIR)/device $(MP716_SOURCE_DIR)/shared $(MP716_SOURCE_DIR)/integration/ram-web/dhcp-discover.c $(MP716_IMAGE_PROFILE)

include $(INCLUDE_DIR)/package.mk

define Package/mp716-sysupgrade
  SECTION:=base
  CATEGORY:=Base system
  TITLE:=MP716 adapter and signed image checker for official sysupgrade
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

define Build/Prepare
	$(INSTALL_DIR) $(PKG_BUILD_DIR)/device
	$(CP) $(MP716_SOURCE_DIR)/device/Makefile $(MP716_SOURCE_DIR)/device/src \
		$(MP716_SOURCE_DIR)/device/include $(MP716_SOURCE_DIR)/device/third_party $(PKG_BUILD_DIR)/device/
	$(CP) $(MP716_SOURCE_DIR)/shared $(PKG_BUILD_DIR)/
	$(CP) $(MP716_SOURCE_DIR)/integration/ram-web/dhcp-discover.c $(PKG_BUILD_DIR)/
endef

define Build/Compile
	$(MAKE) -C $(PKG_BUILD_DIR)/device CC="$(TARGET_CC)" \
		CFLAGS_EXTRA="$(TARGET_CFLAGS) $(TARGET_LDFLAGS)" build/mp716-upgraded
	$(TARGET_CC) $(TARGET_CFLAGS) $(TARGET_LDFLAGS) -Wall -Wextra -Werror -o $(PKG_BUILD_DIR)/mp716-dhcp-discover $(PKG_BUILD_DIR)/dhcp-discover.c
endef

define Package/mp716-sysupgrade/conffiles
/etc/mp716-upgrade/device.profile
/etc/mp716-upgrade/state
/etc/mp716-upgrade/history.log
endef

define Package/mp716-sysupgrade/install
	$(INSTALL_DIR) $(1)/usr/sbin $(1)/etc/mp716-upgrade $(1)/etc/init.d $(1)/usr/share/rpcd/acl.d
	$(INSTALL_BIN) ./files/usr/sbin/mp716-sysupgrade $(1)/usr/sbin/mp716-sysupgrade
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/device/build/mp716-upgraded $(1)/usr/sbin/mp716-upgraded
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/mp716-dhcp-discover $(1)/usr/sbin/mp716-dhcp-discover
	$(INSTALL_CONF) ./files/etc/mp716-upgrade/flash-gate $(1)/etc/mp716-upgrade/flash-gate
	$(INSTALL_CONF) ./files/etc/mp716-upgrade/platform $(1)/etc/mp716-upgrade/platform
	$(if $(strip $(MP716_IMAGE_PROFILE)),$(INSTALL_CONF) "$(MP716_IMAGE_PROFILE)" $(1)/etc/mp716-upgrade/device.profile)
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
