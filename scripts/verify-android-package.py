"""Verify the built APK against current UI and platform manifests; this is not a device test."""
import hashlib, json, subprocess, struct, os
from pathlib import Path
from zipfile import ZipFile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text())['version']
apk = root / f'artifacts/android/L-BOT-Android-{version}-arm64-debug.apk'
with ZipFile(apk) as archive:
    assert archive.testzip() is None, 'APK CRC validation failed'
    expected = {p.relative_to(root / 'dist').as_posix(): p.read_bytes() for p in (root / 'dist').rglob('*') if p.is_file()}
    embedded = {name[len('assets/public/'):]: archive.read(name) for name in archive.namelist() if name.startswith('assets/public/') and not name.endswith('/')}
    assert expected.keys() == embedded.keys(), 'APK contains stale/missing web assets'
    for name, data in expected.items():
        assert embedded[name] == data, f'UI bytes differ: {name}'
    for name in ['default-model.json', 'local-speech.json']:
        assert archive.read('assets/' + name) == (root / 'resources' / name).read_bytes(), f'Manifest differs: {name}'
    model = json.loads(archive.read('assets/default-model.json'))
    assert model['parameterCount'] == 2_000_000_000 and model['contextSize'] == 12800
    assert hashlib.sha256(archive.read('assets/default-model.json')).hexdigest() == '57546542c2f08d0a6720508473b15ad5af7ef240b6933798a18ab587f06bb0a0', 'Original Android model manifest changed'
    config = json.loads(archive.read('assets/capacitor.config.json'))
    assert config['appId'] == 'cn.tc.assistant' and config['appName'] == 'L-BOT'
    assert config['loggingBehavior'] == 'none'
    assert config['android']['webContentsDebuggingEnabled'] is False and config['android']['allowMixedContent'] is False
    assert {'lib/arm64-v8a/libmuyu-inference.so', 'lib/arm64-v8a/libmuyu-speech.so', 'lib/arm64-v8a/libc++_shared.so'}.issubset(archive.namelist())
    elf_alignment={}
    for name in archive.namelist():
        if not name.startswith('lib/arm64-v8a/') or not name.endswith('.so'):
            continue
        elf=archive.read(name)
        assert elf[:6]==b'\x7fELF\x02\x01', f'Expected little-endian ELF64: {name}'
        offset=struct.unpack_from('<Q',elf,32)[0]
        size,count=struct.unpack_from('<HH',elf,54)
        alignments=[struct.unpack_from('<Q',elf,offset+i*size+48)[0] for i in range(count) if struct.unpack_from('<I',elf,offset+i*size)[0]==1]
        assert alignments and all(value>=16384 and value&(value-1)==0 for value in alignments), f'ELF 16KiB alignment failed: {name}'
        elf_alignment[name]=alignments
tooling = Path(os.environ.get('TC_TOOLING_DIR','/workspace/.tooling')) / 'android-sdk/build-tools/35.0.0'
signature = subprocess.run([str(tooling / 'apksigner'), 'verify', '--verbose', '--print-certs', str(apk)], check=True, capture_output=True, text=True).stdout
subprocess.run([str(tooling / 'zipalign'), '-c', '-P', '16', '-v', '4', str(apk)], check=True, capture_output=True)
metadata = subprocess.run([str(tooling / 'aapt'), 'dump', 'badging', str(apk)], check=True, capture_output=True, text=True).stdout
assert "application-label:'L-BOT'" in metadata and f"versionName='{version}'" in metadata
report = {'verifiedAt': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(), 'apk': str(apk), 'apkBytes': apk.stat().st_size, 'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(), 'assetFiles': len(expected), 'manifestsMatch': True, 'androidOriginal2BManifestUnchanged': True, 'appName': 'L-BOT', 'version': version, 'signatureVerified': True, 'signingType': 'debug', 'alignment16KiBPassed': True, 'elfLoadAlignment':elf_alignment, 'androidDeviceAcceptance': 'pending', 'assets': {name: hashlib.sha256(data).hexdigest() for name, data in expected.items()}}
(root / 'artifacts/android/package-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
(root / 'artifacts/android/signature-verification.txt').write_text(signature)
print(json.dumps(report, ensure_ascii=False))
