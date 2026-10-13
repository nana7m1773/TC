import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {validateLocalImage} from './images.mjs';

export class LocalModelError extends Error {
  constructor(code,message) { super(message); this.name='LocalModelError'; this.code=code; }
}

async function freePort() {
  const server=net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  return port;
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

/** Owns a private loopback process. No renderer supplied executable or command is accepted. */
export class DesktopModelManager {
  constructor({directory,enginePath,tools,manifest}) {
    this.directory=directory;this.enginePath=enginePath;this.tools=tools;
    this.manifest=structuredClone(manifest??tools.defaultModel);this.defaultWasExplicit=manifest!==undefined;
    this.inferenceTimeoutMs=this.manifest.sizeBytes>4_000_000_000?1_200_000:300_000;
    this.current={state:'stopped',contextSize:12800,cacheType:'q8_0',backend:'CPU',inferenceTimeoutMs:this.inferenceTimeoutMs,threads:Math.max(1,Math.min(4,os.availableParallelism()))};
    this.process=null;this.busy=false;this.download=null;this.abortInference=null;this.epoch=0;this.loading=false;this.inferencePending=false;this.maintenance=false;this.visionActive=false;
  }
  async initialize() {await fs.mkdir(this.directory,{recursive:true});}
  async records() {
    try {return JSON.parse(await fs.readFile(path.join(this.directory,'models.json'),'utf8'));}
    catch(error) {if(error.code==='ENOENT')return [];throw new LocalModelError('INDEX','本地模型索引损坏，请先备份数据。');}
  }
  async writeRecords(records) {
    const target=path.join(this.directory,'models.json');
    await fs.writeFile(target+'.tmp',JSON.stringify(records,null,2),{mode:0o600});await fs.rename(target+'.tmp',target);
  }
  async listModels() {
    const models=[];
    for(const record of await this.records()) {
      try {const stat=await fs.stat(path.join(this.directory,record.filename));models.push({...record,path:path.join(this.directory,record.filename),sizeBytes:stat.size});}
      catch(error) {if(error.code!=='ENOENT')throw error;}
    }
    const projector=this.manifest.visionProjector;
    let visionInstalled=false;
    if(projector)try {await fs.access(path.join(this.directory,projector.filename));visionInstalled=true;}catch{}
    return {models,defaultModel:{...structuredClone(this.manifest),visionProjector:projector?{...projector,installed:visionInstalled}:undefined}};
  }
  status() {return {...this.current,engineAvailable:!!this.enginePath,downloading:!!this.download,defaultModel:structuredClone(this.manifest),maxImportBytes:this.manifest.maxImportBytes??4_000_000_000};}
  async installDefault() {
    if(this.maintenance||this.download||this.busy||this.loading||this.inferencePending||this.visionActive)throw new LocalModelError('BUSY','另一个模型任务正在进行，请等待或停止。');
    this.maintenance=true;try{return await this.installDefaultLocked();}finally{this.maintenance=false;}
  }
  async installDefaultLocked() {
    if(this.download||this.busy||this.loading||this.inferencePending)throw new LocalModelError('BUSY','另一个模型任务正在进行，请等待或停止。');
    const manifest=this.manifest;
    if(!manifest.sha256)throw new LocalModelError('CHECKSUM','默认模型尚无可信的校验值，下载已停止。请更新应用或导入有权使用的兼容 GGUF。');
    const available=(await fs.statfs(this.directory)).bavail*(await fs.statfs(this.directory)).bsize;
    if(available<manifest.sizeBytes*1.1)throw new LocalModelError('STORAGE','存储空间不足，请至少预留模型体积的 1.1 倍空间。');
    this.download=new AbortController();this.current={...this.current,state:'downloading',progress:0,error:undefined};
    try {
      const destination=path.join(this.directory,manifest.filename);
      await this.tools.downloadModel({destination,manifest,signal:this.download.signal,onProgress:progress=>{this.current.progress=progress.percentage/100;this.current.downloadedBytes=progress.receivedBytes;}});
      const records=await this.records();
      await this.writeRecords([...records.filter(r=>r.id!==manifest.id),{...manifest,installedAt:new Date().toISOString(),sourceVerified:true}]);
      this.current={...this.current,state:this.process?'ready':'stopped',progress:1};
      return {model:{...manifest,path:destination}};
    } catch(error) {
      this.current={...this.current,state:this.process?'ready':'error',error:this.download.signal.aborted?'下载已暂停，稍后可继续。':'模型下载或校验失败，请检查网络、存储和可信来源。'};
      throw new LocalModelError('DOWNLOAD',this.current.error);
    } finally {this.download=null;}
  }
  async installVision() {
    if(this.maintenance||this.download||this.busy||this.loading||this.inferencePending||this.visionActive)throw new LocalModelError('BUSY','另一个模型任务正在进行，请等待或停止。');
    const component=this.manifest.visionProjector;
    if(!component?.sha256)throw new LocalModelError('COMPONENT_MISSING','当前默认模型没有经过校验的匹配视觉组件。');
    this.maintenance=true;this.download=new AbortController();
    this.current={...this.current,state:'downloading',component:'vision',progress:0,error:undefined};
    try {
      const manifest={...component,kind:'vision-projector'};
      await this.tools.downloadModel({destination:path.join(this.directory,component.filename),manifest,signal:this.download.signal,
        onProgress:progress=>{this.current.progress=progress.percentage/100;this.current.downloadedBytes=progress.receivedBytes;}});
      this.current={...this.current,state:this.process?'ready':'stopped',component:undefined,progress:1};
      return {component:{...component,installed:true},status:'installed'};
    } catch(error) {
      const message=this.download.signal.aborted?'视觉组件下载已暂停，稍后可继续。':'视觉组件下载或完整性校验失败，请检查网络和可用存储。';
      this.current={...this.current,state:this.process?'ready':'error',error:message};throw new LocalModelError('DOWNLOAD',message);
    } finally {this.download=null;this.maintenance=false;}
  }
  async importModel(sourcePath) {
    if(this.maintenance||this.busy||this.download||this.loading||this.inferencePending||this.visionActive)throw new LocalModelError('BUSY','另一个模型任务正在进行。');
    this.maintenance=true;try{return await this.importModelLocked(sourcePath);}finally{this.maintenance=false;}
  }
  async importModelLocked(sourcePath) {
    if(this.busy||this.download||this.loading||this.inferencePending)throw new LocalModelError('BUSY','另一个模型任务正在进行。');
    const metadata=await this.tools.readGgufMetadata(sourcePath);
    if(!['qwen35','qwen3','qwen2','llama','gemma','gemma2','gemma3','phi3','mistral'].includes(metadata.architecture))
      throw new LocalModelError('FORMAT','首版仅允许已声明支持的文字模型架构；请使用兼容的 GGUF，而不是视觉投影或其他文件。');
    const nativeContext=metadata.contextLength;
    if(!Number.isFinite(nativeContext)||nativeContext<12800)
      throw new LocalModelError('CONTEXT','此模型没有声明至少 12,800 tokens 的原生上下文，不能作为首版文字模型导入。');
    const stat=await fs.stat(sourcePath);
    const limit=this.manifest.maxImportBytes??4_000_000_000;
    if(stat.size>limit)throw new LocalModelError('SIZE',`当前模型导入上限为 ${(limit/1_000_000_000).toFixed(0)} GB，请选择可用内存足以运行的兼容量化模型。`);
    const id='import-'+randomUUID();const filename=id+'.gguf';const destination=path.join(this.directory,filename);
    await fs.copyFile(sourcePath,destination+'.part');
    const verified=await this.tools.verifyModel(destination+'.part',null);
    await fs.rename(destination+'.part',destination);
    const record={id,filename,name:metadata.name||path.basename(sourcePath),sizeBytes:stat.size,sha256:verified.sha256,
      quantization:metadata.quantization||'导入模型',nativeContextSize:nativeContext,contextSize:12800,architecture:metadata.architecture,
      source:'本人选择的 GGUF 文件',sourceVerified:false,installedAt:new Date().toISOString(),license:'由导入者确认'};
    await this.writeRecords([...await this.records(),record]);
    return {model:{...record,path:destination},warning:'已校验文件格式与本机完整性。来源、许可证和实际加载兼容性仍需确认。'};
  }
  async resolveModel(input={}) {
    const records=await this.records();
    const requested=input.id??input.modelId;
    const explicitSelection=requested!==undefined||input.modelPath!==undefined;
    const record=requested?records.find(x=>x.id===requested):input.modelPath?records.find(x=>path.join(this.directory,x.filename)===input.modelPath):
      records.find(x=>x.id===this.manifest.id)??(this.defaultWasExplicit?undefined:records[0]);
    if(!record&&!explicitSelection&&this.defaultWasExplicit)throw new LocalModelError('MISSING_DEFAULT','当前桌面默认模型尚未安装。请下载默认模型，或在列表明确选择已有模型加载。');
    if(!record)throw new LocalModelError('MISSING','请先下载默认模型或导入兼容 GGUF。');
    return {...record,path:path.join(this.directory,record.filename)};
  }
  async loadModel(input={}) {
    if(this.busy||this.download||this.loading||this.inferencePending||this.maintenance||this.visionActive)throw new LocalModelError('BUSY','当前模型任务正在进行。');
    this.loading=true;
    try {return await this.loadModelLocked(input);} finally {this.loading=false;}
  }
  async loadModelLocked(input={}) {
    await this.stop();
    const epoch=this.epoch;
    if(!this.enginePath)throw new LocalModelError('ENGINE','安装包缺少经校验的内置 CPU 推理引擎，请安装完整版本。无需另装模型服务器。');
    const model=await this.resolveModel(input);
    let projector;
    if(input.vision===true) {
      if(model.id!==this.manifest.id)throw new LocalModelError('MATCH','视觉组件仅能与同一版本的默认模型配对。');
      projector={...this.manifest.visionProjector,kind:'vision-projector'};
      try {await fs.access(path.join(this.directory,projector.filename));}
      catch {throw new LocalModelError('COMPONENT_MISSING','请先一键安装匹配的本地视觉组件。完全本地模式不会上传图片。');}
      await this.tools.verifyModel(path.join(this.directory,projector.filename),projector);
    }
    const contextSize=Number(input.contextSize??12800);
    if(!Number.isInteger(contextSize)||contextSize<512||contextSize>12800||contextSize>model.nativeContextSize)
      throw new LocalModelError('CONTEXT','上下文需在 512–12,800 tokens 内，且不超过模型原生限制。降低配置不能作为 12,800 tokens 验收。');
    const required=model.sizeBytes+(model.parameterCount>=9_000_000_000?3_500_000_000:1_300_000_000)+(projector?projector.sizeBytes*1.4:0);
    if(os.freemem()<required+1_000_000_000)throw new LocalModelError('MEMORY','当前可用内存不足。请关闭其他任务，或选择更小模型；软件会为系统预留至少 1 GB。');
    this.busy=true;this.current={...this.current,state:'loading',modelId:model.id,modelPath:model.path,modelName:model.name,contextSize,visionLoaded:!!projector,error:undefined};
    try {
      await this.tools.verifyModel(model.path,model);
      const port=await freePort();const key=randomBytes(32).toString('hex');
      const keyFile=path.join(this.directory,'.engine-key');await fs.writeFile(keyFile,key,{mode:0o600});
      this.endpoint=`http://127.0.0.1:${port}`;this.key=key;
      const args=['--model',model.path,'--ctx-size',String(contextSize),'--parallel','1','--threads',String(this.current.threads),
        '--batch-size','256','--ubatch-size','128','--n-gpu-layers','0','--flash-attn','on','--cache-type-k','q8_0','--cache-type-v','q8_0',
        '--host','127.0.0.1','--port',String(port),'--api-key-file',keyFile,'--no-context-shift','--no-webui','--jinja','--reasoning','off','--offline'];
      if(projector)args.push('--mmproj',path.join(this.directory,projector.filename),'--image-min-tokens','256','--image-max-tokens','1024','--mtmd-batch-max-tokens','256');
      const child=spawn(this.enginePath,args,{cwd:path.dirname(this.enginePath),windowsHide:true,stdio:['ignore','ignore','pipe'],shell:false});
      this.process=child;
      let diagnostic='';child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk.toString()).slice(-4000);});
      child.once('error',()=>{this.current={...this.current,state:'error',error:'内置引擎未能启动。请检查安装包是否完整以及 CPU 指令集是否兼容。'};});
      child.once('exit',()=>{if(this.process===child){this.process=null;this.current={...this.current,state:'error',error:/alloc|memory|bad_alloc/i.test(diagnostic)?'模型内存不足，推理任务已安全停止。':'推理引擎已退出，请检查模型兼容性并重新加载。'};}});
      const deadline=Date.now()+180000;
      while(Date.now()<deadline) {
        if(this.epoch!==epoch)throw new LocalModelError('CANCELLED','模型加载已停止。');
        if(child.exitCode!==null||this.current.state==='error')throw new LocalModelError('LOAD',this.current.error||'模型加载失败。');
        try {const health=await this.engineRequest('/health',null,1500);if(health.status==='ok'){this.current={...this.current,state:'ready',loadTimeMs:180000-(deadline-Date.now())};return this.status();}}
        catch {}
        await pause(300);
      }
      throw new LocalModelError('LOAD_TIMEOUT','模型加载超过 3 分钟，已停止。请检查磁盘速度和内存。');
    } catch(error) {await this.stop();this.current={...this.current,state:'error',error:error.message};throw error;}
    finally {this.busy=false;}
  }
  async engineRequest(route,body,timeoutMs=120000,signal) {
    if(!this.endpoint)throw new LocalModelError('NOT_LOADED','请先加载本地模型。');
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
    const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    try {
      // Node fetch has an independent 5-minute header deadline. A 9B full-context CPU
      // prefill may exceed it; use the explicit total deadline on our own loopback socket.
      const target=new URL(this.endpoint+route);
      if(target.protocol!=='http:'||target.hostname!=='127.0.0.1')throw new LocalModelError('ENDPOINT','本地引擎地址无效。');
      return await new Promise((resolve,reject)=>{
        const request=http.request(target,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${this.key}`,'Content-Type':'application/json'},signal:controller.signal},response=>{
          if(response.statusCode<200||response.statusCode>=300){response.resume();reject(new LocalModelError('ENGINE_REQUEST',`本地引擎返回 ${response.statusCode}。请检查模型状态、格式和上下文预算。`));return;}
          const chunks=[];let bytes=0;
          response.on('data',chunk=>{bytes+=chunk.length;if(bytes>8*1024*1024){request.destroy();reject(new LocalModelError('OUTPUT','本地引擎响应超过8 MiB，任务已停止。'));}else chunks.push(chunk);});
          response.on('aborted',()=>reject(new LocalModelError('ENGINE_REQUEST','本地引擎连接已中断。')));
          response.on('error',reject);
          response.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new LocalModelError('OUTPUT','本地引擎返回了无效JSON。'));}});
        });
        request.on('error',reject);request.end(body?JSON.stringify(body):undefined);
      });
    } catch(error) {if(controller.signal.aborted)throw new LocalModelError('CANCELLED','本地任务已取消或超时。');if(error instanceof LocalModelError)throw error;throw new LocalModelError('ENGINE_REQUEST','本地引擎请求失败，请检查模型状态。');}
    finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  async template(messages) {
    const result=await this.engineRequest('/apply-template',{messages,add_generation_prompt:true,chat_template_kwargs:{enable_thinking:false}});
    if(typeof result.prompt!=='string')throw new LocalModelError('TEMPLATE','引擎不支持当前模型的聊天模板。');
    return result.prompt;
  }
  async tokenize(input) {
    if(!this.process||!['ready','generating'].includes(this.current.state))throw new LocalModelError('NOT_LOADED','请先加载模型，才能使用它的匹配 tokenizer。');
    const messages=input.messages??[{role:'user',content:input.text}];
    if(!Array.isArray(messages)||!messages.length||messages.some(m=>!['user','assistant','system'].includes(m.role)||typeof m.content!=='string')||JSON.stringify(messages).length>8_000_000)
      throw new LocalModelError('INPUT','待计数内容无效或过长。');
    const result=await this.engineRequest('/v1/chat/completions/input_tokens',{messages,chat_template_kwargs:{enable_thinking:false}});
    if(!Number.isInteger(result.input_tokens)||result.input_tokens<1)throw new LocalModelError('TOKENIZER','引擎没有返回完整聊天模板的匹配 tokenizer 结果。');
    return {count:result.input_tokens,contextSize:this.current.contextSize,includesChatTemplate:true};
  }
  async infer(input) {
    if(this.busy||this.loading||this.inferencePending||this.maintenance||this.visionActive||this.current.state==='generating')throw new LocalModelError('BUSY','本地推理仅允许一个任务并行。');
    this.inferencePending=true;
    try {return await this.inferLocked(input);}finally{this.inferencePending=false;}
  }
  async inferLocked(input) {
    if(!this.process||this.current.state!=='ready')throw new LocalModelError('NOT_LOADED','请先加载本地模型。');
    if(input.image||input.audio)throw new LocalModelError('COMPONENT','当前内置组件为文字模型。请安装经验证的视觉或语音组件，或明确选择支持此能力的 API；本地模式不会上传。');
    const maxTokens=Number(input.maxTokens??512);const contextSize=this.current.contextSize;
    if(!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>=contextSize)throw new LocalModelError('BUDGET','回复长度必须小于实际上下文。');
    if(input.contextSize&&Number(input.contextSize)!==contextSize)throw new LocalModelError('CONTEXT','输入配置与引擎实际上下文不同，请重新加载或使用显示的实际长度。');
    const temperature=Number(input.temperature??0.7);
    if(!Number.isFinite(temperature)||temperature<0||temperature>2)throw new LocalModelError('TEMPERATURE','温度需要在 0–2 之间。');
    const messages=input.messages??[{role:'user',content:String(input.prompt??'')}];
    if(!Array.isArray(messages)||!messages.length||messages.some(m=>!['system','user','assistant'].includes(m.role)||typeof m.content!=='string'))
      throw new LocalModelError('INPUT','本地文字消息格式无效。');
    const body={model:this.current.modelId,messages,max_tokens:maxTokens,temperature,stream:false,cache_prompt:false,chat_template_kwargs:{enable_thinking:false}};
    const tokens=await this.engineRequest('/v1/chat/completions/input_tokens',body);
    if(!Number.isInteger(tokens.input_tokens)||tokens.input_tokens<1)throw new LocalModelError('TOKENIZER','本地引擎未返回完整聊天模板的实际 token 数量。');
    if(tokens.input_tokens+maxTokens>contextSize)throw new LocalModelError('BUDGET',`输入 ${tokens.input_tokens} + 预留回复 ${maxTokens} 超过实际 ${contextSize} tokens。请裁剪较早历史并保留原始记录。`);
    this.busy=true;this.current={...this.current,state:'generating',inputTokens:tokens.input_tokens,maxTokens};this.abortInference=new AbortController();
    const started=Date.now();
    try {
      const result=await this.engineRequest('/v1/chat/completions',body,this.inferenceTimeoutMs,this.abortInference.signal);
      const text=result.choices?.[0]?.message?.content;
      if(typeof text!=='string')throw new LocalModelError('OUTPUT','本地引擎未返回文字回复。');
      const outputTokens=result.usage?.completion_tokens??result.timings?.predicted_n;
      return {text:text.trim(),inputTokens:result.usage?.prompt_tokens??tokens.input_tokens,outputTokens,
        tokensPerSecond:result.timings?.predicted_per_second??(outputTokens?outputTokens/((Date.now()-started)/1000):undefined),contextSize,
        elapsedMs:Date.now()-started,timings:result.timings};
    } finally {this.busy=false;this.abortInference=null;if(this.process)this.current={...this.current,state:'ready'};}
  }
  async analyzeImage(input) {
    if(this.busy||this.loading||this.inferencePending||this.maintenance||this.visionActive)throw new LocalModelError('BUSY','请等待当前本地任务完成；图片理解和文字生成串行运行。');
    this.visionActive=true;try{return await this.analyzeImageLocked(input);}finally{this.visionActive=false;}
  }
  async analyzeImageLocked(input) {
    const image=validateLocalImage(input.image);
    const prompt=String(input.prompt??'请描述这张图片的内容，提取可见文字；不清楚的部分明确说明不确定。');
    if(prompt.length>16000)throw new LocalModelError('INPUT','图片问题过长，请缩短。');
    const contextSize=Number(input.contextSize??12800),maxTokens=Number(input.maxTokens??256),temperature=Number(input.temperature??0.2);
    if(contextSize!==12800||!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>1024||!Number.isFinite(temperature)||temperature<0||temperature>2)
      throw new LocalModelError('BUDGET','图片阶段使用 12,800 tokens 上下文，回复上限为 1–1,024 tokens。');
    const component=this.manifest.visionProjector;
    if(!component)throw new LocalModelError('COMPONENT_MISSING','请安装匹配的本地视觉组件。');
    try {await fs.access(path.join(this.directory,component.filename));}
    catch {throw new LocalModelError('COMPONENT_MISSING','请先安装本地视觉组件。完全本地模式不会上传图片。');}
    const restore=this.process&&this.current.state==='ready'?{id:this.current.modelId,contextSize:this.current.contextSize}:null;
    let sessionEpoch;
    try {
      this.loading=true;
      try {await this.loadModelLocked({id:this.manifest.id,contextSize,vision:true});}finally{this.loading=false;}
      sessionEpoch=this.epoch;this.busy=true;this.current={...this.current,state:'generating',stage:'vision'};this.abortInference=new AbortController();
      const messages=[{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:image.data}}]}];
      const body={model:this.manifest.id,messages,max_tokens:maxTokens,temperature,stream:false,chat_template_kwargs:{enable_thinking:false}};
      const count=await this.engineRequest('/v1/chat/completions/input_tokens',body,300000,this.abortInference.signal);
      if(!Number.isInteger(count.input_tokens)||count.input_tokens<1)throw new LocalModelError('TOKENIZER','视觉引擎没有返回实际 token 数量，任务已停止。');
      if(count.input_tokens+maxTokens>contextSize)throw new LocalModelError('BUDGET',`图片与问题 ${count.input_tokens} + 回复 ${maxTokens} 超过实际 ${contextSize} tokens。请缩小图片或缩短问题。`);
      const result=await this.engineRequest('/v1/chat/completions',body,this.inferenceTimeoutMs,this.abortInference.signal);
      const text=result.choices?.[0]?.message?.content;
      if(typeof text!=='string')throw new LocalModelError('OUTPUT','本地视觉组件没有返回有效描述。');
      const actualInput=result.usage?.prompt_tokens??count.input_tokens;
      if(actualInput+maxTokens>contextSize)throw new LocalModelError('BUDGET','引擎返回的实际图片预算超过限制，此结果没有加入会话。');
      return {text,inputTokens:actualInput,outputTokens:result.usage?.completion_tokens,contextSize,processingLocation:'local',imageWidth:image.width,imageHeight:image.height};
    } finally {
      const canRestore=sessionEpoch!==undefined&&this.epoch===sessionEpoch;
      this.busy=false;this.abortInference=null;await this.stop();this.visionActive=false;
      if(restore&&canRestore)try {await this.loadModel(restore);}catch {this.current={...this.current,state:'error',error:'图片资源已释放，原文字模型恢复失败。请重新加载文字模型。'};}
    }
  }
  async withReleasedResources(callback) {
    if(this.busy||this.loading||this.inferencePending||this.maintenance||this.visionActive)throw new LocalModelError('BUSY','本地组件串行运行，请先完成或停止当前任务。');
    const restore=this.process&&this.current.state==='ready'?{id:this.current.modelId,contextSize:this.current.contextSize}:null;
    this.maintenance=true;await this.stop();const stageEpoch=this.epoch;
    try {return await callback();}
    finally {
      this.maintenance=false;
      if(restore&&this.epoch===stageEpoch)try {await this.loadModel(restore);}catch {this.current={...this.current,state:'error',error:'语音资源已释放，文字模型恢复失败，请重新加载。'};}
    }
  }
  async stop() {
    this.epoch++;
    this.download?.abort();this.abortInference?.abort();
    const child=this.process;this.process=null;this.endpoint=null;this.key=null;
    if(child) {child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
    await fs.rm(path.join(this.directory,'.engine-key'),{force:true});
    this.current={...this.current,state:'stopped',visionLoaded:false,stage:undefined,error:undefined};return this.status();
  }
  async deleteModel(input) {
    if(this.maintenance||this.loading||this.download||this.visionActive)throw new LocalModelError('BUSY','当前模型任务正在进行，请先停止。');
    this.maintenance=true;try{return await this.deleteModelLocked(input);}finally{this.maintenance=false;}
  }
  async deleteModelLocked(input) {
    const model=await this.resolveModel(input);
    if(this.current.modelId===model.id)await this.stop();
    await fs.rm(model.path,{force:true});await fs.rm(model.path+'.part',{force:true});
    await this.writeRecords((await this.records()).filter(r=>r.id!==model.id));return {deleted:true};
  }
}
