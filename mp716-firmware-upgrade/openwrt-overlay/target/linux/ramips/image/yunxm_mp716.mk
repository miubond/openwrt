# TEST profile for OpenWrt v25.12.6. BROKEN keeps it out of a normal build.
# Selecting it later may produce an initramfs or sysupgrade image. That image
# is still TEST until serial recovery and the pending hardware nodes are confirmed.
# Do not build this profile from an MT7628 EVB image or from factory-mtd-from-device.bin.

define Device/yunxm_mp716
  IMAGE_SIZE := 7872k
  DEVICE_VENDOR := YUNXM
  DEVICE_MODEL := MP716
  DEVICE_VARIANT := TEST
  SOC := mt7628an
  BROKEN := y
  DEFAULT := n
  DEVICE_PACKAGES := mp716-sysupgrade -kmod-mt7603 -wpad-basic-mbedtls
  SUPPORTED_DEVICES := yunxm,mp716
endef
TARGET_DEVICES += yunxm_mp716
