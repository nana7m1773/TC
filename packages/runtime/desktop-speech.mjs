import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {LocalModelError} from './desktop-models.mjs';

export function validateLocalAudio(audio,manifest) {
  const supplied=typeof audio?.base64==='string'?audio.base64:typeof audio?.data==='string'?audio.data.split(',')[1]:null;
  if(typeof supplied!=='string'||supplied.length>Math.ceil(manifest.maxAudioBytes*4/3)+8||!supplied.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(supplied))
    throw new LocalModelError('AUDIO','本地语音需要有效的 WAV 音频，体积不能超过 20 MB。');
  const bytes=Buffer.from(supplied,'base64');
  if(bytes.length>manifest.maxAudioBytes||bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')
    throw new LocalModelError('AUDIO_FORMAT','请先将音频转换为单声道 16 kHz、16-bit PCM WAV。录音和文件转换都在本机进行。');
  if(bytes.readUInt32LE(4)+8!==bytes.length)throw new LocalModelError('AUDIO_FORMAT','WAV 文件长度不匹配或文件已损坏。');
  let format,channels,rate,bits,dataBytes=0;
  for(let offset=12;offset+8<=bytes.length;) {
    const kind=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4);offset+=8;
    if(offset+size>bytes.length)throw new LocalModelError('AUDIO_FORMAT','WAV 音频未完整写入。');
    if(kind==='fmt '&&size>=16) {format=bytes.readUInt16LE(offset);channels=bytes.readUInt16LE(offset+2);rate=bytes.readUInt32LE(offset+4);bits=bytes.readUInt16LE(offset+14);}
    if(kind==='data')dataBytes+=size;
    offset+=size+(size%2);
  }
  if(format!==1||channels!==1||rate!==16000||bits!==16||dataBytes<2||dataBytes%2)
    throw new LocalModelError('AUDIO_FORMAT','本地识别仅接受单声道 16 kHz、16-bit PCM WAV，请使用应用内转换。');
  const durationSeconds=dataBytes/32000;
  if(durationSeconds>manifest.maxAudioSeconds)throw new LocalModelError('AUDIO_DURATION','首版单次本地语音识别限制为 120 秒，请分段处理。');
  return {bytes,durationSeconds};
}

/** A short-lived whisper.cpp CPU process; files and raw output stay local and are removed afterward. */
export class DesktopSpeechManager {
  constructor({directory,enginePath,manifest,tools}) {this.directory=directory;this.enginePath=enginePath;this.manifest=manifest;this.tools=tools;this.process=null;this.download=null;this.busy=false;}
  async initialize() {await fs.mkdir(this.directory,{recursive:true});}
  async installSpeech() {
    if(this.busy||this.download)throw new LocalModelError('BUSY','另一个语音任务正在进行。');
    this.download=new AbortController();
    try {
      await this.tools.downloadModel({destination:path.join(this.directory,this.manifest.filename),manifest:this.manifest,signal:this.download.signal});
      return {component:{...this.manifest,installed:true},status:'installed'};
    }catch {throw new LocalModelError('DOWNLOAD',this.download.signal.aborted?'语音模型下载已暂停，稍后可继续。':'语音模型下载或完整性校验失败，请检查网络与存储。');}
    finally{this.download=null;}
  }
  async transcribeLocal(input) {
    if(this.busy||this.download)throw new LocalModelError('BUSY','另一个语音任务正在进行。');
    const audio=validateLocalAudio(input.audio,this.manifest);
    const language=String(input.language??'auto');
    if(!this.manifest.languages.includes(language))throw new LocalModelError('LANGUAGE','请选择中文、英文或自动识别。');
    if(!this.enginePath)throw new LocalModelError('ENGINE','安装包缺少内置语音引擎。请安装完整版本，无需安装 Python 或独立 AI 软件。');
    const model=path.join(this.directory,this.manifest.filename);
    try {await fs.access(model);}catch {throw new LocalModelError('COMPONENT_MISSING','请先安装本地 Whisper Base 多语言语音模型。完全本地模式不会上传录音。');}
    this.busy=true;const task=path.join(this.directory,'.transcribe-'+randomUUID());
    let timer;
    try {
      await this.tools.verifyModel(model,this.manifest);
      if(os.freemem()<700_000_000)throw new LocalModelError('MEMORY','当前可用内存不足，语音任务没有启动。');
      await fs.mkdir(task,{mode:0o700});const inputFile=path.join(task,'audio.wav');const output=path.join(task,'transcript');
      await fs.writeFile(inputFile,audio.bytes,{mode:0o600});
      const child=spawn(this.enginePath,['-m',model,'-f',inputFile,'-l',language,'-t',String(Math.min(4,os.availableParallelism())),'-bs','3',
        '--no-gpu','-otxt','-of',output,'--no-prints'],{cwd:path.dirname(this.enginePath),stdio:['ignore','ignore','pipe'],windowsHide:true,shell:false});
      this.process=child;let diagnostic='',timedOut=false,cancelled=false;
      child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk.toString()).slice(-2000);});
      timer=setTimeout(()=>{timedOut=true;child.kill();},300000);
      await new Promise((resolve,reject)=>{
        child.once('error',()=>reject(new LocalModelError('ENGINE','内置语音引擎未能启动。Windows 请确认 Microsoft Visual C++ x64 运行库已安装。')));
        child.once('exit',(code,signal)=>{
          cancelled=this.process!==child;
          if(timedOut)return reject(new LocalModelError('TIMEOUT','语音识别超过 5 分钟，已安全停止。'));
          if(cancelled)return reject(new LocalModelError('CANCELLED','语音任务已暂停。'));
          if(code===3221225501||code===-1073741795||signal==='SIGILL')return reject(new LocalModelError('CPU','当前 CPU 不支持语音引擎需要的 AVX2、FMA 或 F16C 指令。文字推理仍有兼容路径；请使用兼容版本的语音组件。'));
          if(code!==0)return reject(new LocalModelError('TRANSCRIBE',/memory|alloc/i.test(diagnostic)?'语音识别内存不足，任务已停止。':'本地语音识别失败，请检查音频、模型及 Microsoft Visual C++ x64 运行库。'));
          resolve();
        });
      });
      const text=(await fs.readFile(output+'.txt','utf8')).trim();
      if(text.length>200000)throw new LocalModelError('OUTPUT','转写内容超过允许长度，请分段处理。');
      return {text,language,durationSeconds:audio.durationSeconds,processingLocation:'local',requiresReview:true,
        warning:'请核对并修正转写内容；语音识别可能误听，不会直接把转写当作可靠事实。'};
    }finally {clearTimeout(timer);if(this.process){this.process.kill();this.process=null;}this.busy=false;await fs.rm(task,{recursive:true,force:true});}
  }
  async stop() {this.download?.abort();const child=this.process;this.process=null;if(child)child.kill();return {stopped:true};}
}
