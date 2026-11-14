"""Standalone source bundle; never include live keys, accounts or installed dependencies."""
from pathlib import Path
import hashlib,json,zipfile
root=Path(__file__).resolve().parent
out=root.parent/'BIT24-LIVE-CONSOLE-v0.1-SOURCE.zip'
files=[root/f for f in ['README-FA.md','package.json','.env.example','.dockerignore','Dockerfile','Caddyfile.example','server.mjs','exchange.mjs','setup.mjs','package-source.py']]
for folder in ['public','test','reports']:
    files.extend(p for p in (root/folder).rglob('*') if p.is_file())
assert all(p.exists() for p in files)
assert all(p.name!='.env' and p.suffix not in {'.enc','.key'} for p in files)
manifest=[{'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in sorted(files)]
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED)as z:
    z.writestr('bit24-live/PACKAGE-MANIFEST.json',json.dumps(manifest,ensure_ascii=False,indent=2))
    for p in sorted(files):z.write(p,'bit24-live/'+str(p.relative_to(root)))
with zipfile.ZipFile(out)as z:
    assert z.testzip()is None
    for f in manifest:assert hashlib.sha256(z.read('bit24-live/'+f['path'])).hexdigest()==f['sha256']
print(out.name,out.stat().st_size,'bytes,',len(manifest),'verified files')
print('SHA256',hashlib.sha256(out.read_bytes()).hexdigest())
