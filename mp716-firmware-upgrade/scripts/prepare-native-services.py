"""Use OpenWrt's offline disabled-service argument for the MP716 managed VPN.

This patches two image delivery call sites and source/package dependencies in
the pinned build checkout.
No service is stopped or disabled on a running router, and stock init scripts and
their UCI configurations remain intact in the generated image.

The pinned gmpdh plugin links target libgmp.a but omits its source build
dependency. Add gmp to the source dependencies without selecting runtime libgmp.
Its downstream plugin constructor must use the strongSwan 6 version-export
macro, otherwise the loader rejects gmpdh before registering any DH groups.
Deliver the SHA256 and XCBC kernel algorithms advertised by the default ESP
proposal; userspace strongswan-mod-sha2 does not provide the kernel CryptoAPI.
"""
import argparse
from pathlib import Path

CALLS={
 'package/Makefile':'$(call prepare_rootfs,$(TARGET_DIR),$(TOPDIR)/files)',
 'include/image.mk':'$(call prepare_rootfs,$(mkfs_cur_target_dir),$(TOPDIR)/files)',
}
STRONGSWAN_MAKEFILE='feeds/packages/net/strongswan/Makefile'
STRONGSWAN_GMPDH_PATCH='feeds/packages/net/strongswan/patches/0904-gmpdh-Plugin-that-implements-gmp-DH-functions-in-an-.patch'
STRONGSWAN_HASH='e518e34e159514f4c6ba80d1f926cb151e0dd4e3a1d94213171234b8b9ae6f55'
GMPDH_SOURCE_MARKER='+++ b/src/libstrongswan/plugins/gmpdh/gmpdh_plugin.c\n'
GMPDH_CONSTRUCTOR_FROM='+plugin_t *gmpdh_plugin_create()\n'
GMPDH_CONSTRUCTOR_TO='+PLUGIN_DEFINE(gmpdh)\n'
CRYPTO_DEPENDS_FROM='\t+kmod-crypto-sha1 \\\n\t+kmod-ipsec +kmod-ipsec4 +IPV6:kmod-ipsec6\n'
CRYPTO_DEPENDS_TO='\t+kmod-crypto-sha1 \\\n\t+kmod-crypto-sha256 +kmod-crypto-xcbc \\\n\t+kmod-ipsec +kmod-ipsec4 +IPV6:kmod-ipsec6\n'

def replace_pinned(body,old,new,label):
    if body.count(new)==1 and body.count(old)==0:return body
    if body.count(old)!=1 or body.count(new)!=0:raise ValueError('Unexpected pinned '+label)
    return body.replace(old,new)
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
    p=tree/STRONGSWAN_MAKEFILE;body=p.read_text();original=body
    if 'PKG_VERSION:=6.0.7\n' not in body or 'PKG_HASH:='+STRONGSWAN_HASH+'\n' not in body:
        raise ValueError('Unexpected pinned strongswan source version or hash')
    old='PKG_BUILD_DEPENDS:=python3/host\n'
    new='PKG_BUILD_DEPENDS:=gmp python3/host\n'
    body=replace_pinned(body,old,new,'strongswan build dependencies')
    body=replace_pinned(body,CRYPTO_DEPENDS_FROM,CRYPTO_DEPENDS_TO,'strongswan crypto dependencies')
    if body!=original:updates.append((p,body))
    p=tree/STRONGSWAN_GMPDH_PATCH;body=p.read_text();original=body
    if body.count(GMPDH_SOURCE_MARKER)!=1:
        raise ValueError('Unexpected pinned strongswan gmpdh source patch')
    body=replace_pinned(body,GMPDH_CONSTRUCTOR_FROM,GMPDH_CONSTRUCTOR_TO,'strongswan gmpdh plugin ABI')
    if body!=original:updates.append((p,body))
    for p,body in updates:p.write_text(body,encoding='utf-8',newline='\n')
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('tree',type=Path);args=p.parse_args()
    prepare(args.tree)
