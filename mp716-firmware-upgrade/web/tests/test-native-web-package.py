import importlib.util,json,tempfile,unittest
from pathlib import Path
from zipfile import ZipFile

spec=importlib.util.spec_from_file_location('web_package',Path(__file__).parents[1]/'scripts/package-native-web.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class WebPackageTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.dist=self.root/'dist-openwrt';self.dist.mkdir()
  (self.root/'package.json').write_text('{"version":"1.2.3"}')
  (self.root/'native-web-contract.json').write_text(json.dumps({'required_routes':['GET system/capabilities','POST tools/diagnostic/start']}))
  (self.dist/'index.html').write_text('<script src="/mp716/app.js"></script>')
  (self.dist/'app.js').write_text('const api="/cgi-bin/mp716";')
 def package(self):return m.build(self.root,self.dist,self.root/'out','a'*40)
 def test_standalone_package_has_only_web_assets_and_reproducible_digest(self):
  first=self.package();body=first.read_bytes();self.assertEqual(m.verify(first)['web_version'],'1.2.3')
  self.assertEqual(self.package().read_bytes(),body)
  with ZipFile(first) as z:self.assertEqual(set(z.namelist()),{'web/index.html','web/app.js','web-manifest.json'})
 def test_tampered_asset_is_rejected(self):
  p=self.package()
  with ZipFile(p) as z:rows={n:z.read(n) for n in z.namelist()}
  rows['web/app.js']=b'tampered'
  with ZipFile(p,'w') as z:
   for n,b in rows.items():z.writestr(n,b)
  with self.assertRaisesRegex(ValueError,'hash mismatch'):m.verify(p)
 def test_backend_missing_advanced_route_is_rejected_before_deploy(self):
  p=self.package()
  with self.assertRaisesRegex(ValueError,'missing routes'):m.verify(p,{'apiContract':m.API,'routes':['GET system/capabilities']})
  m.verify(p,{'apiContract':m.API,'routes':['GET system/capabilities','POST tools/diagnostic/start']})
 def test_wrong_api_or_path_is_rejected(self):
  p=self.package()
  with self.assertRaisesRegex(ValueError,'API contract'):m.verify(p,{'apiContract':'factory','routes':[]})
  with ZipFile(p,'a') as z:z.writestr('web/../escape',b'bad')
  with self.assertRaisesRegex(ValueError,'Unsafe archive path'):m.verify(p)
 def assert_essential_route_required(self,route):
  contract=json.loads((Path(__file__).parents[1]/'native-web-contract.json').read_text())
  self.assertIn(route,contract['required_routes'])
  (self.root/'native-web-contract.json').write_text(json.dumps(contract))
  package=self.package();all_routes=contract['required_routes']
  m.verify(package,{'apiContract':m.API,'routes':all_routes})
  with self.assertRaises(ValueError) as failure:
   m.verify(package,{'apiContract':m.API,'routes':[entry for entry in all_routes if entry!=route]})
  self.assertIn('missing routes',str(failure.exception));self.assertIn(route,str(failure.exception))
 def test_missing_prelogin_route_is_rejected_before_deploy(self):
  self.assert_essential_route_required('GET auth/prelogin')
 def test_missing_session_probe_route_is_rejected_before_deploy(self):
  self.assert_essential_route_required('GET system/ping')
 def test_missing_task_poll_route_is_rejected_before_deploy(self):
  self.assert_essential_route_required('GET system/config-task/:id')
 def test_factory_bundle_is_rejected(self):
  (self.dist/'app.js').write_text('const url="/cgi-bin/cgi_huayi.cgi";')
  with self.assertRaisesRegex(ValueError,'Factory or mock'):self.package()
if __name__=='__main__':unittest.main()
