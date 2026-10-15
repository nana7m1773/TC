const {app,BrowserWindow,ipcMain,safeStorage,dialog,Tray,Menu,nativeImage,session}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {pathToFileURL}=require('node:url');
const {scryptSync,randomBytes,createCipheriv,createDecipheriv}=require('node:crypto');
const {existsSync}=require('node:fs');

let window,tray,manager,speech,requestOpenAI,windowsUi,socialSessions,quitting=false,trayTimer;
const root=path.resolve(__dirname,'../..');
app.setName('L-BOT');
// Preserve the former app's encrypted data location when upgrading; no files are moved or decrypted.
if(!process.env.TC_USER_DATA){
  for(const name of ['知己 · 私人AI社交助理','tc-social-assistant']){
    const legacy=path.join(app.getPath('appData'),name);
    if(existsSync(path.join(legacy,'state.bin'))||existsSync(path.join(legacy,'keys.bin'))){app.setPath('userData',legacy);break;}
  }
}
if(process.env.TC_USER_DATA)app.setPath('userData',path.resolve(process.env.TC_USER_DATA));
const dataDir=()=>app.getPath('userData');
const security=()=>{
  if(!safeStorage.isEncryptionAvailable()||(process.platform==='linux'&&safeStorage.getSelectedStorageBackend?.()==='basic_text'))
    throw Object.assign(new Error('系统安全存储不可用，敏感数据不会以明文保存。Windows 请检查当前用户的系统凭据环境；Linux 需要系统密钥环。浏览器演示可使用临时内存。'),{code:'SECURE_STORAGE'});
};
const guardedString=(value,max=2_000_000)=>{
  if(typeof value!=='string'||Buffer.byteLength(value,'utf8')>max)throw Object.assign(new Error('输入内容为空、格式无效或体积过大。'),{code:'INPUT'});
  return value;
};
async function readSecure(name) {
  security();
  try{return safeStorage.decryptString(await fs.readFile(path.join(dataDir(),name)));}
  catch(error){if(error.code==='ENOENT')return null;throw Object.assign(new Error('安全数据无法解密，可能来自其他系统用户。请使用密码保护的导入导出迁移。'),{code:'DECRYPT'});}
}
const secureWrites=new Map();
function writeSecure(name,value) {
  const action=(secureWrites.get(name)??Promise.resolve()).then(async()=>{
    security();await fs.mkdir(dataDir(),{recursive:true});
    const file=path.join(dataDir(),name);await fs.writeFile(file+'.tmp',safeStorage.encryptString(value),{mode:0o600});await fs.rename(file+'.tmp',file);
  });
  secureWrites.set(name,action.catch(()=>{}));return action;
}
const validId=id=>{if(typeof id!=='string'||!/^[\w.-]{1,100}$/.test(id))throw Object.assign(new Error('配置 ID 无效。'),{code:'ID'});return id;};
async function secretMap() {return JSON.parse(await readSecure('keys.bin')??'{}');}
let secureChain=Promise.resolve();
function keyMutation(fn) {const action=secureChain.then(fn);secureChain=action.catch(()=>{});return action;}
async function findEngine(kind='llama') {
  const platform=process.platform==='win32'?'win-x64':process.platform==='linux'?'linux-x64':null;
  if(!platform)return null;
  const base=app.isPackaged?path.join(process.resourcesPath,'engines'):path.join(root,'apps/desktop/resources/engines');
  const executable=kind==='whisper'?path.join(base,`whisper-${platform}`,process.platform==='win32'?'whisper-cli.exe':'whisper-cli'):
    path.join(base,platform,process.platform==='win32'?'llama-server.exe':'llama-server');
  try{await fs.access(executable);return executable;}catch{return null;}
}
function senderAllowed(event) {
  if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)return false;
  const current=event.senderFrame.url;
  if(app.isPackaged)return current.split(/[?#]/)[0]===pathToFileURL(path.join(root,'dist/index.html')).href;
  return current.split(/[?#]/)[0]===pathToFileURL(path.join(root,'dist/index.html')).href||current.startsWith('http://127.0.0.1:5173/')||current.startsWith('http://localhost:5173/');
}
const register=(name,fn)=>ipcMain.handle(`assistant:${name}`,async(event,input)=>{
  if(!senderAllowed(event))return {__error:true,code:'ORIGIN',message:'此页面没有本地助手权限。'};
  try{return await fn(input??{});}
  catch(error){return {__error:true,code:error.code??'RUNTIME',message:error.code?error.message:'操作失败，请检查存储、设备或模型状态。'};}
});

function setupHandlers() {
  register('loadState',async()=>({state:await readSecure('state.bin')}));
  register('saveState',async({state})=>{guardedString(state,32_000_000);JSON.parse(state);await writeSecure('state.bin',state);return {saved:true};});
  register('saveApiKey',({id,key})=>keyMutation(async()=>{validId(id);guardedString(key,8192);const keys=await secretMap();keys[id]=key;await writeSecure('keys.bin',JSON.stringify(keys));return {saved:true};}));
  register('hasApiKey',async({id})=>({present:!!(await secretMap())[validId(id)]}));
  register('deleteApiKey',({id})=>keyMutation(async()=>{const keys=await secretMap();delete keys[validId(id)];await writeSecure('keys.bin',JSON.stringify(keys));return {deleted:true};}));
  const apiRequest=async(input)=>{
    const id=validId(input.config?.id);const keys=await secretMap();
    const apiKey=input.config?.apiKey?guardedString(input.config.apiKey,8192):keys[id]??'';
    return requestOpenAI(input,{apiKey});
  };
  register('request',apiRequest);
  register('models',input=>apiRequest({...input,operation:'models'}));
  register('testConnection',input=>apiRequest({...input,operation:'test'}));
  register('deviceInfo',async()=>({platform:process.platform,arch:process.arch,totalMemory:os.totalmem(),availableMemory:os.freemem(),
    cpu:os.cpus()[0]?.model,cpuCount:os.availableParallelism(),secureStorageAvailable:safeStorage.isEncryptionAvailable()&&
      !(process.platform==='linux'&&safeStorage.getSelectedStorageBackend?.()==='basic_text'),
    appVersion:app.getVersion(),physicalDeviceValidation:'待实机验证',dataDirectory:dataDir()}));
  register('listSocialWindows',()=>windowsUi.listSocialWindows());
  register('activateSocialWindow',input=>windowsUi.activateSocialWindow(input));
  register('getSocialStatus',()=>socialSessions.getSocialStatus());
  register('openSocialApp',input=>socialSessions.openSocialApp(input));
  register('requestSocialAccess',()=>socialSessions.requestSocialAccess());
  register('readSocialWindow',input=>windowsUi.readSocialWindow(input));
  register('captureSocialWindow',input=>windowsUi.captureSocialWindow(input));
  register('prepareSocialReply',input=>windowsUi.prepareSocialReply(input));
  register('commitSocialReply',input=>windowsUi.commitSocialReply(input));
  register('modelStatus',()=>manager.status());
  register('listModels',()=>manager.listModels());
  register('installDefault',()=>manager.installDefault());
  register('installVision',()=>manager.installVision());
  register('analyzeImage',input=>manager.analyzeImage(input));
  register('installSpeech',()=>speech.installSpeech());
  register('transcribeLocal',input=>manager.withReleasedResources(()=>speech.transcribeLocal(input)));
  register('importModel',async()=>{
    const selected=await dialog.showOpenDialog(window,{title:'导入有权使用的兼容文字模型',properties:['openFile'],filters:[{name:'GGUF 文字模型',extensions:['gguf']}]});
    if(selected.canceled)return {cancelled:true};return manager.importModel(selected.filePaths[0]);
  });
  register('loadModel',input=>manager.loadModel(input));register('stop',async()=>{await speech.stop();return manager.stop();});
  register('deleteModel',input=>manager.deleteModel(input));register('infer',input=>manager.infer(input));register('tokenize',input=>manager.tokenize(input));
  register('setAutostart',({enabled})=>{
    if(process.platform!=='win32')throw Object.assign(new Error('本次仅支持 Windows 可选开机启动。'),{code:'PLATFORM'});
    app.setLoginItemSettings({name:'TC Social Assistant',openAtLogin:enabled===true,args:['--hidden']});return {enabled:app.getLoginItemSettings({name:'TC Social Assistant'}).openAtLogin};
  });
  register('getAutostart',()=>({enabled:process.platform==='win32'&&app.getLoginItemSettings({name:'TC Social Assistant'}).openAtLogin}));
  register('clearCache',async()=>{await window.webContents.session.clearCache();return {cleared:true};});
  register('deleteHistory',async()=>{await fs.rm(path.join(dataDir(),'state.bin'),{force:true});return {deleted:true};});
  register('exportProtected',async({state,password})=>{
    guardedString(state,32_000_000);JSON.parse(state);validatePassword(password);
    const result=await dialog.showSaveDialog(window,{title:'导出密码保护的数据',defaultPath:'社交助理数据.tcbackup',filters:[{name:'加密备份',extensions:['tcbackup']}]});
    if(result.canceled)return {cancelled:true};
    const salt=randomBytes(16),nonce=randomBytes(12),key=scryptSync(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
    const cipher=createCipheriv('aes-256-gcm',key,nonce);const encrypted=Buffer.concat([cipher.update(state,'utf8'),cipher.final()]);
    const document={format:'TC-protected-v1',kdf:'scrypt-N32768-r8-p1',salt:salt.toString('base64'),nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')};
    key.fill(0);await fs.writeFile(result.filePath,JSON.stringify(document),{mode:0o600});return {exported:true};
  });
  register('importProtected',async({password})=>{
    validatePassword(password);const result=await dialog.showOpenDialog(window,{title:'导入加密数据',properties:['openFile'],filters:[{name:'加密备份',extensions:['tcbackup']}]});
    if(result.canceled)return {cancelled:true};
    if((await fs.stat(result.filePaths[0])).size>48_000_000)throw Object.assign(new Error('备份文件超过允许大小。'),{code:'IMPORT'});
    try {
      const document=JSON.parse(await fs.readFile(result.filePaths[0],'utf8'));
      if(document.format!=='TC-protected-v1'||document.kdf!=='scrypt-N32768-r8-p1')throw new Error();
      const salt=Buffer.from(document.salt,'base64'),nonce=Buffer.from(document.nonce,'base64'),tag=Buffer.from(document.tag,'base64');
      if(salt.length!==16||nonce.length!==12||tag.length!==16)throw new Error();
      const key=scryptSync(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
      const decipher=createDecipheriv('aes-256-gcm',key,nonce);decipher.setAuthTag(tag);
      const state=Buffer.concat([decipher.update(Buffer.from(document.data,'base64')),decipher.final()]).toString('utf8');key.fill(0);JSON.parse(state);
      return {state};
    }catch{throw Object.assign(new Error('备份损坏或密码错误，未修改当前数据。'),{code:'IMPORT'});}
  });
}
function validatePassword(password) {if(typeof password!=='string'||password.length<10||password.length>1024)throw Object.assign(new Error('导出密码至少需要 10 个字符。'),{code:'PASSWORD'});}

async function createWindow() {
  window=new BrowserWindow({width:1440,height:960,minWidth:920,minHeight:640,title:'L-BOT',backgroundColor:'#f5f3ed',
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,target)=>{
    const allowed=app.isPackaged?target.split(/[?#]/)[0]===pathToFileURL(path.join(root,'dist/index.html')).href:/^http:\/\/(127\.0\.0\.1|localhost):5173\//.test(target)||target.split(/[?#]/)[0]===pathToFileURL(path.join(root,'dist/index.html')).href;
    if(!allowed)event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler(async(webContents,permission,callback,details)=>{
    if(webContents!==window.webContents||permission!=='media'||!details.mediaTypes?.includes('audio')||details.mediaTypes.includes('video'))return callback(false);
    const result=await dialog.showMessageBox(window,{type:'question',title:'使用麦克风',message:'允许这次主动录音使用麦克风吗？',
      detail:'只有你主动开始录音后才采集声音。完全本地模式下缺少语音组件时会提示安装，录音不会自动上传。',buttons:['取消','允许'],defaultId:0,cancelId:0});
    callback(result.response===1);
  });
  window.webContents.session.webRequest.onHeadersReceived((details,callback)=>{
    const script=app.isPackaged?"'self'":"'self' 'unsafe-inline'";
    callback({responseHeaders:{...details.responseHeaders,'Content-Security-Policy':[
      `default-src 'self'; script-src ${script}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob: data:; connect-src 'self' ${app.isPackaged?'':'ws://127.0.0.1:5173 ws://localhost:5173'}; object-src 'none'; frame-src 'none'; base-uri 'none'`]}});
  });
  window.on('close',event=>{if(!quitting&&tray){event.preventDefault();window.hide();}});
  if(!app.isPackaged&&process.env.TC_DEV_URL)await window.loadURL('http://127.0.0.1:5173');
  else await window.loadFile(path.join(root,'dist/index.html'));
  if(process.argv.includes('--hidden'))window.hide();
}
async function createTray() {
  let icon;try{icon=await app.getFileIcon(process.execPath,{size:'small'});}catch{icon=nativeImage.createEmpty();}
  if(icon.isEmpty())return;
  tray=new Tray(icon);tray.setToolTip('L-BOT · 待命（仅已授权消息通道）');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'打开消息中心',click:()=>{window.show();window.focus();}},
    {label:'一键暂停回复与本地模型',click:async()=>{window.webContents.send('assistant:pause');await speech.stop();await manager.stop();tray.setToolTip('L-BOT · 已暂停');}},
    {label:'退出',click:()=>{quitting=true;app.quit();}}]));
  tray.on('double-click',()=>{window.show();window.focus();});
  trayTimer=setInterval(()=>{
    const state=manager.status().state;
    const label={stopped:'已暂停本地模型',ready:'本地模型待命',generating:'本地生成中',loading:'正在加载模型',downloading:'正在下载模型',error:'故障'}[state]??'离线';
    tray.setToolTip(`L-BOT · ${label}`);
  },2000);
}
if(!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',()=>{if(window){window.show();window.focus();}});
  app.whenReady().then(async()=>{
    const runtime=await import(pathToFileURL(path.join(root,'packages/runtime/desktop-models.mjs')).href);
    const tools=await import(pathToFileURL(path.join(root,'scripts/prepare-model.mjs')).href);
    const voiceRuntime=await import(pathToFileURL(path.join(root,'packages/runtime/desktop-speech.mjs')).href);
    const speechManifest=JSON.parse(await fs.readFile(path.join(root,'resources/local-speech.json'),'utf8'));
    ({requestOpenAI}=await import(pathToFileURL(path.join(root,'packages/runtime/openai.mjs')).href));
    windowsUi=await import(pathToFileURL(path.join(root,'packages/runtime/windows-ui.mjs')).href);
    const {createSocialSessions}=await import(pathToFileURL(path.join(root,'packages/runtime/social-sessions.mjs')).href);
    socialSessions=createSocialSessions({BrowserWindow,session,windowsUi});
    const desktopManifest=await tools.readDesktopManifest();
    manager=new runtime.DesktopModelManager({directory:path.join(dataDir(),'models'),enginePath:await findEngine(),tools,manifest:desktopManifest});await manager.initialize();
    speech=new voiceRuntime.DesktopSpeechManager({directory:path.join(dataDir(),'speech'),enginePath:await findEngine('whisper'),manifest:speechManifest,tools});await speech.initialize();
    setupHandlers();await createWindow();await createTray();
    app.on('activate',()=>{window.show();window.focus();});
  }).catch(()=>{dialog.showErrorBox('启动失败','应用组件缺失或本地存储无法访问。请重新安装完整版本。');app.quit();});
  app.on('before-quit',()=>{quitting=true;clearInterval(trayTimer);speech?.stop().catch(()=>{});manager?.stop().catch(()=>{});});
  app.on('window-all-closed',()=>{if(process.platform!=='darwin'&&!tray)app.quit();});
}
