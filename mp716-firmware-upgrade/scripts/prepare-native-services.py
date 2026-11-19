"""Use OpenWrt's offline disabled-service argument for the MP716 managed VPN.

This patches two image delivery call sites and one source build dependency in
the pinned build checkout.
No service is stopped or disabled on a running router, and stock init scripts and
their UCI configurations remain intact in the generated image.

The pinned gmpdh plugin links target libgmp.a but omits its source build
dependency. Add gmp to the source dependencies without selecting runtime libgmp.
"""
import argparse
from pathlib import Path

CALLS={
 'package/Makefile':'$(call prepare_rootfs,$(TARGET_DIR),$(TOPDIR)/files)',
 'include/image.mk':'$(call prepare_rootfs,$(mkfs_cur_target_dir),$(TOPDIR)/files)',
}
STRONGSWAN_MAKEFILE='feeds/packages/net/strongswan/Makefile'
STRONGSWAN_HASH='e518e34e159514f4c6ba80d1f926cb151e0dd4e3a1d94213171234b8b9ae6f55'
def prepare(tree):
    rootfs=(tree/'include/rootfs.mk').read_text()
    if ' $(3) ' not in rootfs or '$$script disable' not in rootfs:
        raise ValueError('Pinned rootfs service-disable API is missing')
    updates=[]
    for name,old in CALLS.items():
        p=tree/name;body=p.read_text();new=old[:-1]+',$(MP716_DISABLED_SERVICES))'
        if body.count(new)==1:continue
        if body.count(old)!=1:raise ValueError('Unexpected pinned rootfs call count: '+name)
        updates.append((p,body.replace(old,new)))
    p=tree/STRONGSWAN_MAKEFILE;body=p.read_text()
    if 'PKG_VERSION:=6.0.7\n' not in body or 'PKG_HASH:='+STRONGSWAN_HASH+'\n' not in body:
        raise ValueError('Unexpected pinned strongswan source version or hash')
    old='PKG_BUILD_DEPENDS:=python3/host\n'
    new='PKG_BUILD_DEPENDS:=gmp python3/host\n'
    if body.count(new)!=1:
        if body.count(old)!=1:raise ValueError('Unexpected pinned strongswan build dependencies')
        updates.append((p,body.replace(old,new)))
    for p,body in updates:p.write_text(body,encoding='utf-8',newline='\n')
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('tree',type=Path);args=p.parse_args()
    prepare(args.tree)
