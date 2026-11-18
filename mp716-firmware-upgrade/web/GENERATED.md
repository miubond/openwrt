# Generated frontend snapshot

Canonical source: `D:\goweb\src\openwrt_system`.

Edit and commit that project, then run `python3 scripts/sync-web-reference.py --source <path>` from mp716-firmware-upgrade. Do not hand-edit this snapshot.

Native build: `npm run build:openwrt -- --outDir dist`. The Web-only workflow creates a standalone ZIP without compiling OpenWrt or accessing a router.

Compatibility and validation limits: see `NATIVE-WEB.md`. Full native VPN/system/diagnostic services are still being integrated; do not overwrite the current router UI with this UNVERIFIED bundle.
