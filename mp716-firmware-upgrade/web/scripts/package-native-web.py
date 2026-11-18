#!/usr/bin/env python3
"""Build and verify a standalone Vue artifact; never writes a device or firmware."""
import argparse,hashlib,json,re,sys
from pathlib import Path,PurePosixPath
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED,BadZipFile

API='mp716-native/v1'
MAX_BYTES=2*1024*1024
def sha(data):return hashlib.sha256(data).hexdigest()
def require(ok,message):
 if not ok:raise ValueError(message)
def build(project,dist,output,commit):
 require(re.fullmatch(r'[a-f0-9]{40}',commit) is not None,'Expected full frontend source commit')
 version=json.loads((project/'package.json').read_text())['version']
 require(re.fullmatch(r'\d+\.\d+\.\d+',version) is not None,'Invalid web version')
 files={}
 for file in sorted(dist.rglob('*')):
  require(not file.is_symlink(),'Web artifact cannot contain symlinks')
  if not file.is_file():continue
  name=file.relative_to(dist).as_posix()
  require(file.suffix in ('.html','.js','.css','.svg','.png','.jpg','.woff','.woff2','.ico','.json','.txt'),'Unexpected web asset')
  files['web/'+name]=file.read_bytes()
 require('web/index.html' in files,'Missing index.html')
 require(0<sum(map(len,files.values()))<=MAX_BYTES,'Web bundle exceeds 2 MiB')
 native_js=b'\n'.join(b for n,b in files.items() if n.endswith('.js'))
 for forbidden in (b'/cgi-bin/cgi_huayi.cgi',b'/cgi-bin/cgi_stream.cgi',b'factory-dev-bypass'):
  require(forbidden not in native_js,'Factory or mock code found in native web bundle')
 require(b'/cgi-bin/mp716' in native_js,'Missing native API endpoint')
 routes=json.loads((project/'native-web-contract.json').read_text())
 manifest={'format':'MP716WEB','format_version':1,'web_version':version,'source_commit':commit,'api_contract':API,'required_routes':routes['required_routes'],'files':{name:{'bytes':len(body),'sha256':sha(body)} for name,body in files.items()},'bytes':sum(map(len,files.values())),'firmware_included':False,'test_status':'UNVERIFIED'}
 files['web-manifest.json']=(json.dumps(manifest,indent=2,sort_keys=True)+'\n').encode()
 output.mkdir(parents=True,exist_ok=True);target=output/f'mp716-web-{version}-{commit[:10]}.zip'
 with ZipFile(target,'w',compression=ZIP_DEFLATED,compresslevel=9) as archive:
  for name,body in sorted(files.items()):
   info=ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o100644<<16;archive.writestr(info,body)
 target.with_suffix('.zip.sha256').write_text(sha(target.read_bytes())+'  '+target.name+'\n')
 verify(target);return target
def verify(path,capabilities=None):
 with ZipFile(path) as archive:
  names=archive.namelist();require(len(names)==len(set(names)),'Duplicate archive path')
  for name in names:
   parts=PurePosixPath(name).parts
   require(not name.startswith('/') and '\\' not in name and '..' not in parts and PurePosixPath(name).as_posix()==name,'Unsafe archive path')
   mode=archive.getinfo(name).external_attr>>16
   require(mode & 0o170000 in (0,0o100000),'Non-regular archive entry')
  require(sum(x.file_size for x in archive.infolist())<=MAX_BYTES+256*1024,'Archive expands beyond limit')
  manifest=json.loads(archive.read('web-manifest.json'))
  require(manifest.get('format')=='MP716WEB' and manifest.get('format_version')==1,'Unsupported web package format')
  require(manifest.get('api_contract')==API and manifest.get('firmware_included') is False,'Incompatible API contract')
  require(set(names)==set(manifest['files'])|{'web-manifest.json'},'Unlisted or missing archive files')
  for name,row in manifest['files'].items():
   require(name.startswith('web/'),'Asset outside web directory')
   body=archive.read(name);require(len(body)==row['bytes'] and sha(body)==row['sha256'],'Asset hash mismatch: '+name)
  if capabilities is not None:
   require(capabilities.get('apiContract')==API,'Router does not support this API contract')
   missing=set(manifest['required_routes'])-set(capabilities.get('routes',[]));require(not missing,'Router is missing routes: '+', '.join(sorted(missing)))
  return manifest
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--verify',type=Path);p.add_argument('--capabilities',type=Path);p.add_argument('--dist',type=Path);p.add_argument('--output',type=Path);p.add_argument('--build-commit');a=p.parse_args()
 try:
  if a.verify:
   report=verify(a.verify,json.loads(a.capabilities.read_text()) if a.capabilities else None);print(json.dumps({'ok':True,'web_version':report['web_version'],'files':len(report['files']),'firmware_included':False}))
  else:
   root=Path(__file__).resolve().parents[1];target=build(root,a.dist or root/'dist-openwrt',a.output or root/'releases/web',a.build_commit or '');print(json.dumps({'ok':True,'output':str(target),'sha256':sha(target.read_bytes()),'firmware_included':False}))
 except (ValueError,KeyError,OSError,BadZipFile) as e:print(json.dumps({'ok':False,'error':str(e)}),file=sys.stderr);raise SystemExit(2)
if __name__=='__main__':main()
