import importlib.util,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('native_services',ROOT/'scripts/prepare-native-services.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class NativeServiceBuildTests(unittest.TestCase):
 def fixture(self):
  self.tmp=tempfile.TemporaryDirectory(dir=ROOT/'build');self.addCleanup(self.tmp.cleanup);root=Path(self.tmp.name)
  (root/'include').mkdir();(root/'package').mkdir()
  (root/'include/rootfs.mk').write_text('if ! echo " $(3) "; then $$script enable; else $$script disable; fi')
  for name,call in m.CALLS.items():(root/name).write_text(call+'\n')
  strongswan=root/m.STRONGSWAN_MAKEFILE;strongswan.parent.mkdir(parents=True)
  strongswan.write_text('PKG_VERSION:=6.0.7\nPKG_HASH:=e518e34e159514f4c6ba80d1f926cb151e0dd4e3a1d94213171234b8b9ae6f55\nPKG_BUILD_DEPENDS:=python3/host\n')
  return root
 def test_only_image_delivery_calls_change_and_operation_is_idempotent(self):
  root=self.fixture();original=(root/'include/rootfs.mk').read_bytes();m.prepare(root);m.prepare(root)
  for name in m.CALLS:self.assertIn(',$(MP716_DISABLED_SERVICES))',(root/name).read_text())
  self.assertEqual(original,(root/'include/rootfs.mk').read_bytes())
  body=(root/m.STRONGSWAN_MAKEFILE).read_text()
  self.assertEqual(body.count('PKG_BUILD_DEPENDS:=gmp python3/host\n'),1)
  self.assertNotIn('CONFIG_PACKAGE_libgmp',body)
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
