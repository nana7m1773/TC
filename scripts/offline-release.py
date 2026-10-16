"""Transport an already signed APK sparsely; reconstruct it byte-for-byte with pinned weights.
No signing key, model weight, or multi-GB binary is committed to Git.
"""
import argparse,hashlib,json,struct,subprocess
from pathlib import Path
from zipfile import ZipFile
ROOT=Path(__file__).resolve().parent.parent
BLOCK=4*1024*1024

def sha(file):
    h=hashlib.sha256()
    with Path(file).open('rb') as stream:
        while data:=stream.read(BLOCK):h.update(data)
    return h.hexdigest()

def copy_segment(source,out,length):
    while length:
        data=source.read(min(length,BLOCK))
        if not data:raise ValueError('Truncated source')
        out.write(data);length-=len(data)

def sparse(apk,out):
    out.mkdir(parents=True,exist_ok=True)
    default=json.loads((ROOT/'resources/default-model.json').read_text())
    models=[default,default['visionProjector'],json.loads((ROOT/'resources/local-speech.json').read_text())]
    holes=[]
    with ZipFile(apk) as archive,apk.open('rb') as source:
        for model in models:
            info=archive.getinfo('assets/preinstalled-models/'+model['filename'])
            assert info.compress_type==0 and info.file_size==model['sizeBytes']
            source.seek(info.header_offset);header=source.read(30)
            assert header[:4]==b'PK\x03\x04'
            name,extra=struct.unpack_from('<HH',header,26)
            holes.append({'start':info.header_offset+30+name+extra,'bytes':info.file_size,'filename':model['filename'],'sha256':model['sha256']})
    holes.sort(key=lambda h:h['start'])
    manifest={'format':'lbot-signed-apk-sparse-v1','name':apk.name,'bytes':apk.stat().st_size,'sha256':sha(apk),'segments':[]}
    template=out/'android-signed-template.bin'
    with apk.open('rb') as source,template.open('wb') as target:
        cursor=0
        for hole in holes:
            length=hole['start']-cursor
            assert length>=0
            if length:
                source.seek(cursor);offset=target.tell();copy_segment(source,target,length)
                manifest['segments'].append({'source':'template','offset':offset,'bytes':length})
            manifest['segments'].append({'source':'model',**{k:hole[k] for k in ['bytes','filename','sha256']}})
            cursor=hole['start']+hole['bytes']
        source.seek(cursor);length=apk.stat().st_size-cursor;offset=target.tell();copy_segment(source,target,length)
        manifest['segments'].append({'source':'template','offset':offset,'bytes':length})
    manifest['templateSha256']=sha(template)
    (out/'android-sparse.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'apkBytes':manifest['bytes'],'templateBytes':template.stat().st_size,'apkSha256':manifest['sha256']}))

def restore(folder,cache,destination):
    manifest=json.loads((folder/'android-sparse.json').read_text());template=folder/'android-signed-template.bin'
    assert sha(template)==manifest['templateSha256']
    target=destination/manifest['name'];destination.mkdir(parents=True,exist_ok=True)
    for segment in manifest['segments']:
        if segment['source']=='model':assert sha(cache/segment['filename'])==segment['sha256']
    with template.open('rb') as base,target.open('wb') as out:
        for segment in manifest['segments']:
            if segment['source']=='template':base.seek(segment['offset']);copy_segment(base,out,segment['bytes'])
            else:
                with (cache/segment['filename']).open('rb') as model:copy_segment(model,out,segment['bytes'])
    assert target.stat().st_size==manifest['bytes'] and sha(target)==manifest['sha256'],'Reconstructed APK differs from signed original'
    print(json.dumps({'reconstructed':target.name,'bytes':target.stat().st_size,'sha256':sha(target),'originalSignatureBytesPreserved':True}))

def parts(cache,destination,upload,hash_only=False,checksums=None):
    plan=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {offlinePlan} from './scripts/offline-model-plan.mjs';console.log(JSON.stringify(await offlinePlan()))"],cwd=ROOT,text=True))
    destination.mkdir(parents=True,exist_ok=True)
    for model in plan['models']:
        source=cache/model['filename'];assert source.stat().st_size==model['sizeBytes'] and sha(source)==model['sha256']
        with source.open('rb') as stream:
            for part in model['parts']:
                target=destination/part['name']
                if hash_only:
                    remaining=part['sizeBytes'];digest=hashlib.sha256()
                    while remaining:
                        data=stream.read(min(remaining,BLOCK))
                        if not data:raise ValueError('Truncated model')
                        digest.update(data);remaining-=len(data)
                    actual=digest.hexdigest()
                else:
                    with target.open('wb') as out:copy_segment(stream,out,part['sizeBytes'])
                    actual=sha(target)
                if checksums:
                    expected={line.split('  ',1)[1]:line.split('  ',1)[0] for line in checksums.read_text().splitlines()}
                    assert expected[target.name]==actual,'Volume differs from verified local release plan'
                print(json.dumps({'name':target.name,'bytes':part['sizeBytes'],'sha256':actual}),flush=True)
                if upload:
                    subprocess.run(['gh','release','upload',upload,'--repo','nana7m1773/TC','--clobber',str(target)],check=True)
                    target.unlink()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('operation',choices=['sparse','restore','parts']);parser.add_argument('--apk',type=Path);parser.add_argument('--folder',type=Path);parser.add_argument('--cache',type=Path,default=Path('/workspace/.cache/models'));parser.add_argument('--destination',type=Path,required=True);parser.add_argument('--upload');parser.add_argument('--hash-only',action='store_true');parser.add_argument('--checksums',type=Path)
    args=parser.parse_args()
    if args.operation=='sparse':sparse(args.apk,args.destination)
    elif args.operation=='restore':restore(args.folder,args.cache,args.destination)
    else:parts(args.cache,args.destination,args.upload,args.hash_only,args.checksums)
