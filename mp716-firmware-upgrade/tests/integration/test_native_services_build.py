import importlib.util,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('native_services',ROOT/'scripts/prepare-native-services.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
GMPDH_PATCH_FIXTURE='--- /dev/null\n+++ b/src/libstrongswan/plugins/gmpdh/gmpdh_plugin.c\n@@ -0,0 +1,7 @@\n+PLUGIN_PROVIDE(KE, MODP_2048_BIT),\n+PLUGIN_DEPENDS(RNG, RNG_STRONG),\n+/* see header file */\n+plugin_t *gmpdh_plugin_create()\n+{\n+ return &this->public.plugin;\n+}\n'
class NativeServiceBuildTests(unittest.TestCase):
 def fixture(self):
  self.tmp=tempfile.TemporaryDirectory(dir=ROOT/'build');self.addCleanup(self.tmp.cleanup);root=Path(self.tmp.name)
  (root/'include').mkdir();(root/'package').mkdir()
  (root/'include/rootfs.mk').write_text('if ! echo " $(3) "; then $$script enable; else $$script disable; fi')
  for name,call in m.CALLS.items():(root/name).write_text(call+'\n')
  strongswan=root/m.STRONGSWAN_MAKEFILE;strongswan.parent.mkdir(parents=True)
  strongswan.write_text('PKG_VERSION:=6.0.7\nPKG_HASH:=e518e34e159514f4c6ba80d1f926cb151e0dd4e3a1d94213171234b8b9ae6f55\nPKG_BUILD_DEPENDS:=python3/host\n'+m.CRYPTO_DEPENDS_FROM)
  patch=root/m.STRONGSWAN_GMPDH_PATCH;patch.parent.mkdir(parents=True);patch.write_text(GMPDH_PATCH_FIXTURE)
  return root
 def test_only_image_delivery_calls_change_and_operation_is_idempotent(self):
  root=self.fixture();original=(root/'include/rootfs.mk').read_bytes();m.prepare(root);m.prepare(root)
  for name in m.CALLS:self.assertIn(',$(MP716_DISABLED_SERVICES))',(root/name).read_text())
  self.assertEqual(original,(root/'include/rootfs.mk').read_bytes())
  body=(root/m.STRONGSWAN_MAKEFILE).read_text()
  self.assertEqual(body.count('PKG_BUILD_DEPENDS:=gmp python3/host\n'),1)
  self.assertEqual(body.count('+kmod-crypto-sha256 +kmod-crypto-xcbc'),1)
  self.assertNotIn('CONFIG_PACKAGE_libgmp',body)
  self.assertEqual((root/m.STRONGSWAN_GMPDH_PATCH).read_text(),GMPDH_PATCH_FIXTURE.replace(m.GMPDH_CONSTRUCTOR_FROM,m.GMPDH_CONSTRUCTOR_TO))
 def test_unexpected_pinned_call_fails_before_any_file_is_changed(self):
  root=self.fixture();original=(root/'package/Makefile').read_bytes();(root/'include/image.mk').write_text('unexpected')
  with self.assertRaises(ValueError):m.prepare(root)
  self.assertEqual(original,(root/'package/Makefile').read_bytes())
 def test_unexpected_strongswan_dependency_line_does_not_partially_patch_rootfs(self):
  root=self.fixture();original={name:(root/name).read_bytes() for name in m.CALLS}
  path=root/m.STRONGSWAN_MAKEFILE;path.write_text(path.read_text().replace('PKG_BUILD_DEPENDS:=python3/host','PKG_BUILD_DEPENDS:=unreviewed python3/host'))
  with self.assertRaisesRegex(ValueError,'strongswan build dependencies'):m.prepare(root)
  for name,body in original.items():self.assertEqual((root/name).read_bytes(),body)
 def test_different_strongswan_release_fails_before_any_mutation(self):
  root=self.fixture();original={name:(root/name).read_bytes() for name in m.CALLS}
  path=root/m.STRONGSWAN_MAKEFILE;path.write_text(path.read_text().replace('PKG_VERSION:=6.0.7','PKG_VERSION:=6.0.8'))
  with self.assertRaisesRegex(ValueError,'source version or hash'):m.prepare(root)
  for name,body in original.items():self.assertEqual((root/name).read_bytes(),body)
 def test_gmp_source_dependency_preserves_runtime_package_selection(self):
  root=self.fixture();config=root/'.config';config.write_text('CONFIG_PACKAGE_strongswan-mod-gmpdh=y\n# CONFIG_PACKAGE_libgmp is not set\n')
  original=config.read_bytes();m.prepare(root)
  self.assertEqual(config.read_bytes(),original)
 def test_crypto_dependency_drift_does_not_partially_patch_source_or_rootfs(self):
  root=self.fixture();path=root/m.STRONGSWAN_MAKEFILE
  path.write_text(path.read_text().replace('+kmod-ipsec +kmod-ipsec4','+kmod-unreviewed +kmod-ipsec4'))
  original={p:p.read_bytes() for p in root.rglob('*') if p.is_file()}
  with self.assertRaisesRegex(ValueError,'strongswan crypto dependencies'):m.prepare(root)
  for path,body in original.items():self.assertEqual(path.read_bytes(),body)
 def test_existing_gmp_patch_can_receive_crypto_patch_idempotently(self):
  root=self.fixture();path=root/m.STRONGSWAN_MAKEFILE
  path.write_text(path.read_text().replace('PKG_BUILD_DEPENDS:=python3/host','PKG_BUILD_DEPENDS:=gmp python3/host'))
  m.prepare(root);first=path.read_bytes();m.prepare(root)
  self.assertEqual(first,path.read_bytes())
  self.assertEqual(path.read_text().count('+kmod-crypto-sha256 +kmod-crypto-xcbc'),1)
 def test_gmpdh_fix_only_uses_versioned_constructor_without_changing_DH_features(self):
  root=self.fixture();path=root/m.STRONGSWAN_GMPDH_PATCH;before=path.read_text()
  m.prepare(root);after=path.read_text()
  self.assertEqual(after.replace(m.GMPDH_CONSTRUCTOR_TO,m.GMPDH_CONSTRUCTOR_FROM),before)
  self.assertIn('+PLUGIN_PROVIDE(KE, MODP_2048_BIT),\n',after)
  self.assertEqual(after.count('+PLUGIN_DEFINE(gmpdh)\n'),1)
  self.assertNotIn('+plugin_t *gmpdh_plugin_create()\n',after)
 def test_previously_fixed_gmpdh_patch_is_idempotent(self):
  root=self.fixture();path=root/m.STRONGSWAN_GMPDH_PATCH
  path.write_text(path.read_text().replace(m.GMPDH_CONSTRUCTOR_FROM,m.GMPDH_CONSTRUCTOR_TO));before=path.read_bytes()
  m.prepare(root);m.prepare(root)
  self.assertEqual(path.read_bytes(),before)
 def test_unknown_gmpdh_constructor_fails_before_any_rootfs_or_package_mutation(self):
  root=self.fixture();path=root/m.STRONGSWAN_GMPDH_PATCH
  path.write_text(path.read_text().replace(m.GMPDH_CONSTRUCTOR_FROM,'+plugin_t *unreviewed_plugin_create()\n'))
  original={p:p.read_bytes() for p in root.rglob('*') if p.is_file()}
  with self.assertRaisesRegex(ValueError,'gmpdh plugin ABI'):m.prepare(root)
  for p,body in original.items():self.assertEqual(p.read_bytes(),body)
 def test_duplicate_or_mixed_gmpdh_constructors_are_rejected_without_partial_changes(self):
  for added in [m.GMPDH_CONSTRUCTOR_FROM,m.GMPDH_CONSTRUCTOR_TO]:
   with self.subTest(added=added):
    root=self.fixture();path=root/m.STRONGSWAN_GMPDH_PATCH;path.write_text(path.read_text()+added)
    original={p:p.read_bytes() for p in root.rglob('*') if p.is_file()}
    with self.assertRaisesRegex(ValueError,'gmpdh plugin ABI'):m.prepare(root)
    for p,body in original.items():self.assertEqual(p.read_bytes(),body)
 def test_gmpdh_patch_for_an_unknown_source_file_is_rejected_before_any_mutation(self):
  root=self.fixture();path=root/m.STRONGSWAN_GMPDH_PATCH
  path.write_text(path.read_text().replace(m.GMPDH_SOURCE_MARKER,'+++ b/src/libstrongswan/plugins/other/plugin.c\n'))
  original={p:p.read_bytes() for p in root.rglob('*') if p.is_file()}
  with self.assertRaisesRegex(ValueError,'gmpdh source patch'):m.prepare(root)
  for p,body in original.items():self.assertEqual(p.read_bytes(),body)
