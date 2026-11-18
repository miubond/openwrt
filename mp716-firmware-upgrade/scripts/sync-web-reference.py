#!/usr/bin/env python3
"""Export the canonical openwrt_system frontend, or verify its generated snapshot.

Only enumerated source files are copied. No local .env, credentials, build output,
node_modules, private fixtures or router backups may enter the firmware repo.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
DESTINATION = PROJECT / 'web'
DIRECTORIES = ('src', 'public', 'tests/unit')
FILES = ('package.json','package-lock.json','index.html','vite.config.ts',
         'tsconfig.json','tsconfig.app.json','tsconfig.node.json',
         '.env.openwrt','native-web-contract.json','scripts/package-native-web.py',
         'tests/test-native-web-package.py',
         'firmware/scripts/stage-web-overlay.mjs',
         'firmware/scripts/verify-production-bundle.mjs',
         '.gitea/workflows/deploy-frontend.yml',
         'packages/mp716-rpc/files/usr/libexec/rpcd/mp716')

def digest(data): return hashlib.sha256(data).hexdigest()
def git(root, *args):
    return subprocess.check_output(['git','-C',str(root),*args],text=True,encoding='utf-8').strip()
def selected(root):
    paths = set(FILES)
    for directory in DIRECTORIES:
        for p in (root/directory).rglob('*'):
            if p.is_file() and '__pycache__' not in p.parts:
                paths.add(p.relative_to(root).as_posix())
    return sorted(paths)
def checked_path(root, name):
    path=root/name
    if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('Unsafe source path: '+name)
    return path
def verify():
    manifest=json.loads((DESTINATION/'frontend-source.json').read_text(encoding='utf-8'))
    for name, expected in manifest['files'].items():
        if digest(checked_path(DESTINATION,name).read_bytes())!=expected:
            raise ValueError('Generated Web snapshot was edited: '+name+'; fix openwrt_system and export it again')
    actual=set(selected(DESTINATION))
    if actual!=set(manifest['files']): raise ValueError('Generated Web source file set changed')
    return manifest
def export(source):
    source=source.resolve()
    if source==DESTINATION.resolve(): raise ValueError('Canonical source must differ from generated snapshot')
    if git(source,'status','--porcelain','--',*DIRECTORIES,*FILES):
        raise ValueError('Commit canonical frontend changes before exporting a reproducible snapshot')
    commit=git(source,'rev-parse','HEAD')
    paths=selected(source)
    # Export committed blobs rather than Windows CRLF worktree bytes. This also
    # proves every selected input belongs to the recorded source commit.
    payload={}
    for name in paths:
        checked_path(source,name)
        payload[name]=subprocess.check_output(['git','-C',str(source),'show',commit+':'+name])
    tracked=set(git(PROJECT,'ls-files','--','web').splitlines())
    # Delete only tracked files in the explicitly named generated Web directory.
    # Never walk/delete node_modules, local builds or untracked user files.
    for tracked_name in tracked:
        relative=Path(tracked_name).relative_to('web').as_posix()
        if relative in payload or relative in ('frontend-source.json','GENERATED.md'): continue
        path=checked_path(DESTINATION,relative)
        if path.is_file():path.unlink()
    for name,body in payload.items():
        path=checked_path(DESTINATION,name);path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(body)
    hashes={name:digest(body) for name,body in payload.items()}
    tree=digest(json.dumps(hashes,sort_keys=True,separators=(',',':')).encode())
    manifest={'source_project':'openwrt_system','source_commit':commit,'source_tree_sha256':tree,
              'source_dirty':False,'generated':True,'files':hashes}
    (DESTINATION/'frontend-source.json').write_text(json.dumps(manifest,indent=2,sort_keys=True)+'\n',encoding='utf-8')
    (DESTINATION/'GENERATED.md').write_text(
        '# Generated frontend snapshot\n\nCanonical source: `D:\\goweb\\src\\openwrt_system`.\n\n'
        'Edit and commit that project, then run `python3 scripts/sync-web-reference.py --source <path>` '
        'from mp716-firmware-upgrade. Do not hand-edit this snapshot.\n\n'
        'Native build: `npm run build:openwrt -- --outDir dist`. '
        'The Web-only workflow creates a standalone ZIP without compiling OpenWrt or accessing a router.\n',encoding='utf-8')
    return verify()
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path);a=p.parse_args()
    try:
        m=export(a.source) if a.source else verify()
        print(json.dumps({'ok':True,'source_commit':m['source_commit'],'files':len(m['files']),'source_tree_sha256':m['source_tree_sha256']}))
    except (ValueError,OSError,subprocess.CalledProcessError) as e:raise SystemExit(str(e))
