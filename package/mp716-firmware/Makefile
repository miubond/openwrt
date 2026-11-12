#
# MP716 固件校验、封包与设备信息
#
include $(TOPDIR)/rules.mk

PKG_NAME:=mp716-firmware
PKG_VERSION:=0.1.0
PKG_RELEASE:=1

PKG_MAINTAINER:=MP716 Project
PKG_LICENSE:=GPL-2.0-only

MP716_SW_VER:=014
MP716_WEB_VER:=WEB014

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

include $(INCLUDE_DIR)/package.mk
include $(INCLUDE_DIR)/host-build.mk

HOST_BUILD_DIR:=$(BUILD_DIR_HOST)/$(PKG_NAME)-$(PKG_VERSION)

define Package/mp716-firmware
  SECTION:=utils
  CATEGORY:=Base system
  TITLE:=MP716 firmware verify/apply helpers
endef

define Package/mp716-firmware/description
  mp716-fwd: 离线校验（原厂格式门控）、device-info JSON。
  apply 在审计阶段恒拒绝；刷写仅走原厂 cgi_stream streamid=4。
  主机 mp716-fwpack 仅实验用途，默认不构建（MP716_EXPERIMENTAL_FWPACK=1）。
endef

ifneq ($(MP716_EXPERIMENTAL_FWPACK),1)

define Host/Configure
	@true
endef

define Host/Compile
	@true
endef

define Host/Install
	@true
endef

else

define Host/Configure
	mkdir -p $(HOST_BUILD_DIR)
	$(CP) ./src/* $(HOST_BUILD_DIR)/
endef

define Host/Compile
	$(HOSTCC) $(HOST_CFLAGS) $(HOST_LDFLAGS) -o $(HOST_BUILD_DIR)/mp716-fwpack \
		$(HOST_BUILD_DIR)/mp716_fwpack.c \
		$(HOST_BUILD_DIR)/mp716_image.c
endef

define Host/Install
	$(INSTALL_DIR) $(STAGING_DIR_HOST)/bin
	$(CP) $(HOST_BUILD_DIR)/mp716-fwpack $(STAGING_DIR_HOST)/bin/
endef

endif

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./src/* $(PKG_BUILD_DIR)/
endef

TARGET_CFLAGS += -Wall -Wextra

define Build/Compile
	$(TARGET_CC) $(TARGET_CFLAGS) $(TARGET_LDFLAGS) -o $(PKG_BUILD_DIR)/mp716-fwd \
		$(PKG_BUILD_DIR)/mp716_fwd.c \
		$(PKG_BUILD_DIR)/mp716_image.c
endef

define Package/mp716-firmware/install
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/mp716-fwd $(1)/usr/sbin/mp716-fwd
	$(INSTALL_DIR) $(1)/etc/mp716
	echo "$(MP716_SW_VER)" > $(1)/etc/mp716/software_version
	echo "$(MP716_WEB_VER)" > $(1)/etc/mp716/webui_version
	$(INSTALL_DATA) ./files/device.json $(1)/etc/mp716/device.json
	$(INSTALL_DATA) ./files/upgrade.json $(1)/etc/mp716/upgrade.json
	$(INSTALL_DATA) ./files/vendor-format-golden.ini $(1)/etc/mp716/vendor-format-golden.ini
endef

ifneq ($(MP716_EXPERIMENTAL_FWPACK),1)
# HostBuild skipped — see mp716-fwpack-compatibility.md
else
$(eval $(call HostBuild))
endif
$(eval $(call BuildPackage,mp716-firmware))
