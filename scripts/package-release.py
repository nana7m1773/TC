"""Package source and public validation evidence; installers must already be independently verified."""
import datetime, hashlib, json, subprocess, os
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root=Path(__file__).resolve().parent.parent
version=json.loads((root/'package.json').read_text())['version']
out=root/'artifacts/release';out.mkdir(parents=True,exist_ok=True)
source=out/f'L-BOT-source-{version}.zip'
evidence=out/f'L-BOT-validation-{version}.zip'
files=[root/value.decode() for value in subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=root).split(b'\0') if value]
assert files and all('.git' not in file.relative_to(root).parts and file.stat().st_size<2*1024*1024 for file in files)
with ZipFile(source,'w',ZIP_DEFLATED) as archive:
    for file in sorted(set(files)):
        archive.write(file,f'L-BOT-source-{version}/'+file.relative_to(root).as_posix())
with ZipFile(source) as archive:
    assert archive.testzip() is None
    for file in sorted(set(files)):
        assert archive.read(f'L-BOT-source-{version}/'+file.relative_to(root).as_posix())==file.read_bytes()
receipt={'verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceFileCount':len(set(files)),'archiveCrcPassed':True,'allSourceBytesMatch':True,'excludes':['.git','node_modules','dist','build outputs','model weights','credentials'],'sourceZipSha256':hashlib.sha256(source.read_bytes()).hexdigest()}
(root/'artifacts/validation/source-package.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
report_files=list((root/'artifacts/validation').glob('*.json'))+list((root/'artifacts/validation').glob('*.png'))
report_files += [root/'artifacts/android'/name for name in ['package-verification.json','native-host-smoke.json','speech-host-smoke.json','signature-verification.txt']]
with ZipFile(evidence,'w',ZIP_DEFLATED) as archive:
    for file in sorted(set(report_files)):
        if file.exists():archive.write(file,f'L-BOT-validation-{version}/'+file.relative_to(root).as_posix())
    for name,source_log in [('module-tests.log','release-verify.log'),('ui-tests.log','ui-release-passed.log'),('environment-install.log','install-release-validation.log'),('notification-targeted-ui.log','notification-targeted-ui.log')]:
        file=Path(os.environ.get('TC_RELEASE_LOG_DIR','/workspace/.setup'))/source_log
        if file.exists():archive.write(file,f'L-BOT-validation-{version}/logs/{name}')
with ZipFile(evidence) as archive:assert archive.testzip() is None
installers=[root/f'artifacts/windows/L-BOT-Setup-{version}-x64.exe',root/f'artifacts/android/L-BOT-Android-{version}-arm64-debug.apk']
checks=[]
for file in installers+[source,evidence]:
    assert file.exists() and file.stat().st_size>0
    checks.append({'name':file.name,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'path':str(file)})
(out/'SHA256SUMS.txt').write_text(''.join(f"{item['sha256']}  {item['name']}\n" for item in checks))
(out/'release-assets.json').write_text(json.dumps(checks,indent=2)+'\n')
print(json.dumps({'assets':checks,'sourceFileCount':len(set(files))},ensure_ascii=False))
