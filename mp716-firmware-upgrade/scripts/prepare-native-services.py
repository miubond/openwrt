"""Use OpenWrt's offline disabled-service argument for the MP716 managed VPN.

This modifies only two image delivery call sites in the pinned build checkout.
No service is stopped or disabled on a running router, and stock init scripts and
their UCI configurations remain intact in the generated image.
"""
import argparse
from pathlib import Path

CALLS={
 'package/Makefile':'$(call prepare_rootfs,$(TARGET_DIR),$(TOPDIR)/files)',
 'include/image.mk':'$(call prepare_rootfs,$(mkfs_cur_target_dir),$(TOPDIR)/files)',
}
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
    for p,body in updates:p.write_text(body,encoding='utf-8',newline='\n')
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('tree',type=Path);args=p.parse_args()
    prepare(args.tree)
